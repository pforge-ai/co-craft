import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { Film, FilmProps } from './composition/Film';
import { durationOf } from './core/project';

const notify = (event: string, data: Record<string, unknown> = {}) =>
  parent.postMessage({ source: 'cocraft-preview', event, ...data }, '*');

class ErrorBoundary extends React.Component<
  { revision: number; sequenceId: string; children: React.ReactNode },
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
      this.setState({ error: '' });
    }
  }
  componentDidCatch(e: Error) {
    notify('error', { message: e.message });
  }
  render() {
    return this.state.error ? (
      <div style={{ color: '#e5a99e', font: '13px -apple-system, BlinkMacSystemFont, sans-serif', padding: 30 }}>
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
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [liveOverride, setLiveOverride] = useState<{ clipId: string; props: Record<string, unknown> } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const ref = useRef<PlayerRef>(null);
  const pending = useRef<number | null>(0);
  const lastSequenceId = useRef('');
  const lastBoxesJson = useRef('');
  const pausedRef = useRef(true);
  const scrubbingRef = useRef(false);
  const measureRafRef = useRef<number>(0);
  pausedRef.current = paused;

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
    const receive = (e: MessageEvent) => {
      if (e.source !== parent || e.data?.source !== 'cocraft-workbench') return;
      if (e.data.type === 'load') {
        if (typeof e.data.frame === 'number') pending.current = e.data.frame;
        scrubbingRef.current = false;
        setLiveOverride(null);
        setProps(e.data.props);
        scheduleMeasure();
      }
      if (e.data.type === 'play') {
        scrubbingRef.current = false;
        setPaused(false);
        setLiveOverride(null);
        ref.current?.play();
      }
      if (e.data.type === 'pause') {
        scrubbingRef.current = false;
        setPaused(true);
        ref.current?.pause();
        scheduleMeasure();
      }
      if (e.data.type === 'seek') {
        scrubbingRef.current = Boolean(e.data.scrubbing);
        ref.current?.seekTo(e.data.frame);
        if (pausedRef.current && !scrubbingRef.current) scheduleMeasure();
      }
      if (e.data.type === 'scrub-end') {
        scrubbingRef.current = false;
        if (typeof e.data.frame === 'number') ref.current?.seekTo(e.data.frame);
        if (pausedRef.current) scheduleMeasure();
      }
      if (e.data.type === 'selection') {
        setSelectedClipId(e.data.selectedClipId ?? null);
        if (pausedRef.current && !scrubbingRef.current) scheduleMeasure();
      }
      if (e.data.type === 'live-transform') {
        setLiveOverride(e.data.override ?? null);
        scheduleMeasure();
      }
      if (e.data.type === 'mute') {
        e.data.muted ? ref.current?.mute() : ref.current?.unmute();
      }
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
    notify('ready');
    return () => {
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      ro?.disconnect();
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', forwardKey);
    };
  }, [scheduleMeasure]);

  const s = props
    ? props.project.sequences.find((seq) => seq.id === props.sequenceId) || props.project.sequences[0]
    : null;

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
  }, [s?.id, scheduleMeasure]);

  useEffect(() => {
    const player = ref.current;
    if (!player || !props || !s) return;
    const maxFrame = durationOf(s) - 1;
    const current = player.getCurrentFrame();
    if (lastSequenceId.current !== s.id || (pending.current !== null && !player.isPlaying())) {
      const target = Math.max(0, Math.min(pending.current ?? current, maxFrame));
      if (target !== current || lastSequenceId.current !== s.id) {
        player.seekTo(target);
      }
      lastSequenceId.current = s.id;
      pending.current = null;
    } else if (current > maxFrame) {
      player.seekTo(maxFrame);
    }
    notify('loaded', { revision: props.project.revision });
    scheduleMeasure();
  }, [props, s, scheduleMeasure]);

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
      <ErrorBoundary key={s.id} revision={props.project.revision} sequenceId={s.id}>
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
