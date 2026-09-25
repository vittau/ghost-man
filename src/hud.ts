import { Container, Graphics, Text } from 'pixi.js';
import {
  FONT_FAMILY,
  HUD_W,
  PAC_LIVES,
  PALETTE,
  PLAYER_LIVES,
  SCREEN_H,
  SCREEN_W,
  STANCE_INFO,
  STANCE_ORDER,
  VIEW_W,
} from './config';
import { drawGhost, drawPacman } from './draw';
import type { Stance } from './types';

export interface HudState {
  score: number;
  high: number;
  level: number;
  lives: number;
  pacLives: number;
  stance: Stance;
  pincerReady: boolean;
  pincerCd: number;
  pincerMax: number;
  abilityName: string;
  abilityReady: boolean;
  abilityLocked: boolean;
  abilityCd: number;
  abilityMax: number;
  playerColor: number;
  playerName: string;
  playerAbility: string;
  playerAbilityDesc: string;
  frightTimer: number;
  frightMax: number;
  message: string;
  submessage: string;
  messageColor: number;
  muted: boolean;
  trackName: string;
  showFps: boolean;
  fps: number;
}

// Vertical positions are fixed (canvas height never changes); layout()
// recomputes the horizontal ones so the panel tracks the window width.
const STANCE_ROW_Y = [170, 202, 234, 266];
const GHOST_BOX_Y = 420;
const GHOST_BOX_H = 136;

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

/**
 * Right-hand arcade panel. Deliberately contains no board information — no
 * minimap — so the game has to be read from the maze itself.
 */
export class Hud {
  readonly layer = new Container();

  private readonly panel = new Graphics();
  private readonly bars = new Graphics();
  private readonly dividers = new Graphics();
  private readonly ghostBox = new Graphics();
  private readonly bigGhost = new Graphics();
  private readonly lifeLayer = new Container();
  private readonly lifeIcons: Graphics[] = [];
  private readonly pacIcons: Graphics[] = [];

  private readonly scoreLabel = mkText('SCORE', 8, PALETTE.textDim);
  private readonly scoreValue = mkText('000000', 16, PALETTE.text);
  private readonly highLabel = mkText('HIGH SCORE', 8, PALETTE.textDim);
  private readonly highValue = mkText('000000', 11, PALETTE.accent);
  private readonly levelLabel = mkText('LEVEL', 8, PALETTE.textDim);
  private readonly levelValue = mkText('1', 11, PALETTE.accent2);
  private readonly squadTitle = mkText('SQUAD ORDERS', 8, PALETTE.accent2);
  private readonly stanceNames: Text[] = [];
  private readonly stanceDescs: Text[] = [];
  private readonly barsKeyLabels: Text[] = [];
  private readonly pincerLabel = mkText('PINCER  [SPACE]', 8, PALETTE.textDim);
  private readonly abilityLabel = mkText('ABILITY  [SHIFT]', 8, PALETTE.textDim);
  private readonly abilityValue = mkText('', 11, PALETTE.gold);
  private readonly yourGhostLabel = mkText('YOUR GHOST', 8, PALETTE.accent2);
  private readonly playerNameText = mkText('', 12, PALETTE.text);
  private readonly playerAbilityText = mkText('', 8, PALETTE.text);
  private readonly playerAbilityDesc = mkText('', 7, PALETTE.textDim);
  private readonly livesLabel = mkText('LIVES', 8, PALETTE.textDim);
  private readonly pacLivesLabel = mkText('CATCHES LEFT', 8, PALETTE.textDim);
  private readonly keyHint1 = mkText('1-4 STANCE   P PAUSE', 7, PALETTE.textDim);
  private readonly keyHint2 = mkText('M MUSIC  C CRT  F FPS', 7, PALETTE.textDim);
  private readonly trackText = mkText('', 7, PALETTE.textDim);
  private readonly fpsText = mkText('', 9, PALETTE.accent2);

  private readonly message = mkText('', 28, PALETTE.gold, 'center');
  private readonly submessage = mkText('', 11, PALETTE.text, 'center');
  private readonly frightBar = new Graphics();

  private panelX = 0;
  private cx = 0;
  private cw = 0;

