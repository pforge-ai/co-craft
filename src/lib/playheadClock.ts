export type PlayheadListener = (frame: number) => void;

/**
 * High-frequency external clock decoupling 60-120fps playhead scrubbing and playback
 * from the heavy root <App> React tree.
 */
export class PlayheadClock {
  private currentFrame: number;
  private listeners = new Set<PlayheadListener>();

  constructor(initialFrame = 0) {
    this.currentFrame = initialFrame;
  }

  get(): number {
    return this.currentFrame;
  }

  set(frame: number): void {
    const next = Math.max(0, Math.round(frame));
    if (next === this.currentFrame) return;
    this.currentFrame = next;
    for (const fn of this.listeners) fn(next);
  }

  subscribe(fn: PlayheadListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
