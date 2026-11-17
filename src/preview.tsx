import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { Film, FilmProps } from './composition/Film';
import { durationOf } from './core/project';
const notify = (event: string, data: Record<string, unknown> = {}) =>
  parent.postMessage({ source: 'cocraft-preview', event, ...data }, '*');
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(e: Error) {
    notify('error', { message: e.message });
  }
  render() {
    return this.state.error ? (
      <div style={{ color: '#d4b1a5', font: '13px -apple-system', padding: 30 }}>
        画面暂时无法加载：{this.state.error}
      </div>
    ) : (
      this.props.children
    );
  }
}
function Preview() {
  const [props, setProps] = useState<FilmProps | null>(null);
  const ref = useRef<PlayerRef>(null);
  const pending = useRef(0);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.source !== parent || e.data?.source !== 'cocraft-workbench') return;
      if (e.data.type === 'load') {
        pending.current = e.data.frame || 0;
        setProps(e.data.props);
      }
      if (e.data.type === 'play') ref.current?.play();
      if (e.data.type === 'pause') ref.current?.pause();
      if (e.data.type === 'seek') ref.current?.seekTo(e.data.frame);
      if (e.data.type === 'mute') {
        e.data.muted ? ref.current?.mute() : ref.current?.unmute();
      }
    };
    window.addEventListener('message', receive);
    notify('ready');
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    const player = ref.current;
    if (!player || !props) return;
    const s = props.project.sequences.find((s) => s.id === props.sequenceId) || props.project.sequences[0];
    player.seekTo(Math.min(pending.current, durationOf(s) - 1));
    notify('loaded', { revision: props.project.revision });
    const frame = (e: any) => notify('frame', { frame: e.detail.frame });
    const play = () => notify('play');
    const pause = () => notify('pause');
    const end = () => notify('ended');
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
  }, [props]);
  if (!props) return null;
  const s = props.project.sequences.find((s) => s.id === props.sequenceId) || props.project.sequences[0];
  return (
    <ErrorBoundary key={props.project.revision + props.sequenceId}>
      <Player
        ref={ref}
        component={Film}
        inputProps={props}
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
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
