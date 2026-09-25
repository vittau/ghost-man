import { Graphics } from 'pixi.js';
import { PALETTE } from './config';
import { DIRS } from './types';
import type { Dir } from './types';

// ---------------------------------------------------------------------------
// Procedural vector art. Everything is drawn centred on (0,0) so callers can
// position + rotate the containing display object freely.
// ---------------------------------------------------------------------------

/** Pac-Man disc with an animated wedge mouth. `mouth` is a half-angle in radians. */
export function drawPacman(g: Graphics, r: number, mouth: number, color = PALETTE.pac): void {
  const a = Math.min(Math.PI * 0.48, Math.max(0.02, mouth));
  g.moveTo(0, 0);
  g.arc(0, 0, r, a, Math.PI * 2 - a);
  g.lineTo(0, 0);
  g.fill(color);

  // Specular highlight for a glossy, semi-chrome look.
  g.circle(-r * 0.28, -r * 0.38, r * 0.16);
  g.fill({ color: PALETTE.pacGlow, alpha: 0.55 });
}

export interface GhostStyle {
  color: number;
  dir: Dir;
  frightened?: boolean;
  flash?: boolean;
  eaten?: boolean;
  /** Skirt animation phase. */
  wave?: number;
  /** Positional nudge for the pupils (pixels, at r = 1 scale it's multiplied). */
  lookX?: number;
  lookY?: number;
}

/** Classic ghost: domed head, three-scallop skirt, tracking eyes. */
export function drawGhost(g: Graphics, r: number, style: GhostStyle): void {
  const { dir, frightened = false, flash = false, eaten = false } = style;
  const wave = style.wave ?? 0;
  const yb = r * 0.86; // skirt baseline

  if (!eaten) {
    const body = frightened ? (flash ? PALETTE.frightFlash : PALETTE.frightBody) : style.color;

    g.moveTo(-r, yb);
    g.lineTo(-r, 0);
    g.arc(0, 0, r, Math.PI, Math.PI * 2);
    g.lineTo(r, yb);

    const n = 3;
    const w = (2 * r) / n;
    for (let i = 0; i < n; i++) {
      const xa = r - i * w;
      const xb = xa - w / 2;
      const xc = xa - w;
      const dip = (i % 2 === 0 ? 1 : -0.35) * wave;
      g.quadraticCurveTo(xb, yb + dip, xc, yb);
    }
    g.closePath();
    g.fill(body);

    // Top highlight — glassy dome.
    g.ellipse(-r * 0.3, -r * 0.45, r * 0.34, r * 0.2);
    g.fill({ color: PALETTE.white, alpha: frightened ? 0.1 : 0.16 });
  }

  const ex = r * 0.4;
  const ey = -r * 0.12;
  const erx = r * 0.3;
  const ery = r * 0.36;

  if (frightened && !eaten) {
    // Wide startled whites, no pupils.
    g.ellipse(-ex, ey, erx, ery).fill(PALETTE.eyeWhite);
    g.ellipse(ex, ey, erx, ery).fill(PALETTE.eyeWhite);

    // Zig-zag mouth.
    const mx = r * 0.62;
    const my = r * 0.4;
    const steps = 4;
    g.moveTo(-mx, my);
    for (let i = 1; i <= steps; i++) {
      const xx = -mx + (i * (2 * mx)) / steps;
      g.lineTo(xx, my + (i % 2 === 0 ? 0 : -r * 0.22));
    }
    g.stroke({ width: r * 0.13, color: PALETTE.eyeWhite, cap: 'round', join: 'round' });
    return;
  }

  g.ellipse(-ex, ey, erx, ery).fill(PALETTE.eyeWhite);
  g.ellipse(ex, ey, erx, ery).fill(PALETTE.eyeWhite);

  const look = dir === 'none' ? { x: 0, y: 0 } : DIRS[dir];
  const lx = (style.lookX ?? look.x) * r * 0.15;
  const ly = (style.lookY ?? look.y) * r * 0.17;
  g.circle(-ex + lx, ey + ly, r * 0.17).fill(PALETTE.eyePupil);
  g.circle(ex + lx, ey + ly, r * 0.17).fill(PALETTE.eyePupil);
}

/** The house door: a pulsing bar. */
export function drawDoor(g: Graphics, w: number, h: number, alpha: number): void {
  g.roundRect(-w / 2, -h / 2, w, h, h / 2);
  g.fill({ color: PALETTE.door, alpha });
}
