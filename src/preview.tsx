import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { Film, FilmProps } from './composition/Film';
import { durationOf } from './core/project';

// Private closure-scoped MessagePort transferred from the workbench.
// Untrusted TSX code inside Film.tsx cannot access this variable or spoof workbench hotkeys.
let privatePort: MessagePort | null = null;

const isCaptureMode =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('capture') === '1';

const notify = (event: string, data: Record<string, unknown> = {}) => {
  if (isCaptureMode) return;
  const payload = { source: 'cocraft-preview', event, ...data };
  if (privatePort) {
    privatePort.postMessage(payload);
  } else {
    parent.postMessage(payload, '*');
  }
};

class ErrorBoundary extends React.Component<
  { revision: number; sequenceId: string; onRecover?: () => void; onError?: (msg: string) => void; children: React.ReactNode },
  { error: string }
> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidUpdate(prevProps: { revision: number; sequenceId: string }) {
    if (
      this.state.error &&
      (prevProps.revision !== this.props.revision || prevProps.sequenceId !== this.props.sequenceId)
    ) {
      this.setState({ error: '' }, () => this.props.onRecover?.());
    }
  }
  componentDidCatch(e: Error) {
    this.props.onError?.(e.message);
    notify('error', { message: e.message });
  }
  render() {
    return this.state.error ? (
      <div
        data-preview-error={this.state.error}
        style={{ color: '#e5a99e', font: '13px -apple-system, BlinkMacSystemFont, sans-serif', padding: 30 }}
      >
        画面暂时无法加载：{this.state.error}
      </div>
    ) : (
      this.props.children
    );
  }
}

export interface MeasuredClipBox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

function measureVisibleBoxes(container: HTMLElement | null): Record<string, MeasuredClipBox> {
  if (!container) return {};
  const roots = container.querySelectorAll<HTMLElement>('[data-clip-root]');
  const boxes: Record<string, MeasuredClipBox> = {};
  roots.forEach((root) => {
    const id = root.dataset.clipRoot;
    if (!id) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width < 4 || rootRect.height < 4) return;

    const explicitBox = root.querySelector<HTMLElement>(`[data-clip-box="${CSS.escape(id)}"]`);
    if (explicitBox) {
      const r = explicitBox.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) {
        boxes[id] = {
          nx: (r.left - rootRect.left) / rootRect.width,
          ny: (r.top - rootRect.top) / rootRect.height,
          nw: r.width / rootRect.width,
          nh: r.height / rootRect.height,
        };
        return;
      }
    }

    const presetEl = root.querySelector<HTMLElement>('[data-preset]');
    if (presetEl) {
      const bg = getComputedStyle(presetEl).backgroundColor;
      const isTransparent = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
      if (isTransparent) {
        let minL = Infinity;
        let minT = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        for (const child of Array.from(presetEl.children) as HTMLElement[]) {
          const r = child.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.width >= rootRect.width * 0.96 && r.height >= rootRect.height * 0.96) continue;
          minL = Math.min(minL, r.left);
          minT = Math.min(minT, r.top);
          maxR = Math.max(maxR, r.right);
          maxB = Math.max(maxB, r.bottom);
        }
        if (Number.isFinite(minL) && maxR > minL && maxB > minT) {
          boxes[id] = {
            nx: (minL - rootRect.left) / rootRect.width,
            ny: (minT - rootRect.top) / rootRect.height,
            nw: (maxR - minL) / rootRect.width,
            nh: (maxB - minT) / rootRect.height,
          };
          return;
        }
      }
    }

    boxes[id] = { nx: 0, ny: 0, nw: 1, nh: 1 };
  });
  return boxes;
}

