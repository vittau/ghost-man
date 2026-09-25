import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import { lerpColor, sampleGradient } from './color';
import {
  FONT_FAMILY,
  GHOSTS,
  HUD_W,
  PALETTE,
  SCREEN_H,
  SCREEN_W,
  SKY,
  VIEW_W,
} from './config';
import { drawGhost } from './draw';
import { valueNoise } from './noise';
import type { GhostDef } from './config';

const SKY_STOPS = [SKY.top, SKY.upper, SKY.mid, SKY.lower, SKY.horizon];
const SUN_STOPS = [PALETTE.sunTop, PALETTE.sunMid, PALETTE.sunBot];
const ROW_Y = [40, 128, 216, 304];
const ROW_H = 84;
const HORIZON = SCREEN_H * 0.55;

// Wireframe terrain: a heightmap seen from a camera one unit above the valley
// floor, flying forward. Units are arbitrary world units.
const TERRAIN = {
  zNear: 0.9,
  zFar: 13,
  dz: 0.55, // row spacing
  dx: 0.5, // sample spacing along a row
  colEvery: 2, // a column line every N samples
  speed: 1.1,
};

interface Row {
  def: GhostDef;
  box: Graphics;
  ghost: Graphics;
  name: Text;
  ability: Text;
  desc: Text;
}

const mkText = (
  text: string,
  size: number,
  fill: number,
  align: 'left' | 'center' | 'right' = 'left',
): Text => {
  const t = new Text({ text, style: { fontFamily: FONT_FAMILY, fontSize: size, fill, align } });
  t.anchor.set(align === 'left' ? 0 : align === 'center' ? 0.5 : 1, 0);
  return t;
};

/** 80s chrome lettering: sky above a hard horizon line, sunset below. */
const chromeFill = (): FillGradient =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: PALETTE.chrome0 },
      { offset: 0.46, color: PALETTE.chrome1 },
      { offset: 0.5, color: PALETTE.chrome2 },
      { offset: 0.54, color: PALETTE.sunBot },
      { offset: 0.8, color: PALETTE.sunMid },
      { offset: 1, color: PALETTE.sunTop },
    ],
  });

const CONTROLS: Array<[string, string]> = [
  ['ARROWS/WASD', 'MOVE'],
  ['1-4 / Q E', 'SQUAD STANCE'],
  ['SPACE', 'PINCER'],
  ['SHIFT', 'ABILITY'],
  ['P / ESC', 'PAUSE'],
  ['M', 'CHANGE MUSIC'],
  ['C / F / N', 'CRT/FPS/MUTE'],
];

interface Peak {
  x: number;
  h: number;
}

/**
 * Attract screen. Mirrors the in-game layout: the live demo plays in the
 * viewport on the left, and all UI sits in the right-hand panel column.
 * Vertical positions are fixed; layout() recomputes the horizontal ones.
 */
export class Menu {
  readonly bgLayer = new Container();
  readonly uiLayer = new Container();

  private readonly sky = new Graphics();
  private readonly stars = new Graphics();
  private readonly sun = new Graphics();
  private readonly mountains = new Graphics();
  private readonly floor = new Graphics();

  private readonly panelGfx = new Graphics();
  private readonly scrimGfx = new Graphics();
  private readonly dividers: Graphics[] = [];

  private readonly titleGlow = mkText('GHOST-MAN', 50, PALETTE.accent2, 'center');
  private readonly titlePink = mkText('GHOST-MAN', 50, PALETTE.accent, 'center');
  private readonly title = mkText('GHOST-MAN', 50, PALETTE.chrome1, 'center');
  private readonly subtitle = mkText('YOU ARE THE GHOST', 14, PALETTE.textDim, 'center');
  private readonly highText = mkText('', 12, PALETTE.accent, 'center');
  private readonly prompt = mkText('PRESS SPACE TO START', 16, PALETTE.gold, 'center');

  private readonly chooseText = mkText('CHOOSE YOUR GHOST', 11, PALETTE.accent2);
  private readonly chooseHint = mkText('↑↓', 11, PALETTE.textDim, 'right');
  private readonly controlsTitle = mkText('CONTROLS', 11, PALETTE.accent2);
  private readonly howTitle = mkText('HOW TO WIN', 11, PALETTE.accent2);
  private readonly tipsText = mkText(
    'CATCH HIM 3× TO CLEAR A LEVEL\nIF HE EATS EVERY DOT: -1 LIFE\nPOWER PELLETS TURN THE TABLES',
    10,
    PALETTE.textDim,
  );