  constructor() {
    this.layer.eventMode = 'none';

    STANCE_ROW_Y.forEach(() => {
      this.stanceNames.push(mkText('', 10, PALETTE.text));
      this.stanceDescs.push(mkText('', 7, PALETTE.textDim));
    });
    for (let i = 0; i < STANCE_ORDER.length; i++) {
      const t = mkText(STANCE_INFO[STANCE_ORDER[i]].key, 9, PALETTE.white, 'center');
      t.anchor.set(0.5, 0.5);
      this.barsKeyLabels.push(t);
    }

    for (let i = 0; i < PLAYER_LIVES; i++) {
      const v = new Graphics();
      this.lifeIcons.push(v);
      this.lifeLayer.addChild(v);
    }
    for (let i = 0; i < PAC_LIVES; i++) {
      const v = new Graphics();
      this.pacIcons.push(v);
      this.lifeLayer.addChild(v);
    }

    this.layer.addChild(
      this.panel,
      this.dividers,
      this.ghostBox,
      this.bigGhost,
      this.bars,
      this.frightBar,
      this.scoreLabel,
      this.scoreValue,
      this.highLabel,
      this.highValue,
      this.levelLabel,
      this.levelValue,
      this.squadTitle,
      this.pincerLabel,
      this.abilityLabel,
      this.abilityValue,
      this.yourGhostLabel,
      this.playerNameText,
      this.playerAbilityText,
      this.playerAbilityDesc,
      this.livesLabel,
      this.pacLivesLabel,
      this.keyHint1,
      this.keyHint2,
      this.trackText,
      this.fpsText,
      this.lifeLayer,
      this.message,
      this.submessage,
      ...this.stanceNames,
      ...this.stanceDescs,
      ...this.barsKeyLabels,
    );

    this.layout();
  }

  /** Recompute every width-dependent position. Safe to call on resize. */
  layout(): void {
    this.panelX = SCREEN_W - HUD_W;
    this.cx = this.panelX + 24;
    this.cw = HUD_W - 48;

    this.panel.clear();
    this.panel.rect(this.panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.34 });

