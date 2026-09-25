import { FillGradient, Graphics } from 'pixi.js';
import { PALETTE } from './config';
import { lerpColor } from './color';
import { DIRS } from './types';
import type { Dir } from './types';

// ---------------------------------------------------------------------------
// Procedural vector art. Everything is drawn centred on (0,0) so callers can
// position + rotate the containing display object freely.
// ---------------------------------------------------------------------------

/** Rim tone for Pac-Man's shading: the yellow pushed toward sunset orange. */
const PAC_RIM = lerpColor(PALETTE.pac, 0xff7a3d, 0.5);

/**
 * Pac-Man disc with an animated wedge mouth. `mouth` is a half-angle in radians.
 * `rotation` is the rotation the caller applies to the view; the specular
 * highlight counter-rotates so the light always comes from the top-left.
 */
export function drawPacman(
  g: Graphics,
  r: number,
  mouth: number,
  color = PALETTE.pac,
  rotation = 0,
): void {
  const a = Math.min(Math.PI * 0.48, Math.max(0.02, mouth));
  const wedge = (rr: number, c: number): void => {
    g.moveTo(0, 0);
    g.arc(0, 0, rr, a, Math.PI * 2 - a);
    g.lineTo(0, 0);
    g.fill(c);
  };

  // Concentric wedges share the mouth edges, so only the arc picks up the
  // warmer rim — a cheap spherical shade that survives any mouth angle.
  wedge(r, color === PALETTE.pac ? PAC_RIM : lerpColor(color, 0x000000, 0.25));
  wedge(r * 0.84, color);

  // Specular highlight for a glossy, semi-chrome look (fixed to world space).
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const hx = -r * 0.3;
  const hy = -r * 0.4;
  const sx = hx * cos - hy * sin;
  const sy = hx * sin + hy * cos;
  g.circle(sx, sy, r * 0.2).fill({ color: PALETTE.pacGlow, alpha: 0.35 });
  g.circle(sx, sy, r * 0.1).fill({ color: PALETTE.white, alpha: 0.7 });
}

export interface GhostStyle {
  color: number;
  dir: Dir;
  frightened?: boolean;
  flash?: boolean;
  eaten?: boolean;
  /** Skirt ripple phase, in scallops (see `ghostPath`). */
  wave?: number;
  /** Positional nudge for the pupils (pixels, at r = 1 scale it's multiplied). */
  lookX?: number;
  lookY?: number;
}

// Vertical body gradients are cached per colour: FillGradient owns a texture,
// so building one per ghost per frame would churn GPU memory.
const bodyGradients = new Map<number, FillGradient>();

function bodyGradient(color: number): FillGradient {
  let grad = bodyGradients.get(color);
  if (!grad) {
    grad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: lerpColor(color, PALETTE.white, 0.38) },
        { offset: 0.42, color },
        { offset: 1, color: lerpColor(color, PALETTE.bgDeep, 0.42) },
      ],
    });
    bodyGradients.set(color, grad);
  }
  return grad;
}

/** Skirt ripple speed, in scallops per second. */
export const SKIRT_RATE = 3.2;
const SKIRT_LOBES = 3;
const SKIRT_STEPS = 24;

/**
 * Trace the ghost outline (dome + scalloped skirt) as the current path. The
 * scallops ripple sideways as `wave` advances (one scallop per unit), like the
 * arcade ghosts' wriggling hem; a negative rate sends the ripple the other way.
 */
export function ghostPath(g: Graphics, r: number, wave: number, x = 0, y = 0): void {
  const yb = y + r * 0.86; // skirt baseline
  const depth = r * 0.3;
  g.moveTo(x - r, yb);
  g.lineTo(x - r, y);
  g.arc(x, y, r, Math.PI, Math.PI * 2);
  for (let i = 0; i <= SKIRT_STEPS; i++) {
    const u = i / SKIRT_STEPS; // 0 at the right edge, 1 at the left
    const lobe = Math.abs(Math.sin(Math.PI * (u * SKIRT_LOBES + wave)));
    g.lineTo(x + r - u * 2 * r, yb + depth * lobe);
  }
  g.closePath();
}

/** Flat ghost silhouette, used for afterimages and trails. */
export function drawGhostSilhouette(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  wave: number,
  color: number,
  alpha: number,
): void {
  ghostPath(g, r, wave, x, y);
  g.fill({ color, alpha });
}

/** Classic ghost: domed head, three-scallop skirt, tracking eyes. */
export function drawGhost(g: Graphics, r: number, style: GhostStyle): void {
  const { dir, frightened = false, flash = false, eaten = false } = style;
  const wave = style.wave ?? 0;

  if (!eaten) {
    const body = frightened ? (flash ? PALETTE.frightFlash : PALETTE.frightBody) : style.color;

    ghostPath(g, r, wave);
    g.fill(bodyGradient(body));

    // Rim light along the upper-left of the dome, plus a glassy highlight. The
    // explicit moveTo keeps the arc from being joined to the skirt's last point.
    const rim = r * 0.8;
    const a0 = Math.PI * 1.12;
    g.moveTo(Math.cos(a0) * rim, Math.sin(a0) * rim);
    g.arc(0, 0, rim, a0, Math.PI * 1.4);
    g.stroke({ width: r * 0.09, color: PALETTE.white, alpha: frightened ? 0.18 : 0.4, cap: 'round' });
    g.ellipse(-r * 0.3, -r * 0.45, r * 0.34, r * 0.2);
    g.fill({ color: PALETTE.white, alpha: frightened ? 0.08 : 0.12 });
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
  // A catch-light in each pupil makes the eyes read as glossy, not painted on.
  g.circle(-ex + lx - r * 0.06, ey + ly - r * 0.07, r * 0.055).fill({ color: PALETTE.white, alpha: 0.85 });
  g.circle(ex + lx - r * 0.06, ey + ly - r * 0.07, r * 0.055).fill({ color: PALETTE.white, alpha: 0.85 });
}

/** Four-point star flare, the classic lens glint. */
export function drawSparkle(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  alpha: number,
  rotation = 0,
): void {
  const w = size * 0.22;
  for (let k = 0; k < 4; k++) {
    const a = rotation + (k * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.moveTo(x + ca * size, y + sa * size);
    g.lineTo(x - sa * w, y + ca * w);
    g.lineTo(x + sa * w, y - ca * w);
    g.closePath();
  }
  g.fill({ color, alpha });
}

/** The house door: a pulsing bar with a white-hot neon core. */
export function drawDoor(g: Graphics, w: number, h: number, alpha: number): void {
  g.roundRect(-w / 2, -h / 2 - 3, w, h + 6, (h + 6) / 2);
  g.fill({ color: PALETTE.door, alpha: alpha * 0.25 });
  g.roundRect(-w / 2, -h / 2, w, h, h / 2);
  g.fill({ color: PALETTE.door, alpha });
  g.roundRect(-w / 2 + 3, -0.75, w - 6, 1.5, 0.75);
  g.fill({ color: PALETTE.white, alpha: Math.min(1, alpha + 0.2) });
}