  private readonly rows: Row[] = [];
  private readonly controlsKeys: Text[] = [];
  private readonly controlsActions: Text[] = [];
  private readonly audioText = mkText('', 10, PALETTE.accent2);
  private readonly credit = mkText('MUSIC: VANDALORUM / PRIMAL LIGHT\nCC-BY 4.0', 9, PALETTE.textDim);

  private readonly starField: { x: number; y: number; r: number; p: number }[] = [];
  private farPeaks: Peak[] = [];
  private nearPeaks: Peak[] = [];
  private meteor = { x: 0, y: 0, vx: 0, vy: 0, life: 0 };
  private meteorWait = 3;
  private t = 0;

  constructor() {
    this.bgLayer.eventMode = 'none';
    this.uiLayer.eventMode = 'none';
    this.bgLayer.addChild(this.sky, this.stars, this.sun, this.mountains, this.floor);

    for (let i = 0; i < 140; i++) {
      this.starField.push({
        x: Math.random(),
        y: Math.random() * HORIZON * 0.92,
        r: Math.random() * 1.4 + 0.4,
        p: Math.random() * Math.PI * 2,
      });
    }

    for (const t of [this.titleGlow, this.titlePink, this.title]) {
      t.style.letterSpacing = 6;
      t.anchor.set(0.5, 0);
    }
    this.title.style.fill = chromeFill();
    this.title.style.stroke = { color: PALETTE.bgDeep, width: 2 };
    this.subtitle.anchor.set(0.5, 0);
    this.highText.anchor.set(0.5, 0);
    this.prompt.anchor.set(0.5, 0);
    this.tipsText.style.lineHeight = 17;
    this.credit.style.lineHeight = 14;

    this.uiLayer.addChild(
      this.scrimGfx,
      this.panelGfx,
      this.titlePink,
      this.titleGlow,
      this.title,
      this.subtitle,
      this.highText,
      this.prompt,
      this.chooseText,
      this.chooseHint,
      this.controlsTitle,
      this.howTitle,
      this.tipsText,
      this.audioText,
      this.credit,
    );

    this.buildPanel();
    this.layout();
  }

