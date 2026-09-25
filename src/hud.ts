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
import { lerpColor } from './color';
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
// Sized for a 7" 1280x800 handheld: nothing smaller than 10px.
const STANCE_ROW_Y = [138, 178, 218, 258];
const GHOST_BOX_Y = 408;
const GHOST_BOX_H = 118;
const PINCER_BAR_Y = 318;
const ABILITY_BAR_Y = 376;
const LIVES_Y = 544;

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

  private readonly scoreLabel = mkText('SCORE', 10, PALETTE.textDim);
  private readonly scoreValue = mkText('000000', 24, PALETTE.text);
  private readonly highLabel = mkText('HIGH', 10, PALETTE.textDim);
  private readonly highValue = mkText('000000', 13, PALETTE.accent);
  private readonly levelLabel = mkText('LEVEL', 10, PALETTE.textDim);
  private readonly levelValue = mkText('1', 13, PALETTE.accent2);
  private readonly squadTitle = mkText('SQUAD ORDERS', 11, PALETTE.accent2);
  private readonly stanceNames: Text[] = [];
  private readonly stanceDescs: Text[] = [];
  private readonly barsKeyLabels: Text[] = [];
  private readonly pincerLabel = mkText('PINCER [SPACE]', 10, PALETTE.textDim);
  private readonly abilityLabel = mkText('ABILITY [SHIFT]', 10, PALETTE.textDim);
  private readonly abilityValue = mkText('', 13, PALETTE.gold);
  private readonly yourGhostLabel = mkText('YOUR GHOST', 11, PALETTE.accent2);
  private readonly playerNameText = mkText('', 15, PALETTE.text);
  private readonly playerAbilityText = mkText('', 11, PALETTE.text);
  private readonly playerAbilityDesc = mkText('', 10, PALETTE.textDim);
  private readonly livesLabel = mkText('LIVES', 10, PALETTE.textDim);
  private readonly pacLivesLabel = mkText('CATCHES', 10, PALETTE.textDim);
  private readonly keyHint1 = mkText('1-4 STANCE  P PAUSE', 10, PALETTE.textDim);
  private readonly keyHint2 = mkText('M MUSIC  C CRT', 10, PALETTE.textDim);
  private readonly trackText = mkText('', 10, PALETTE.textDim);
  private readonly fpsText = mkText('', 11, PALETTE.accent2);

  private readonly message = mkText('', 34, PALETTE.gold, 'center');
  private readonly submessage = mkText('', 14, PALETTE.text, 'center');
  private readonly frightBar = new Graphics();

  private panelX = 0;
  private cx = 0;
  private cw = 0;

  constructor() {
    this.layer.eventMode = 'none';

    STANCE_ROW_Y.forEach(() => {
      this.stanceNames.push(mkText('', 12, PALETTE.text));
      this.stanceDescs.push(mkText('', 10, PALETTE.textDim));
    });
    for (let i = 0; i < STANCE_ORDER.length; i++) {
      const t = mkText(STANCE_INFO[STANCE_ORDER[i]].key, 11, PALETTE.white, 'center');
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
    this.panel.rect(this.panelX, 0, HUD_W, SCREEN_H).fill({ color: PALETTE.bgDeep, alpha: 0.5 });
    // Neon seam between the maze and the panel, pink at the top to cyan below.
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      const col = lerpColor(PALETTE.wallTop, PALETTE.wallBot, t);
      const y = (i * SCREEN_H) / 24;
      this.panel.rect(this.panelX, y, 2, SCREEN_H / 24 + 1).fill({ color: col, alpha: 0.75 });
      this.panel.rect(this.panelX + 2, y, 6, SCREEN_H / 24 + 1).fill({ color: col, alpha: 0.08 });
    }

    this.dividers.clear();
    for (const y of [104, 396, 534, 616]) {
      this.dividers.rect(this.panelX + 20, y, HUD_W - 40, 1).fill({ color: PALETTE.accent, alpha: 0.2 });
    }

    const x = this.cx;
    const col2 = x + Math.round(this.cw * 0.52);
    this.scoreLabel.position.set(x, 18);
    this.scoreValue.position.set(x, 34);
    this.highLabel.position.set(x, 68);
    this.highValue.position.set(x, 83);
    this.levelLabel.position.set(col2, 68);
    this.levelValue.position.set(col2, 83);
    this.squadTitle.position.set(x, 116);

    STANCE_ROW_Y.forEach((y, i) => {
      this.stanceNames[i].position.set(x + 34, y + 1);
      this.stanceDescs[i].position.set(x + 34, y + 18);
      this.barsKeyLabels[i].position.set(x + 11, y + 13);
    });

    this.pincerLabel.position.set(x, PINCER_BAR_Y - 18);
    this.abilityLabel.position.set(x, ABILITY_BAR_Y - 40);
    this.abilityValue.position.set(x, ABILITY_BAR_Y - 22);

    this.yourGhostLabel.visible = false;
    this.bigGhost.position.set(x + 40, GHOST_BOX_Y + 60);
    this.playerNameText.position.set(x + 84, GHOST_BOX_Y + 16);
    this.playerAbilityText.position.set(x + 84, GHOST_BOX_Y + 42);
    this.playerAbilityDesc.position.set(x + 84, GHOST_BOX_Y + 62);
    this.playerAbilityDesc.style.wordWrap = true;
    this.playerAbilityDesc.style.lineHeight = 15;
    this.playerAbilityDesc.style.wordWrapWidth = this.cw - 86;

    this.livesLabel.position.set(x, LIVES_Y);
    this.pacLivesLabel.position.set(col2, LIVES_Y);
    this.keyHint1.position.set(x, 630);
    this.keyHint2.position.set(x, 650);
    this.trackText.position.set(x, 680);
    this.fpsText.position.set(18, 12);

    this.message.position.set(VIEW_W / 2, 330);
    this.submessage.position.set(VIEW_W / 2, 378);
  }

  update(s: HudState): void {
    this.scoreValue.text = String(s.score).padStart(6, '0');
    this.highValue.text = String(s.high).padStart(6, '0');
    this.levelValue.text = String(s.level);
    this.fpsText.visible = s.showFps;
    this.fpsText.text = `${Math.round(s.fps)} FPS`;
    this.abilityValue.text = s.abilityName;
    this.abilityValue.style.fill = s.abilityReady ? PALETTE.gold : PALETTE.textDim;
    this.abilityLabel.text = s.abilityLocked ? 'ABILITY LOCKED' : 'ABILITY [SHIFT]';
    this.abilityLabel.style.fill = s.abilityLocked ? PALETTE.danger : PALETTE.textDim;
    // Already formatted (and ♪-prefixed) by Game.audioHintText().
    this.trackText.text = s.trackName;

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
        this.bars.roundRect(this.cx - 6, y - 5, this.cw + 8, 36, 5).fill({ color: PALETTE.accent, alpha: 0.16 });
        this.bars.roundRect(this.cx - 6, y - 5, 3, 36, 1.5).fill({ color: PALETTE.accent2 });
      }
      this.bars.roundRect(this.cx, y + 2, 22, 22, 4).fill({
        color: active ? PALETTE.accent : PALETTE.wallFill,
        alpha: active ? 0.9 : 0.55,
      });
      this.bars.roundRect(this.cx, y + 2, 22, 22, 4).stroke({
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

    this.ledBar(PINCER_BAR_Y, s.pincerReady ? 1 : 1 - s.pincerCd / s.pincerMax, s.pincerReady ? PALETTE.accent2 : PALETTE.accent);
    if (s.abilityLocked) {
      this.ledBar(ABILITY_BAR_Y, 1, PALETTE.danger, 0.3);
    } else {
      this.ledBar(ABILITY_BAR_Y, s.abilityReady ? 1 : 1 - s.abilityCd / s.abilityMax, PALETTE.gold);
    }
  }

  /** Segmented LED meter; the leading segment glows while it charges. */
  private ledBar(y: number, frac: number, color: number, alpha = 1): void {
    const n = 16;
    const gap = 3;
    const w = (this.cw - gap * (n - 1)) / n;
    const lit = Math.max(0, Math.min(1, frac)) * n;
    for (let i = 0; i < n; i++) {
      const x = this.cx + i * (w + gap);
      const k = Math.max(0, Math.min(1, lit - i));
      this.bars.rect(x, y, w, 10).fill({ color: PALETTE.wallFill, alpha: 0.85 });
      if (k > 0) {
        this.bars.rect(x, y, w, 10).fill({ color, alpha: alpha * (k < 1 ? 0.35 + 0.5 * k : 1) });
        this.bars.rect(x, y, w, 3).fill({ color: PALETTE.white, alpha: alpha * 0.25 * k });
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
      v.position.set(this.cx + 13 + i * 32, LIVES_Y + 40);
      drawGhost(v, 12, { color: s.playerColor, dir: 'left', wave: 4 });
    });

    this.pacIcons.forEach((v, i) => {
      const on = i < s.pacLives;
      v.visible = on;
      if (!on) return;
      v.clear();
      v.position.set(this.cx + Math.round(this.cw * 0.52) + 12 + i * 28, LIVES_Y + 40);
      drawPacman(v, 11, 0.6, PALETTE.pac);
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
