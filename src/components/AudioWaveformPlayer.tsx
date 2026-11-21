import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { pointerDrag } from '../lib/pointerDrag';

interface SingletonAudioState {
  id: string | null;
  audio: HTMLAudioElement | null;
  progress: number;
  duration: number;
  playing: boolean;
  listeners: Set<() => void>;
}

const audioBus: SingletonAudioState = {
  id: null,
  audio: null,
  progress: 0,
  duration: 0,
  playing: false,
  listeners: new Set(),
};

function emitBus() {
  for (const fn of audioBus.listeners) fn();
}

let rafTimer = 0;
function stopTicker() {
  if (rafTimer) {
    cancelAnimationFrame(rafTimer);
    rafTimer = 0;
  }
}

function tickAudio() {
  stopTicker();
  if (!audioBus.playing || !audioBus.audio) return;
  const dur = Number.isFinite(audioBus.audio.duration) && audioBus.audio.duration > 0 ? audioBus.audio.duration : audioBus.duration;
  if (dur > 0) {
    audioBus.duration = dur;
    audioBus.progress = Math.max(0, Math.min(1, audioBus.audio.currentTime / dur));
    emitBus();
  }
  rafTimer = requestAnimationFrame(tickAudio);
}

function ensureAudio(id: string, url: string, fallbackDuration: number) {
  if (audioBus.id === id && audioBus.audio) return audioBus.audio;
  stopTicker();
  if (audioBus.audio) {
    audioBus.audio.pause();
    audioBus.audio.onended = null;
    audioBus.audio.onerror = null;
  }
  const el = new Audio(url);
  el.preload = 'metadata';
  audioBus.id = id;
  audioBus.audio = el;
  audioBus.playing = false;
  audioBus.progress = 0;
  audioBus.duration = Math.max(0.1, fallbackDuration);
  el.onloadedmetadata = () => {
    if (audioBus.id === id && Number.isFinite(el.duration) && el.duration > 0) {
      audioBus.duration = el.duration;
      emitBus();
    }
  };
  el.onended = () => {
    if (audioBus.id !== id) return;
    stopTicker();
    audioBus.playing = false;
    audioBus.progress = 0;
    emitBus();
  };
  el.onerror = () => {
    if (audioBus.id !== id) return;
    stopTicker();
    audioBus.playing = false;
    emitBus();
  };
  emitBus();
  return el;
}

export function stopAllAudioPreviews() {
  stopTicker();
  if (audioBus.audio) {
    audioBus.audio.pause();
    audioBus.audio = null;
  }
  audioBus.id = null;
  audioBus.playing = false;
  audioBus.progress = 0;
  emitBus();
}

function fmtAudioSec(sec: number): string {
  const s = Math.max(0, sec);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem.toFixed(1)}`;
}

export const AudioWaveformPlayer = React.memo(function AudioWaveformPlayer({
  id,
  name,
  url,
  duration,
  waveform,
  compact = false,
}: {
  id: string;
  name: string;
  url: string;
  duration: number;
  waveform?: number[];
  compact?: boolean;
}) {
  const [, setTick] = useState(0);
  const [localRatio, setLocalRatio] = useState(0);
  const waveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    audioBus.listeners.add(fn);
    return () => {
      audioBus.listeners.delete(fn);
    };
  }, []);

  const isActive = audioBus.id === id;
  const isPlaying = isActive && audioBus.playing;
  const activeDuration = isActive && audioBus.duration > 0 ? audioBus.duration : Math.max(0.1, duration || 1);
  const progress = isActive ? audioBus.progress : localRatio;

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = ensureAudio(id, url, duration);
    if (isPlaying) {
      el.pause();
      stopTicker();
      audioBus.playing = false;
      emitBus();
      return;
    }
    const targetSec = (isActive ? audioBus.progress : localRatio) * activeDuration;
    if (targetSec > 0 && targetSec < activeDuration - 0.05) {
      try {
        el.currentTime = targetSec;
      } catch {}
    }
    audioBus.playing = true;
    emitBus();
    tickAudio();
    void el.play().catch(() => {
      stopTicker();
      audioBus.playing = false;
      emitBus();
    });
  };

  const seekToClientX = (clientX: number) => {
    const box = waveRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    setLocalRatio(ratio);
    const el = ensureAudio(id, url, duration);
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : activeDuration;
    audioBus.duration = total;
    audioBus.progress = ratio;
    try {
      el.currentTime = ratio * total;
    } catch {}
    emitBus();
  };

  const bars = useMemo(() => {
    const count = compact ? 22 : 30;
    return Array.from({ length: count }, (_, idx) => {
      const val = waveform?.length
        ? waveform[Math.min(waveform.length - 1, Math.floor((idx / count) * waveform.length))] || 0.2
        : 0.22 + ((idx * 37) % 62) / 100;
      return Math.max(16, Math.round(val * 100));
    });
  }, [waveform, compact]);

  const currentSec = progress * activeDuration;

  return (
    <div
      className={`cc-audio-player ${compact ? 'compact' : ''} ${isPlaying ? 'playing' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`cc-audio-play-btn ${isPlaying ? 'playing' : ''}`}
        aria-label={isPlaying ? `暂停试听 ${name}` : `试听 ${name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={togglePlay}
      >
        {isPlaying ? <Pause size={11} /> : <Play size={11} style={{ marginLeft: 1 }} />}
      </button>

      <div
        ref={waveRef}
        className="cc-audio-wave interactive"
        role="slider"
        aria-label={`${name} 试听进度`}
        aria-valuemin={0}
        aria-valuemax={Math.round(activeDuration * 10)}
        aria-valuenow={Math.round(currentSec * 10)}
        draggable={false}
        onPointerDown={(e) => {
          e.stopPropagation();
          seekToClientX(e.clientX);
          pointerDrag(
            e,
            (mx) => seekToClientX(mx),
            undefined,
            'ew-resize',
          );
        }}
      >
        {bars.map((pct, i) => {
          const filled = (i + 0.5) / bars.length <= progress;
          return <i key={i} className={filled ? 'played' : ''} style={{ height: `${pct}%` }} />;
        })}
        <span className="cc-audio-needle" style={{ left: `${(progress * 100).toFixed(2)}%` }} />
      </div>

      <span className="cc-audio-timecode" title="当前进度 / 总时长">
        {fmtAudioSec(currentSec)} / {fmtAudioSec(activeDuration)}
      </span>
    </div>
  );
});