  private buildPanel(): void {
    GHOSTS.forEach((def) => {
      const box = new Graphics();
      const ghost = new Graphics();
      const name = mkText(def.name, 14, def.color);
      const ability = mkText(def.abilityName, 11, PALETTE.text);
      const desc = mkText(def.abilityDesc, 10, PALETTE.textDim);
      desc.style.wordWrap = true;
      desc.style.lineHeight = 14;
      this.uiLayer.addChild(box, ghost, name, ability, desc);
      this.rows.push({ def, box, ghost, name, ability, desc });
    });

    CONTROLS.forEach(([key, action]) => {
      const k = mkText(key, 10, PALETTE.gold);
      const a = mkText(action, 10, PALETTE.text);
      this.controlsKeys.push(k);
      this.controlsActions.push(a);
      this.uiLayer.addChild(k, a);
    });

    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      this.dividers.push(g);
      this.uiLayer.addChild(g);
    }
  }

  /** Jagged ridge line spanning the whole width, lower toward the centre. */
  private makePeaks(count: number, maxH: number, seed: number): Peak[] {
    const out: Peak[] = [];
    let s = seed;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const mid = VIEW_W / 2;
    for (let i = 0; i <= count; i++) {
      const x = (i / count) * SCREEN_W;
      // Valley in the middle of the viewport so the sun sits in a notch.
      const d = Math.min(1, Math.abs(x - mid) / (VIEW_W * 0.42));
      const h = (i % 2 === 0 ? 0.25 : 1) * maxH * (0.35 + 0.65 * rnd()) * (0.12 + 0.88 * d * d);
      out.push({ x, h });
    }
    return out;
  }

  /** Recompute every width-dependent position. Safe to call on resize. */
  layout(): void {
    const panelX = SCREEN_W - HUD_W;
    const cx = panelX + 24;
    const contentW = HUD_W - 48;
    const midX = VIEW_W / 2;

    this.farPeaks = this.makePeaks(34, 120, 7);
    this.nearPeaks = this.makePeaks(22, 80, 13);

    this.panelGfx.clear();
    this.panelGfx.rect(panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.5 });
    this.panelGfx.rect(panelX, 0, 1, SCREEN_H).fill({ color: PALETTE.accent, alpha: 0.35 });

    this.scrimGfx.clear();
    this.scrimGfx.rect(0, 0, VIEW_W, 220).fill({ color: 0x0a0318, alpha: 0.6 });
    this.scrimGfx.rect(0, 220, VIEW_W, 40).fill({ color: 0x0a0318, alpha: 0.3 });

    this.title.position.set(midX, 62);
    this.titleGlow.position.set(midX + 3, 65);
    this.titlePink.position.set(midX - 3, 59);
    this.titleGlow.alpha = 0.9;
    this.titlePink.alpha = 0.75;
    this.subtitle.position.set(midX, 124);
    this.highText.position.set(midX, 150);
    this.prompt.position.set(midX, 178);

    this.chooseText.position.set(cx, 18);
    this.chooseHint.position.set(panelX + HUD_W - 24, 18);

    this.rows.forEach((row, i) => {
      row.ghost.position.set(cx + 24, ROW_Y[i] + 44);
      row.name.position.set(cx + 58, ROW_Y[i] + 10);
      row.ability.position.set(cx + 58, ROW_Y[i] + 32);
      row.desc.position.set(cx + 58, ROW_Y[i] + 50);
      row.desc.style.wordWrapWidth = contentW - 58;
    });

    const dividerY = [400, 576];
    this.dividers.forEach((g, i) => {
      g.clear();
      if (dividerY[i] === undefined) return;
      g.rect(panelX + 20, dividerY[i], HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.22 });
    });

    this.controlsTitle.position.set(cx, 412);
    this.controlsKeys.forEach((k, i) => {
      k.position.set(cx, 434 + i * 20);
      this.controlsActions[i].position.set(cx + 128, 434 + i * 20);
    });

    this.howTitle.position.set(cx, 588);
    this.tipsText.position.set(cx, 610);
    this.audioText.position.set(cx, 676);
    this.credit.position.set(cx, 704);
  }

  update(
    dt: number,
    selected: number,
    high: number,
    phase: 'menu' | 'gameover',
    audioHint = '',
    muted = false,
  ): void {
    this.t += dt;

    this.drawSky();
    this.drawStars(dt);
    this.drawSun();
    this.drawMountains();
    this.drawFloor();

    this.prompt.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 4));
    this.subtitle.text = phase === 'gameover' ? 'GAME OVER' : 'YOU ARE THE GHOST';
    this.subtitle.style.fill = phase === 'gameover' ? PALETTE.danger : PALETTE.textDim;
    this.prompt.text = phase === 'gameover' ? 'PRESS SPACE FOR THE TITLE' : 'PRESS SPACE TO START';
    this.highText.text = high > 0 ? `HIGH SCORE  ${String(high).padStart(6, '0')}` : '';
    this.audioText.text = muted ? 'SOUND MUTED · N' : audioHint;

    const panelX = SCREEN_W - HUD_W;
    this.rows.forEach((row, i) => {
      const active = i === selected;
      const w = HUD_W - 40;
      const x = panelX + 20;
      const y = ROW_Y[i];

      row.box.clear();
      row.box.roundRect(x, y, w, ROW_H, 8).fill({
        color: active ? PALETTE.wallFill : 0x120a26,
        alpha: active ? 0.95 : 0.5,
      });
      if (active) {
        // A wash of the ghost's colour from the left, like a lit arcade marquee.
        for (let k = 0; k < 6; k++) {
          row.box.roundRect(x, y, w * (0.2 + k * 0.12), ROW_H, 8).fill({ color: row.def.color, alpha: 0.03 });
        }
      }
      row.box.roundRect(x, y, w, ROW_H, 8).stroke({
        width: active ? 2 : 1,
        color: active ? row.def.color : PALETTE.wallDim,
        alpha: active ? 1 : 0.55,
      });
      if (active) {
        row.box.roundRect(x - 4, y - 4, w + 8, ROW_H + 8, 10).stroke({
          width: 1,
          color: PALETTE.accent2,
          alpha: 0.5,
        });
      }

      row.ghost.clear();
      const pulse = active ? 1 + Math.sin(this.t * 5) * 0.05 : 1;
      drawGhost(row.ghost, 24 * pulse, {
        color: row.def.color,
        dir: 'left',
        wave: 4 + Math.sin(this.t * 4 + i) * 3,
      });
      row.name.alpha = active ? 1 : 0.7;
      row.ability.alpha = active ? 1 : 0.7;
      row.desc.alpha = active ? 0.95 : 0.6;
    });
  }

  private drawSky(): void {
    this.sky.clear();
    const bands = 56;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const col = sampleGradient(SKY_STOPS, t0);
      this.sky.rect(0, t0 * HORIZON - 1, SCREEN_W, HORIZON / bands + 2).fill(col);
    }
  }

  private drawStars(dt: number): void {
    const g = this.stars;
    g.clear();
    for (const s of this.starField) {
      const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.t * 2 + s.p));
      // Stars fade out as they approach the warm horizon haze.
      const fade = 1 - Math.pow(s.y / HORIZON, 2);
      g.circle(s.x * SCREEN_W, s.y, s.r).fill({ color: PALETTE.white, alpha: a * 0.8 * fade });
    }

    // The occasional shooting star.
    const m = this.meteor;
    if (m.life > 0) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = Math.min(1, m.life * 3);
      g.moveTo(m.x, m.y).lineTo(m.x - m.vx * 0.12, m.y - m.vy * 0.12);
      g.stroke({ width: 2, color: PALETTE.chrome0, alpha: a * 0.8, cap: 'round' });
      g.circle(m.x, m.y, 1.8).fill({ color: PALETTE.white, alpha: a });
    } else {
      this.meteorWait -= dt;
      if (this.meteorWait <= 0) {
        this.meteorWait = 4 + Math.random() * 6;
        const dir = Math.random() < 0.5 ? -1 : 1;
        m.x = Math.random() * SCREEN_W;
        m.y = 20 + Math.random() * HORIZON * 0.35;
        m.vx = dir * (420 + Math.random() * 240);
        m.vy = 120 + Math.random() * 80;
        m.life = 0.7;
      }
    }
  }

  /** The vaporwave sunset: gradient disc whose lower half is sliced by bands that drift down. */
  private drawSun(): void {
    const g = this.sun;
    g.clear();
    const cx = VIEW_W / 2;
    const R = Math.min(190, VIEW_W * 0.2);
    const cy = HORIZON - R * 0.38;

    // Halo first, so the disc sits in a warm haze.
    for (let i = 5; i >= 1; i--) {
      g.circle(cx, cy, R * (1 + i * 0.16)).fill({ color: PALETTE.sunMid, alpha: 0.025 + (5 - i) * 0.006 });
    }

    const top = cy - R;
    const step = 2;
    const scroll = (this.t * 9) % 18;
    for (let y = top; y < HORIZON; y += step) {
      const dy = y + step / 2 - cy;
      if (Math.abs(dy) >= R) continue;
      const t = (y - top) / (2 * R);
      if (t > 0.42) {
        // Slice gaps grow toward the bottom of the disc.
        const gap = (t - 0.42) * 30;
        if ((y - top + scroll) % 18 < gap) continue;
      }
      const hw = Math.sqrt(R * R - dy * dy);
      g.rect(cx - hw, y, hw * 2, step + 0.5).fill(sampleGradient(SUN_STOPS, t * 1.1));
    }
  }

  private drawMountains(): void {
    const g = this.mountains;
    g.clear();
    const layer = (peaks: Peak[], fill: number, edge: number, edgeAlpha: number): void => {
      g.moveTo(0, HORIZON);
      for (const p of peaks) g.lineTo(p.x, HORIZON - p.h);
      g.lineTo(SCREEN_W, HORIZON);
      g.closePath();
      g.fill(fill);

      // Wireframe: ridge line plus struts from each peak down to the base.
      g.moveTo(peaks[0].x, HORIZON - peaks[0].h);
      for (const p of peaks) g.lineTo(p.x, HORIZON - p.h);
      g.stroke({ width: 1.5, color: edge, alpha: edgeAlpha, join: 'round' });
      for (let i = 1; i < peaks.length - 1; i++) {
        const p = peaks[i];
        if (p.h < 12) continue;
        g.moveTo(p.x, HORIZON - p.h).lineTo(peaks[i - 1].x + (p.x - peaks[i - 1].x) * 0.5, HORIZON);
        g.moveTo(p.x, HORIZON - p.h).lineTo(p.x + (peaks[i + 1].x - p.x) * 0.5, HORIZON);
      }
      g.stroke({ width: 1, color: edge, alpha: edgeAlpha * 0.35 });
    };
    layer(this.farPeaks, lerpColor(SKY.mid, SKY.top, 0.55), PALETTE.accent2, 0.35);
    layer(this.nearPeaks, 0x12062a, PALETTE.accent, 0.7);
  }

  /** Terrain height: a flat valley down the middle, hills rising to the sides. */
  private terrainHeight(x: number, z: number): number {
    const ax = Math.abs(x);
    const side = Math.min(1, Math.max(0, (ax - 1.8) / 6));
    if (side <= 0) return 0;
    // Ridged noise folds the field into sharp crests: angular vector peaks
    // rather than rolling dunes.
    const ridge = (v: number): number => 1 - Math.abs(2 * v - 1);
    let n = ridge(valueNoise(x * 0.3, z * 0.3, 11));
    n += ridge(valueNoise(x * 0.75, z * 0.75, 12)) * 0.3;
    n /= 1.3;
    return side * Math.sqrt(side) * n * n * n * 2.6;
  }

  /**
   * Battlezone-style vector landscape. Rows are drawn far to near; each row
   * first fills the area between its ridge line and its own flat-ground line
   * with the floor colour, so nearer hills occlude the wireframe behind them
   * (painter's algorithm). Farther rows always project above a row's ground
   * line, so that band is all the occlusion needed — and it keeps overdraw to
   * the hills themselves.
   */
  private drawFloor(): void {
    const g = this.floor;
    g.clear();
    g.rect(0, HORIZON, SCREEN_W, SCREEN_H - HORIZON).fill(SKY.floor);
    // Horizon glow goes under the terrain so the hills rise in front of it.
    g.rect(0, HORIZON - 3, SCREEN_W, 5).fill({ color: PALETTE.horizon, alpha: 0.8 });
    g.rect(0, HORIZON - 12, SCREEN_W, 12).fill({ color: PALETTE.horizon, alpha: 0.16 });

    const cx = VIEW_W / 2;
    const focal = SCREEN_H - HORIZON; // camera height 1, so z = 1 lands on the bottom edge
    const travel = this.t * TERRAIN.speed;
    const base = Math.floor(travel / TERRAIN.dz);
    const rows = Math.ceil(TERRAIN.zFar / TERRAIN.dz) + 1;
    const projX = (x: number, z: number): number => cx + (x * focal) / z;
    const projY = (h: number, z: number): number => HORIZON + ((1 - h) * focal) / z;
    const colStep = TERRAIN.dx * TERRAIN.colEvery;

    let prevZw = 0;
    let prevZ = 0;
    for (let i = rows; i >= 0; i--) {
      const zw = (base + i) * TERRAIN.dz;
      const z = zw - travel;
      if (z < TERRAIN.zNear) continue;
      const fog = Math.max(0, Math.min(1, 1 - (z - TERRAIN.zNear) / (TERRAIN.zFar - TERRAIN.zNear)));

      // World-x range visible on this row, padded a little past each edge.
      const xMin = ((-40 - cx) * z) / focal;
      const xMax = ((SCREEN_W + 40 - cx) * z) / focal;

      // Column struts back to the previous (farther) row.
      if (prevZ > 0) {
        for (let x = Math.ceil(xMin / colStep) * colStep; x <= xMax; x += colStep) {
          g.moveTo(projX(x, prevZ), projY(this.terrainHeight(x, prevZw), prevZ));
          g.lineTo(projX(x, z), projY(this.terrainHeight(x, zw), z));
        }
        g.stroke({ width: 1, color: PALETTE.grid, alpha: 0.12 + fog * 0.3 });
      }

      // Distant rows get sparser samples: keep them ~10px apart on screen.
      const step = TERRAIN.dx * Math.max(1, Math.floor((10 * z) / (focal * TERRAIN.dx)));
      const pts: number[] = [];
      for (let x = Math.floor(xMin / step) * step; x <= xMax + step; x += step) {
        pts.push(projX(x, z), projY(this.terrainHeight(x, zw), z));
      }

      const ground = projY(0, z);
      g.moveTo(pts[0], ground);
      for (let k = 0; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
      g.lineTo(pts[pts.length - 2], ground);
      g.closePath();
      g.fill(SKY.floor);

      g.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
      g.stroke({
        width: 1 + fog * 0.6,
        color: lerpColor(PALETTE.accent2, PALETTE.grid, 0.35 + fog * 0.65),
        alpha: 0.14 + fog * 0.5,
        join: 'round',
      });
      prevZw = zw;
      prevZ = z;
    }

    // Sun reflection smeared across the flat valley floor.
    for (let i = 0; i < 6; i++) {
      const y = HORIZON + 6 + i * i * 5;
      const w = 150 - i * 18;
      g.rect(cx - w, y, w * 2, 2 + i * 0.4).fill({ color: PALETTE.sunMid, alpha: 0.18 - i * 0.025 });
    }
  }

  setVisible(visible: boolean): void {
    this.bgLayer.visible = visible;
    this.uiLayer.visible = visible;
  }
}