function Preview() {
  const [props, setProps] = useState<FilmProps | null>(null);
  const [paused, setPaused] = useState(true);
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [liveOverride, setLiveOverride] = useState<{ clipId: string; props: Record<string, unknown> } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const ref = useRef<PlayerRef>(null);
  const pending = useRef<number | null>(0);
  const lastSequenceId = useRef('');
  const lastBoxesJson = useRef('');
  const pausedRef = useRef(true);
  const mutedRef = useRef(false);
  const scrubbingRef = useRef(false);
  const measureRafRef = useRef<number>(0);
  const captureErrorRef = useRef('');
  const [captureEpoch, setCaptureEpoch] = useState(0);
  pausedRef.current = paused;

  useEffect(() => {
    if (!isCaptureMode) return;
    const nextRaf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const waitMediaReady = async (timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, new Promise<void>((r) => setTimeout(r, 1200))]).catch(() => {});
      }
      while (Date.now() < deadline) {
        const host = hostRef.current;
        if (!host) break;
        const pendingImgs = Array.from(host.querySelectorAll('img')).filter((img) => !img.complete);
        const pendingVideos = Array.from(host.querySelectorAll('video')).filter(
          (v) => v.readyState < 2 || v.seeking,
        );
        const pendingSpatial =
          document.documentElement.dataset.spatialLoading === '1' ||
          Boolean(host.querySelector('[data-spatial-loading="1"]'));
        if (!pendingImgs.length && !pendingVideos.length && !pendingSpatial) break;
        await nextRaf();
      }
    };
    const readError = (): string => {
      if (captureErrorRef.current) return captureErrorRef.current;
      const errEl = hostRef.current?.querySelector<HTMLElement>('[data-preview-error], [data-clip-error]');
      return errEl?.dataset.previewError || errEl?.dataset.clipError || '';
    };
    const api = {
      async load(nextProps: FilmProps, targetFrame: number): Promise<{ ok: boolean; error?: string }> {
        captureErrorRef.current = '';
        pending.current = targetFrame;
        setLiveOverride(null);
        setSelectedClipId(null);
        setPaused(true);
        setProps(nextProps);
        setCaptureEpoch((n) => n + 1);
        for (let i = 0; i < 120; i++) {
          await nextRaf();
          if (readError()) return { ok: false, error: readError() };
          if (ref.current) break;
        }
        if (ref.current) {
          ref.current.pause();
          ref.current.mute();
          ref.current.seekTo(targetFrame);
        }
        await nextRaf();
        await waitMediaReady(4500);
        await nextRaf();
        await nextRaf();
        const err = readError();
        return err ? { ok: false, error: err } : { ok: true };
      },
      async seek(targetFrame: number): Promise<{ ok: boolean; error?: string }> {
        captureErrorRef.current = '';
        if (ref.current) ref.current.seekTo(targetFrame);
        await nextRaf();
        const host = hostRef.current;
        if (host && host.querySelector('video')) {
          const deadline = Date.now() + 2000;
          while (Date.now() < deadline) {
            const seeking = Array.from(host.querySelectorAll('video')).some((v) => v.seeking || v.readyState < 2);
            if (!seeking) break;
            await nextRaf();
          }
        }
        await nextRaf();
        const err = readError();
        return err ? { ok: false, error: err } : { ok: true };
      },
      clear() {
        captureErrorRef.current = '';
        setProps(null);
      },
    };
    (window as unknown as { __cocraftCapture?: typeof api }).__cocraftCapture = api;
    return () => {
      delete (window as unknown as { __cocraftCapture?: typeof api }).__cocraftCapture;
    };
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (!pausedRef.current || scrubbingRef.current) return;
    if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = 0;
      if (!pausedRef.current || scrubbingRef.current) return;
      const next = measureVisibleBoxes(hostRef.current);
      const serialized = JSON.stringify(next);
      if (serialized !== lastBoxesJson.current) {
        lastBoxesJson.current = serialized;
        notify('boxes', { boxes: next });
      }
    });
  }, []);

  useEffect(() => {
    if (isCaptureMode) return;
    const handleCommand = (msg: any) => {
      if (!msg || msg.source !== 'cocraft-workbench') return;
      if (msg.type === 'load') {
        if (typeof msg.frame === 'number') pending.current = msg.frame;
        scrubbingRef.current = false;
        setLiveOverride(null);
        setProps(msg.props);
        scheduleMeasure();
      }
      if (msg.type === 'play') {
        scrubbingRef.current = false;
        setPaused(false);
        setLiveOverride(null);
        ref.current?.play();
      }
      if (msg.type === 'pause') {
        scrubbingRef.current = false;
        setPaused(true);
        ref.current?.pause();
        scheduleMeasure();
      }
      if (msg.type === 'seek') {
        scrubbingRef.current = Boolean(msg.scrubbing);
        if (ref.current) {
          ref.current.seekTo(msg.frame);
        } else if (typeof msg.frame === 'number') {
          pending.current = msg.frame;
        }
        if (pausedRef.current && !scrubbingRef.current) scheduleMeasure();
      }
      if (msg.type === 'scrub-end') {
        scrubbingRef.current = false;
        if (typeof msg.frame === 'number') {
          if (ref.current) ref.current.seekTo(msg.frame);
          else pending.current = msg.frame;
        }
        if (pausedRef.current) scheduleMeasure();
      }
      if (msg.type === 'selection') {
        setSelectedClipId(msg.selectedClipId ?? null);
        if (pausedRef.current && !scrubbingRef.current) scheduleMeasure();
      }
      if (msg.type === 'live-transform') {
        setLiveOverride(msg.override ?? null);
        scheduleMeasure();
      }
      if (msg.type === 'mute') {
        mutedRef.current = Boolean(msg.muted);
        mutedRef.current ? ref.current?.mute() : ref.current?.unmute();
      }
    };
    const receive = (e: MessageEvent) => {
      if (e.source !== parent || e.data?.source !== 'cocraft-workbench') return;
      if (e.data.type === 'init-channel' && e.ports?.[0]) {
        if (privatePort) {
          privatePort.onmessage = null;
          privatePort.close();
        }
        privatePort = e.ports[0];
        privatePort.onmessage = (pe) => handleCommand(pe.data);
        privatePort.start();
        notify('ready');
        return;
      }
      if (!privatePort) handleCommand(e.data);
    };
    const forwardKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const forward =
        mod ||
        ['Space', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Escape'].includes(e.code) ||
        ['l', 't', 'v', 'b'].includes(e.key.toLowerCase());
      if (forward) {
        e.preventDefault();
        notify('hotkey', {
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        });
      }
    };
    const ro = hostRef.current ? new ResizeObserver(() => scheduleMeasure()) : null;
    if (ro && hostRef.current) ro.observe(hostRef.current);
    window.addEventListener('message', receive);
    window.addEventListener('keydown', forwardKey);
    // Announce readiness on window so parent can transfer the private MessagePort.
    parent.postMessage({ source: 'cocraft-preview', event: 'ready' }, '*');
    return () => {
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      ro?.disconnect();
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', forwardKey);
      if (privatePort) {
        privatePort.onmessage = null;
        privatePort.close();
        privatePort = null;
      }
    };
  }, [scheduleMeasure]);

  const s = props
    ? props.project.sequences.find((seq) => seq.id === props.sequenceId) || props.project.sequences[0]
    : null;

  useEffect(() => {
    if (!paused || !s) return;
    scheduleMeasure();
    const timer = window.setTimeout(scheduleMeasure, 120);
    return () => window.clearTimeout(timer);
  }, [props?.project.revision, s?.id, s?.clips.length, paused, selectedClipId, scheduleMeasure]);

  useEffect(() => {
    const player = ref.current;
    if (!player || !s) return;
    const frame = (e: any) => {
      if (scrubbingRef.current) return;
      notify('frame', { frame: e.detail.frame, playing: !pausedRef.current });
      if (pausedRef.current) scheduleMeasure();
    };
    const play = () => {
      scrubbingRef.current = false;
      setPaused(false);
      setLiveOverride(null);
      notify('play');
    };
    const pause = () => {
      scrubbingRef.current = false;
      setPaused(true);
      notify('pause');
      scheduleMeasure();
    };
    const end = () => {
      scrubbingRef.current = false;
      setPaused(true);
      notify('ended');
      scheduleMeasure();
    };
    player.addEventListener('frameupdate', frame);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    player.addEventListener('ended', end);
    return () => {
      player.removeEventListener('frameupdate', frame);
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
      player.removeEventListener('ended', end);
    };
  }, [s?.id, recoveryEpoch, scheduleMeasure]);

  useEffect(() => {
    const player = ref.current;
    if (!player || !props || !s) return;
    mutedRef.current ? player.mute() : player.unmute();
    const maxFrame = durationOf(s) - 1;
    const current = player.getCurrentFrame();
    if (lastSequenceId.current !== s.id || (pending.current !== null && !player.isPlaying())) {
      const target = Math.max(0, Math.min(pending.current ?? current, maxFrame));
      if (target !== current || lastSequenceId.current !== s.id) {
        player.seekTo(target);
      }
      lastSequenceId.current = s.id;
      pending.current = null;
      notify('frame', { frame: target, playing: player.isPlaying() });
    } else {
      pending.current = null;
      if (current > maxFrame) {
        player.seekTo(maxFrame);
        notify('frame', { frame: maxFrame, playing: player.isPlaying() });
      }
    }
    notify('loaded', { revision: props.project.revision });
    scheduleMeasure();
  }, [props, s, recoveryEpoch, scheduleMeasure]);

  useEffect(() => {
    if (paused && !scrubbingRef.current) scheduleMeasure();
  }, [paused, selectedClipId, liveOverride, scheduleMeasure]);

  const inputProps = useMemo<FilmProps | null>(
    () => (props ? { ...props, paused, selectedClipId, liveOverride } : null),
    [props, paused, selectedClipId, liveOverride],
  );

  if (!props || !s || !inputProps) return <div ref={hostRef} style={{ width: '100%', height: '100vh' }} />;
  return (
    <div ref={hostRef} style={{ width: '100%', height: '100vh' }}>
      <ErrorBoundary
        key={isCaptureMode ? `${s.id}:${captureEpoch}` : s.id}
        revision={props.project.revision}
        sequenceId={s.id}
        onRecover={() => setRecoveryEpoch((n) => n + 1)}
        onError={(msg) => {
          captureErrorRef.current = msg;
        }}
      >
        <Player
          ref={ref}
          component={Film}
          inputProps={inputProps}
          compositionWidth={s.width}
          compositionHeight={s.height}
          fps={s.fps}
          durationInFrames={durationOf(s)}
          style={{ width: '100%', height: '100vh' }}
          controls={false}
          clickToPlay={false}
          spaceKeyToPlayOrPause={false}
          acknowledgeRemotionLicense
          errorFallback={({ error }) => <div style={{ color: '#e7beb6', padding: 20 }}>{error.message}</div>}
        />
      </ErrorBoundary>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