    this.dividers.clear();
    for (const y of [392, 572, 690]) {
      this.dividers.rect(this.panelX + 20, y, HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.2 });
    }

    const x = this.cx;
    this.scoreLabel.position.set(x, 24);
    this.scoreValue.position.set(x, 38);
    this.highLabel.position.set(x, 70);
    this.highValue.position.set(x, 84);
    this.levelLabel.position.set(x, 110);
    this.levelValue.position.set(x, 124);
    this.squadTitle.position.set(x, 154);

    STANCE_ROW_Y.forEach((y, i) => {
      this.stanceNames[i].position.set(x + 30, y);
      this.stanceDescs[i].position.set(x + 30, y + 14);
      this.barsKeyLabels[i].position.set(x + 9, y + 9);
    });

    this.pincerLabel.position.set(x, 296);
    this.abilityLabel.position.set(x, 336);
    this.abilityValue.position.set(x, 350);

    this.yourGhostLabel.position.set(x, 404);
    this.bigGhost.position.set(x + 44, GHOST_BOX_Y + 62);
    this.playerNameText.position.set(x + 90, GHOST_BOX_Y + 22);
    this.playerAbilityText.position.set(x + 90, GHOST_BOX_Y + 46);
    this.playerAbilityDesc.position.set(x + 90, GHOST_BOX_Y + 62);
    this.playerAbilityDesc.style.wordWrap = true;
    this.playerAbilityDesc.style.wordWrapWidth = this.cw - 92;

    this.livesLabel.position.set(x, 584);
    this.pacLivesLabel.position.set(x, 646);
    this.keyHint1.position.set(x, 700);
    this.keyHint2.position.set(x, 714);
    this.trackText.position.set(x, 732);
    this.fpsText.position.set(18, 12);

    this.message.position.set(VIEW_W / 2, 340);
    this.submessage.position.set(VIEW_W / 2, 378);
  }

  update(s: HudState): void {
    this.scoreValue.text = String(s.score).padStart(6, '0');
    this.highValue.text = String(s.high).padStart(6, '0');
    this.levelValue.text = `LEVEL ${s.level}`;
    this.fpsText.visible = s.showFps;
    this.fpsText.text = `${Math.round(s.fps)} FPS`;
    this.abilityValue.text = s.abilityName;
    this.abilityValue.style.fill = s.abilityReady ? PALETTE.gold : PALETTE.textDim;
    this.abilityLabel.text = s.abilityLocked ? 'ABILITY  LOCKED' : 'ABILITY  [SHIFT]';
    this.abilityLabel.style.fill = s.abilityLocked ? PALETTE.danger : PALETTE.textDim;
    this.trackText.text = s.trackName ? `♪ ${s.trackName}` : '';

    this.playerNameText.text = s.playerName;
    this.playerNameText.style.fill = s.playerColor;
    this.playerAbilityText.text = s.playerAbility;
    this.playerAbilityDesc.text = s.playerAbilityDesc;

    this.message.text = s.message;
    this.message.style.fill = s.messageColor;
    this.submessage.text = s.submessage;

    this.drawStances(s);
    this.drawMeters(s);
    this.drawGhostCard(s);
    this.drawLives(s);
    this.drawFright(s);
  }

  private drawStances(s: HudState): void {
    this.bars.clear();
    STANCE_ORDER.forEach((st, i) => {
      const y = STANCE_ROW_Y[i];
      const active = st === s.stance;
      const info = STANCE_INFO[st];
      this.stanceNames[i].text = info.name;
      this.stanceDescs[i].text = info.desc;
      this.stanceNames[i].style.fill = active ? PALETTE.accent2 : PALETTE.text;
      this.stanceDescs[i].style.fill = active ? PALETTE.text : PALETTE.textDim;

      if (active) {
        this.bars.roundRect(this.cx - 6, y - 4, this.cw + 8, 30, 5).fill({ color: PALETTE.accent, alpha: 0.16 });
        this.bars.roundRect(this.cx - 6, y - 4, 3, 30, 1.5).fill({ color: PALETTE.accent2 });
      }
      this.bars.roundRect(this.cx, y, 18, 18, 4).fill({
        color: active ? PALETTE.accent : PALETTE.wallFill,
        alpha: active ? 0.9 : 0.55,
      });
      this.bars.roundRect(this.cx, y, 18, 18, 4).stroke({
        width: 1,
        color: active ? PALETTE.accent2 : PALETTE.wallDim,
        alpha: active ? 1 : 0.6,
      });
      this.barsKeyLabels[i].style.fill = active ? PALETTE.white : PALETTE.textDim;
    });
  }

  private drawMeters(s: HudState): void {
    if (s.showFps) {
      this.bars.roundRect(10, 6, 84, 20, 4).fill({ color: PALETTE.bgDeep, alpha: 0.82 });
      this.bars.roundRect(10, 6, 84, 20, 4).stroke({ width: 1, color: PALETTE.accent2, alpha: 0.4 });
    }

    const pY = 310;
    this.bars.roundRect(this.cx, pY, this.cw, 8, 4).fill({ color: PALETTE.wallFill, alpha: 0.85 });
    const pFrac = s.pincerReady ? 1 : 1 - s.pincerCd / s.pincerMax;
    if (pFrac > 0) {
      this.bars.roundRect(this.cx, pY, this.cw * pFrac, 8, 4).fill({
        color: s.pincerReady ? PALETTE.accent2 : PALETTE.accent,
      });
    }

    const aY = 368;
    this.bars.roundRect(this.cx, aY, this.cw, 8, 4).fill({ color: PALETTE.wallFill, alpha: 0.85 });
    if (s.abilityLocked) {
      this.bars.roundRect(this.cx, aY, this.cw, 8, 4).fill({ color: PALETTE.danger, alpha: 0.22 });
    } else {
      const aFrac = s.abilityReady ? 1 : 1 - s.abilityCd / s.abilityMax;
      if (aFrac > 0) {
        this.bars.roundRect(this.cx, aY, this.cw * aFrac, 8, 4).fill({ color: PALETTE.gold });
      }
    }
  }

  /** Decorative identity card: who you are, not where anything is. */
  private drawGhostCard(s: HudState): void {
    const x = this.panelX + 20;
    const w = HUD_W - 40;

    this.ghostBox.clear();
    this.ghostBox.roundRect(x, GHOST_BOX_Y, w, GHOST_BOX_H, 8).fill({ color: 0x120a26, alpha: 0.55 });
    this.ghostBox.roundRect(x, GHOST_BOX_Y, w, GHOST_BOX_H, 8).stroke({
      width: 1,
      color: s.playerColor,
      alpha: 0.7,
    });

    this.bigGhost.clear();
    const pulse = 1 + Math.sin(Date.now() / 260) * 0.04;
    drawGhost(this.bigGhost, 30 * pulse, {
      color: s.playerColor,
      dir: 'left',
      wave: 5,
    });
  }

  private drawLives(s: HudState): void {
    this.lifeIcons.forEach((v, i) => {
      const on = i < s.lives;
      v.visible = on;
      if (!on) return;
      v.clear();
      v.position.set(this.cx + 12 + i * 30, 604);
      drawGhost(v, 11, { color: s.playerColor, dir: 'left', wave: 4 });
    });

    this.pacIcons.forEach((v, i) => {
      const on = i < s.pacLives;
      v.visible = on;
      if (!on) return;
      v.clear();
      v.position.set(this.cx + 10 + i * 24, 664);
      drawPacman(v, 9, 0.6, PALETTE.pac);
    });
  }

  private drawFright(s: HudState): void {
    this.frightBar.clear();
    if (s.frightTimer <= 0) return;
    const w = VIEW_W - 80;
    const frac = s.frightTimer / s.frightMax;
    this.frightBar.roundRect(40, 14, w, 6, 3).fill({ color: PALETTE.wallFill, alpha: 0.6 });
    this.frightBar.roundRect(40, 14, w * frac, 6, 3).fill({ color: PALETTE.power, alpha: 0.95 });
  }
}
