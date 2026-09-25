/**
 * Background music from bundled MP3s (see README for attribution).
 *
 * Browsers block audio until a user gesture, so we can't rely on playback
 * starting on load. Instead we:
 *   1. create the element and start *buffering* immediately (no gesture needed),
 *   2. attempt playback anyway (it succeeds if the browser allows it),
 *   3. retry on the first key/pointer gesture, which then starts instantly.
 *
 * Each track gets its own lazily-created <audio> element so previously-played
 * tracks stay warm in the browser cache. Volume is ramped per frame for smooth
 * fade-ins/crossfades and for ducking while paused.
 */
export interface MusicConfig {
  menu: string;
  /** One track per 5 levels, cycled. */
  levels: string[];
  /** Display names, matching [menu, ...levels]. */
  names?: string[];
}

const LEVELS_PER_TRACK = 5;

export class MusicPlayer {
  private readonly srcs: string[];
  private readonly names: string[];
  private readonly els = new Map<number, HTMLAudioElement>();
  private readonly vols = new Map<number, number>();

  private idx = -1;
  private target = 0;
  private readonly base = 0.5;
  private muted = false;
  private ducked = false;
  private unlocked = false;

  constructor(config: MusicConfig) {
    this.srcs = [config.menu, ...config.levels];
    this.names = config.names ?? [];
    // Start pulling the menu track the moment the game boots.
    this.element(0);
  }

  get available(): boolean {
    return this.srcs.length > 0;
  }

  get trackName(): string {
    return this.names[this.idx] ?? '';
  }

  /** True once a user gesture has let us actually play audio. */
  get unlockedFlag(): boolean {
    return this.unlocked;
  }

  /** True when the current track has buffered enough to play immediately. */
  get buffered(): boolean {
    const el = this.idx >= 0 ? this.els.get(this.idx) : undefined;
    return !!el && el.readyState >= 3; // HAVE_FUTURE_DATA
  }

  private element(i: number): HTMLAudioElement | null {
    if (i < 0 || i >= this.srcs.length) return null;
    let el = this.els.get(i);
    if (el) return el;
    try {
      el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      el.src = this.srcs[i];
      el.load(); // begin buffering right away
    } catch {
      return null;
    }
    this.els.set(i, el);
    this.vols.set(i, 0);
    return el;
  }

  /** Warm a track's cache without playing it. */
  prefetch(i: number): void {
    this.element(i);
  }

  play(idx: number): void {
    if (idx < 0 || idx >= this.srcs.length) return;
    const el = this.element(idx);
    if (!el) return;
    if (this.idx !== idx) {
      this.idx = idx;
      this.vols.set(idx, 0);
      try {
        el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    }
    this.target = this.computeTarget();
    void el.play().catch(() => {
      /* blocked until a gesture; unlock() retries */
    });
  }

  /** Called from the first key/pointer gesture. */
  unlock(): void {
    this.unlocked = true;
    if (this.idx >= 0) void this.els.get(this.idx)?.play().catch(() => {});
  }

  playMenu(): void {
    this.play(0);
  }

  /** Manually advance to the next track (wraps). */
  cycle(): void {
    const n = this.srcs.length;
    if (n === 0) return;
    this.play((this.idx + 1 + n) % n);
  }

  /** Levels 1-5 → track 1, 6-10 → track 2, … cycling. */
  playForLevel(level: number): void {
    const count = Math.max(1, this.srcs.length - 1);
    const i = Math.floor((Math.max(1, level) - 1) / LEVELS_PER_TRACK) % count;
    this.play(1 + i);
    // Warm the next act's track in the background.
    this.prefetch(1 + ((i + 1) % count));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.target = this.computeTarget();
  }

  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.target = this.computeTarget();
  }

  private computeTarget(): number {
    if (this.muted) return 0;
    return this.base * (this.ducked ? 0.28 : 1);
  }

  update(dt: number): void {
    const rate = 1.6;
    for (const [i, el] of this.els) {
      const goal = i === this.idx ? this.target : 0;
      let v = this.vols.get(i) ?? 0;
      if (v < goal) v = Math.min(goal, v + dt * rate);
      else if (v > goal) v = Math.max(goal, v - dt * rate * 2.5);
      this.vols.set(i, v);
      el.volume = Math.max(0, Math.min(1, v));
      if (i !== this.idx && v <= 0.001 && !el.paused) el.pause();
    }
  }

  stop(): void {
    for (const el of this.els.values()) el.pause();
    this.idx = -1;
    this.target = 0;
  }
}
