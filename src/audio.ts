/**
 * Procedural WebAudio synth — no audio files.
 *
 * Everything (SFX, the siren, the synthwave music loop) is generated from
 * oscillators at runtime, which keeps the bundle tiny and offline-friendly.
 * All entry points are safe to call before the AudioContext exists; audio
 * simply stays silent until `resume()` is called from a user gesture.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  muted = false;
  private musicOn = false;
  private nextNoteTime = 0;
  private step = 0;
  private readonly stepDur = 0.125; // 16th notes @ 120 BPM

  // A minor i - VI - III - VII, low roots.
  private readonly progression = [55.0, 43.65, 65.41, 49.0];

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  resume(): void {
    if (!this.ensure() || !this.ctx) return;
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      when?: number;
      slideTo?: number;
      bus?: GainNode | null;
      attack?: number;
    } = {},
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    }
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // --- SFX -----------------------------------------------------------------

  waka(alt: boolean): void {
    this.tone(alt ? 340 : 240, 0.085, { type: 'square', gain: 0.16, slideTo: alt ? 200 : 150 });
  }

  powerUp(): void {
    this.tone(160, 0.5, { type: 'sawtooth', gain: 0.18, slideTo: 900 });
  }

  eatGhost(): void {
    [440, 660, 880, 1320].forEach((f, i) =>
      this.tone(f, 0.09, { type: 'square', gain: 0.16, when: i * 0.06 }),
    );
  }

  fruit(): void {
    this.tone(880, 0.08, { type: 'triangle', gain: 0.18 });
    this.tone(1320, 0.12, { type: 'triangle', gain: 0.18, when: 0.09 });
  }

  death(): void {
    this.tone(700, 1.1, { type: 'sawtooth', gain: 0.2, slideTo: 55 });
    this.tone(350, 1.1, { type: 'square', gain: 0.08, slideTo: 40, when: 0.05 });
  }

  catchPac(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone(f, 0.14, { type: 'square', gain: 0.18, when: i * 0.07 }),
    );
  }

  pincer(): void {
    [220, 330, 440].forEach((f) => this.tone(f, 0.4, { type: 'sawtooth', gain: 0.12 }));
    this.tone(880, 0.5, { type: 'triangle', gain: 0.1, slideTo: 220 });
  }

  ability(): void {
    this.tone(500, 0.22, { type: 'sawtooth', gain: 0.16, slideTo: 1400 });
  }

  /** Your ability is charged again: a short, bright chime. */
  abilityReady(): void {
    this.tone(1318, 0.09, { type: 'triangle', gain: 0.15 });
    this.tone(1976, 0.16, { type: 'triangle', gain: 0.13, when: 0.07 });
  }

  /** Clyde's BLINDSIDE: the sharp two-note "!" sting. */
  alert(): void {
    this.tone(988, 0.07, { type: 'square', gain: 0.17 });
    this.tone(1480, 0.26, { type: 'square', gain: 0.16, when: 0.07, slideTo: 1400 });
  }

  banished(): void {
    [660, 440, 330].forEach((f, i) =>
      this.tone(f, 0.16, { type: 'square', gain: 0.15, when: i * 0.08, slideTo: f * 0.6 }),
    );
  }

  levelClear(): void {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
      this.tone(f, 0.16, { type: 'triangle', gain: 0.18, when: i * 0.1 }),
    );
  }

  gameOver(): void {
    [440, 392, 349, 262].forEach((f, i) =>
      this.tone(f, 0.4, { type: 'sawtooth', gain: 0.16, when: i * 0.22, slideTo: f * 0.8 }),
    );
  }

  uiSelect(): void {
    this.tone(660, 0.06, { type: 'square', gain: 0.14 });
  }

  uiConfirm(): void {
    this.tone(660, 0.08, { type: 'square', gain: 0.16 });
    this.tone(990, 0.14, { type: 'square', gain: 0.16, when: 0.08 });
  }

  ready(): void {
    [523, 659, 784].forEach((f, i) =>
      this.tone(f, 0.18, { type: 'triangle', gain: 0.16, when: i * 0.14 }),
    );
  }

  /** Rising danger chirp; `intensity` 0..1. */
  siren(intensity: number): void {
    const base = 150 + intensity * 260;
    this.tone(base, 0.42, { type: 'sawtooth', gain: 0.07, slideTo: base * 1.5, attack: 0.05 });
    this.tone(base * 1.5, 0.42, { type: 'sawtooth', gain: 0.05, slideTo: base, attack: 0.05 });
  }

  // --- Music ---------------------------------------------------------------

  startMusic(): void {
    if (!this.ensure() || !this.ctx) return;
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
  }

  stopMusic(): void {
    this.musicOn = false;
  }

  /** Call every frame; schedules a lookahead window of the loop. */
  updateMusic(): void {
    if (!this.musicOn || !this.ctx || !this.musicBus || this.muted) return;
    const ctx = this.ctx;
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this.stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private scheduleStep(step: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const bar = (step / 16) | 0;
    const s = step % 16;
    const root = this.progression[bar];

    // Kick.
    if (s % 4 === 0) this.kick(time, root);
    // Hat.
    if (s % 2 === 1) this.tone(7000, 0.025, { type: 'square', gain: 0.028, when: time - ctx.currentTime, bus: this.musicBus });

    // Syncopated bass.
    const bassPattern: Record<number, number> = { 0: 1, 3: 1, 6: 1, 8: 1, 11: 2, 14: 1.5 };
    const mult = bassPattern[s];
    if (mult) {
      this.tone(root * mult, 0.22, {
        type: 'sawtooth',
        gain: 0.13,
        when: time - ctx.currentTime,
        bus: this.musicBus,
      });
    }

    // Pad chord at the top of each bar.
    if (s === 0) {
      const third = root * 1.2;
      const fifth = root * 1.5;
      const octave = root * 2;
      for (const f of [root * 2, third * 2, fifth * 2, octave * 2]) {
        this.tone(f, 2.0, {
          type: 'triangle',
          gain: 0.035,
          when: time - ctx.currentTime,
          bus: this.musicBus,
          attack: 0.35,
        });
      }
    }
  }

  private kick(time: number, root: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    const when = time - ctx.currentTime;
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.14);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.5, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.24);
    void when;
    void root;
  }
}
