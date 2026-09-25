import { Container, Graphics, Text } from 'pixi.js';
import { sampleGradient } from './color';
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
import type { GhostDef } from './config';

const SKY_STOPS = [SKY.top, SKY.upper, SKY.mid, SKY.lower, SKY.horizon];
const ROW_Y = [52, 148, 244, 340];

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

const CONTROLS: Array<[string, string]> = [
  ['ARROWS / WASD', 'MOVE'],
  ['1-4  /  Q E', 'SQUAD STANCE'],
  ['SPACE', 'PINCER'],
  ['SHIFT', 'ABILITY'],
  ['P / ESC', 'PAUSE'],
  ['M', 'CHANGE MUSIC'],
  ['C / F / N', 'CRT / FPS / MUTE'],
];

/**
 * Attract screen. Mirrors the in-game layout: the live demo plays in the
 * viewport on the left, and all UI sits in the right-hand panel column.
 * Vertical positions are fixed; layout() recomputes the horizontal ones.
 */
export class Menu {
  readonly bgLayer = new Container();
  readonly uiLayer = new Container();

  private readonly bg = new Graphics();
  private readonly stars = new Graphics();
  private readonly glow = new Graphics();

  private readonly panelGfx = new Graphics();
  private readonly scrimGfx = new Graphics();
  private readonly dividers: Graphics[] = [];

  private readonly titleGlow = mkText('GHOST-MAN', 50, PALETTE.accent2, 'center');
  private readonly titlePink = mkText('GHOST-MAN', 50, PALETTE.accent, 'center');
  private readonly title = mkText('GHOST-MAN', 50, PALETTE.chrome1, 'center');
  private readonly subtitle = mkText('YOU ARE THE GHOST', 11, PALETTE.textDim, 'center');
  private readonly highText = mkText('', 9, PALETTE.accent, 'center');
  private readonly prompt = mkText('PRESS SPACE TO START', 13, PALETTE.gold, 'center');

  private readonly chooseText = mkText('CHOOSE YOUR GHOST', 9, PALETTE.accent2);
  private readonly chooseHint = mkText('↑↓ SELECT', 7, PALETTE.textDim, 'right');
  private readonly controlsTitle = mkText('CONTROLS', 9, PALETTE.accent2);
  private readonly howTitle = mkText('HOW TO WIN', 9, PALETTE.accent2);
  private readonly tipsText = mkText(
    'CATCH PAC-MAN 3 TIMES TO CLEAR A LEVEL\nHIM CLEARING EVERY DOT COSTS YOU A LIFE\nPOWER PELLETS FLIP HIM INTO THE HUNTER',
    7,
    PALETTE.textDim,
  );

  private readonly rows: Row[] = [];
  private readonly controlsKeys: Text[] = [];
  private readonly controlsActions: Text[] = [];
  private readonly audioText = mkText('', 7, PALETTE.accent2);
  private readonly credit = mkText('MUSIC BY VANDALORUM / PRIMAL LIGHT · CC-BY 4.0', 6, PALETTE.textDim);

  private readonly starField: { x: number; y: number; r: number; p: number }[] = [];
  private t = 0;

