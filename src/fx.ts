import { Container, Graphics, Text } from 'pixi.js';
import { FONT_FAMILY, PALETTE, SCREEN_H, SCREEN_W } from './config';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
  drag: number;
  grav: number;
}

interface Popup {
  text: Text;
  vy: number;
  life: number;
  max: number;
}

const MAX_PARTICLES = 420;
const MAX_POPUPS = 24;

/**
 * Juice: particles, floating score popups, screen shake, full-screen flashes
 * and a global time scale for hit-stop / slow-mo.
 */
export class Fx {
  readonly layer = new Container();
  readonly flashLayer = new Graphics();

  private readonly g = new Graphics();
  private readonly textLayer = new Container();
  private parts: Particle[] = [];
  private popups: Popup[] = [];
  private pool: Text[] = [];

  private shakeMag = 0;
  private shakeTime = 0;
  private shakeDur = 1;

  private flashLife = 0;
  private flashMax = 1;
  private flashPeak = 0;

  /** Global simulation speed (1 = normal). */
  timeScale = 1;

  constructor() {
    this.layer.addChild(this.g);
    this.layer.addChild(this.textLayer);
    this.flashLayer.rect(0, 0, SCREEN_W, SCREEN_H).fill(PALETTE.white);
    this.flashLayer.alpha = 0;
    this.flashLayer.eventMode = 'none';
  }

  /** Keep the flash overlay covering the whole canvas after a resize. */
  resize(w: number, h: number): void {
    this.flashLayer.clear();
    this.flashLayer.rect(0, 0, w, h).fill(PALETTE.white);
  }

  private rand(a: number, b: number): number {
    return a + Math.random() * (b - a);
  }

  burst(
    x: number,
    y: number,
    color: number,
    count: number,
    opts: { speed?: number; life?: number; size?: number; grav?: number; drag?: number; spread?: number } = {},
  ): void {
    const speed = opts.speed ?? 150;
    const life = opts.life ?? 0.6;
    const size = opts.size ?? 3;
    const grav = opts.grav ?? 220;
    const drag = opts.drag ?? 0.9;
    const spread = opts.spread ?? Math.PI * 2;
    for (let i = 0; i < count && this.parts.length < MAX_PARTICLES; i++) {
      const a = this.rand(-spread / 2, spread / 2) - Math.PI / 2;
      const sp = this.rand(speed * 0.35, speed);
      const l = this.rand(life * 0.6, life);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: l,
        max: l,
        size: this.rand(size * 0.6, size * 1.5),
        color,
        drag,
        grav,
      });
    }
  }

  pop(text: string, x: number, y: number, color = PALETTE.text, size = 12): void {
    let t = this.pool.pop();
    if (!t) {
      t = new Text({
        text,
        style: { fontFamily: FONT_FAMILY, fontSize: size, fill: color, align: 'center' },
      });
      t.anchor.set(0.5);
    }
    t.text = text;
    t.style.fill = color;
    t.style.fontSize = size;
    t.position.set(x, y);
    t.alpha = 1;
    t.scale.set(0.6);
    t.visible = true;
    this.textLayer.addChild(t);
    if (this.popups.length >= MAX_POPUPS) {
      const oldest = this.popups.shift();
      if (oldest) this.recycle(oldest);
    }
    this.popups.push({ text: t, vy: -46, life: 1.1, max: 1.1 });
  }

  private recycle(p: Popup): void {
    p.text.visible = false;
    p.text.removeFromParent();
    if (this.pool.length < MAX_POPUPS) this.pool.push(p.text);
  }

  shake(mag: number, dur = 0.35): void {
    if (mag >= this.shakeMag || this.shakeTime <= 0) {
      this.shakeMag = mag;
      this.shakeDur = dur;
      this.shakeTime = dur;
    }
  }

  flash(color: number, peak = 0.5, dur = 0.3): void {
    this.flashLayer.tint = color;
    this.flashPeak = peak;
    this.flashMax = dur;
    this.flashLife = dur;
  }

  slowmo(scale: number, ease = 2.5): void {
    this.timeScale = scale;
    this._ease = ease;
  }

  private _ease = 2.5;

  /** Returns the current shake offset; call once per frame. */
  updateShake(dt: number): { x: number; y: number } {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / this.shakeDur);
      const m = this.shakeMag * k * k;
      return { x: this.rand(-m, m), y: this.rand(-m, m) };
    }
    this.shakeMag = 0;
    return { x: 0, y: 0 };
  }

  update(dt: number): void {
    const sdt = dt * this.timeScale;

    if (this.timeScale < 1) {
      this.timeScale = Math.min(1, this.timeScale + dt * this._ease);
    }

    // Particles.
    this.g.clear();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= sdt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.grav * sdt;
      const d = Math.pow(p.drag, sdt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      const a = p.life / p.max;
      this.g.circle(p.x, p.y, p.size * (0.4 + a * 0.6));
      this.g.fill({ color: p.color, alpha: a });
    }

    // Popups.
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        this.recycle(pop);
        this.popups.splice(i, 1);
        continue;
      }
      const a = pop.life / pop.max;
      pop.text.y += pop.vy * dt;
      pop.text.alpha = Math.min(1, a * 1.8);
      const s = 0.6 + (1 - a) * 0.55;
      pop.text.scale.set(Math.min(1.15, s));
    }

    // Flash.
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const a = Math.max(0, this.flashLife / this.flashMax);
      this.flashLayer.alpha = a * this.flashPeak;
    } else {
      this.flashLayer.alpha = 0;
    }
  }

  clear(): void {
    this.parts.length = 0;
    this.g.clear();
    for (const p of this.popups) this.recycle(p);
    this.popups.length = 0;
    this.flashLayer.alpha = 0;
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.timeScale = 1;
  }
}