  constructor() {
    this.bgLayer.eventMode = 'none';
    this.uiLayer.eventMode = 'none';
    this.bgLayer.addChild(this.stars, this.bg, this.glow);

    for (let i = 0; i < 120; i++) {
      this.starField.push({
        x: Math.random() * SCREEN_W,
        y: Math.random() * SCREEN_H * 0.6,
        r: Math.random() * 1.6 + 0.4,
        p: Math.random() * Math.PI * 2,
      });
    }

    for (const t of [this.titleGlow, this.titlePink, this.title]) {
      t.style.letterSpacing = 6;
      t.anchor.set(0.5, 0);
    }
    this.subtitle.anchor.set(0.5, 0);
    this.highText.anchor.set(0.5, 0);
    this.prompt.anchor.set(0.5, 0);
    this.tipsText.style.lineHeight = 14;

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
      const name = mkText(def.name, 12, def.color);
      const ability = mkText(def.abilityName, 8, PALETTE.text);
      const desc = mkText(def.abilityDesc, 7, PALETTE.textDim);
      desc.style.wordWrap = true;
      this.uiLayer.addChild(box, ghost, name, ability, desc);
      this.rows.push({ def, box, ghost, name, ability, desc });
    });

    CONTROLS.forEach(([key, action]) => {
      const k = mkText(key, 7, PALETTE.gold);
      const a = mkText(action, 7, PALETTE.text);
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

  /** Recompute every width-dependent position. Safe to call on resize. */
  layout(): void {
    const panelX = SCREEN_W - HUD_W;
    const cx = panelX + 24;
    const contentW = HUD_W - 48;
    const midX = VIEW_W / 2;

    this.panelGfx.clear();
    this.panelGfx.rect(panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.34 });

    this.scrimGfx.clear();
    this.scrimGfx.rect(0, 0, VIEW_W, 206).fill({ color: 0x0a0318, alpha: 0.6 });
    this.scrimGfx.rect(0, 206, VIEW_W, 44).fill({ color: 0x0a0318, alpha: 0.3 });

    this.title.position.set(midX, 62);
    this.titleGlow.position.set(midX + 3, 65);
    this.titlePink.position.set(midX - 3, 59);
    this.titleGlow.alpha = 0.9;
    this.titlePink.alpha = 0.75;
    this.subtitle.position.set(midX, 120);
    this.highText.position.set(midX, 142);
    this.prompt.position.set(midX, 166);

    this.chooseText.position.set(cx, 22);
    this.chooseHint.position.set(panelX + HUD_W - 24, 24);

    this.rows.forEach((row, i) => {
      row.ghost.position.set(cx + 26, ROW_Y[i] + 46);
      row.name.position.set(cx + 60, ROW_Y[i] + 14);
      row.ability.position.set(cx + 60, ROW_Y[i] + 36);
      row.desc.position.set(cx + 60, ROW_Y[i] + 52);
      row.desc.style.wordWrapWidth = contentW - 48;
    });

    const dividerY = [40, 444, 626];
    this.dividers.forEach((g, i) => {
      g.clear();
      g.rect(panelX + 20, dividerY[i], HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.22 });
    });

    this.controlsTitle.position.set(cx, 454);
    this.controlsKeys.forEach((k, i) => {
      k.position.set(cx, 476 + i * 22);
      this.controlsActions[i].position.set(cx + 132, 476 + i * 22);
    });

    this.howTitle.position.set(cx, 636);
    this.tipsText.position.set(cx, 656);
    this.audioText.position.set(cx, 708);
    this.credit.position.set(cx, 728);
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

    this.stars.clear();
    for (const s of this.starField) {
      const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.t * 2 + s.p));
      this.stars.circle(s.x, s.y, s.r).fill({ color: PALETTE.white, alpha: a * 0.75 });
    }
    this.drawBackground();
    this.drawGlow();

    this.prompt.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 4));
    this.subtitle.text = phase === 'gameover' ? 'GAME OVER' : 'YOU ARE THE GHOST';
    this.subtitle.style.fill = phase === 'gameover' ? PALETTE.danger : PALETTE.textDim;
    this.prompt.text = phase === 'gameover' ? 'PRESS SPACE FOR THE TITLE' : 'PRESS SPACE TO START';
    this.highText.text = high > 0 ? `HIGH SCORE  ${String(high).padStart(6, '0')}` : '';
    this.audioText.text = muted ? 'SOUND MUTED  ·  N TO UNMUTE' : audioHint;

    const panelX = SCREEN_W - HUD_W;
    this.rows.forEach((row, i) => {
      const active = i === selected;
      const w = HUD_W - 40;
      const h = 88;
      const x = panelX + 20;
      const y = ROW_Y[i];

      row.box.clear();
      row.box.roundRect(x, y, w, h, 8).fill({
        color: active ? PALETTE.wallFill : 0x120a26,
        alpha: active ? 0.95 : 0.5,
      });
      row.box.roundRect(x, y, w, h, 8).stroke({
        width: active ? 2 : 1,
        color: active ? row.def.color : PALETTE.wallDim,
        alpha: active ? 1 : 0.55,
      });
      if (active) {
        row.box.roundRect(x - 4, y - 4, w + 8, h + 8, 10).stroke({
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

  private drawBackground(): void {
    this.bg.clear();
    const horizon = SCREEN_H * 0.55;
    const bands = 56;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const col = sampleGradient(SKY_STOPS, t0);
      this.bg.rect(0, t0 * horizon - 1, SCREEN_W, horizon / bands + 2).fill(col);
    }
    this.bg.rect(0, horizon, SCREEN_W, SCREEN_H - horizon).fill(SKY.floor);

    const scroll = (this.t * 0.35) % 1;
    for (let i = 0; i < 16; i++) {
      const p = (i + scroll) / 16;
      const y = horizon + Math.pow(p, 2.3) * (SCREEN_H - horizon);
      this.bg.rect(0, y, SCREEN_W, 1.4).fill({ color: PALETTE.grid, alpha: 0.16 + p * 0.38 });
    }
    const vpx = SCREEN_W / 2;
    for (let i = -22; i <= 22; i++) {
      this.bg.moveTo(vpx + i * 5, horizon);
      this.bg.lineTo(vpx + i * (SCREEN_W / 13), SCREEN_H);
      this.bg.stroke({ width: 1, color: PALETTE.grid, alpha: 0.2 });
    }
    this.bg.rect(0, horizon - 3, SCREEN_W, 5).fill({ color: PALETTE.horizon, alpha: 0.8 });
    this.bg.rect(0, horizon - 12, SCREEN_W, 12).fill({ color: PALETTE.horizon, alpha: 0.16 });
  }

  private drawGlow(): void {
    this.glow.clear();
    const cx = VIEW_W / 2;
    const cy = SCREEN_H * 0.52;
    const pulse = 1 + Math.sin(this.t * 1.5) * 0.03;
    for (let i = 6; i >= 1; i--) {
      const r = (60 + i * 52) * pulse;
      const a = 0.026 + (6 - i) * 0.007;
      this.glow.circle(cx, cy, r).fill({ color: i % 2 ? PALETTE.accent : PALETTE.accent2, alpha: a });
    }
  }

  setVisible(visible: boolean): void {
    this.bgLayer.visible = visible;
    this.uiLayer.visible = visible;
  }
}
