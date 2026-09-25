import { Application, Container, Graphics } from 'pixi.js';
import {
  ABILITY_TIME,
  CAM_MAX,
  COLS,
  FRIGHT_TIME,
  GHOSTS,
  HOUSE_CENTER,
  MAZE_OFFSET_X,
  MAZE_ZOOM,
  PAC_LIVES,
  PALETTE,
  PINCER_COOLDOWN,
  PINCER_TIME,
  PLAYER_LIVES,
  READY_TIME,
  ROWS,
  SCREEN_H,
  SCREEN_W,
  STANCE_ORDER,
  TILE,
  VIEW_W,
  WORLD_H,
  WORLD_W,
} from './config';
import { lerpColor } from './color';
import { Maze, NavCache, WALL } from './maze';
import { centerOf } from './mover';
import { Ghost, Pacman } from './actors';
import type { SimContext, SimFields } from './actors';
import { drawDoor, drawGhost, drawPacman } from './draw';
import { Fx } from './fx';
import { GameAudio } from './audio';
import { Hud } from './hud';
import type { HudState } from './hud';
import { Menu } from './menu';
import { createBloom, createCRT } from './filters';
import type { CrtResult } from './filters';
import { DIRS } from './types';
import type { Dir, GamePhase, GhostId, Stance, TilePos, UnitDir } from './types';
import type { Input } from './input';
import { MusicPlayer } from './music';

// Bundled music (CC-BY 4.0 — see README for attribution).
import menuTrack from './assets/audio/01-falling-organ.mp3';
import levelTrack1 from './assets/audio/02-tyranny-of-the-sun.mp3';
import levelTrack2 from './assets/audio/03-work-in-progress.mp3';
import levelTrack3 from './assets/audio/04-demons-on-the-beach.mp3';
import levelTrack4 from './assets/audio/05-solitude.mp3';
import levelTrack5 from './assets/audio/06-the-climax.mp3';

const dirAngle = (d: Dir, fallback: number): number => {
  switch (d) {
    case 'right':
      return 0;
    case 'down':
      return Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'up':
      return -Math.PI / 2;
    default:
      return fallback;
  }
};

const angleLerp = (a: number, b: number, t: number): number => {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
};

// Cheap value noise. Sampling it in tile-space with a slowly advancing offset
// gives smoothly correlated, drifting variation — neighbours rise and fall
// together, which reads as organic rather than blinking.
const fade = (t: number): number => t * t * (3 - 2 * t);

const lattice = (ix: number, iy: number, seed: number): number => {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
};

export class Game {
  private readonly app: Application;
  private readonly audio = new GameAudio();
  private readonly music = new MusicPlayer({
    menu: menuTrack,
    levels: [levelTrack1, levelTrack2, levelTrack3, levelTrack4, levelTrack5],
    names: [
      'FALLING ORGAN',
      'TYRANNY OF THE SUN',
      'WORK IN PROGRESS',
      'DEMONS ON THE BEACH',
      'SOLITUDE',
      'THE CLIMAX',
    ],
  });
  private readonly fx = new Fx();
  private readonly hud = new Hud();
  private readonly menu = new Menu();

  // Simulation.
  private readonly maze = new Maze();
  private readonly nav: NavCache;
  private readonly pac: Pacman;
  private readonly ghosts: Ghost[] = [];
  private playerGhost!: Ghost;
  private playerId: GhostId = 'blinky';

  private stance: Stance = 'hunt';
  private pincerTimer = 0;
  private pincerCd = 0;
  private frightTimer = 0;
  private ghostsEaten = 0;
  private decoy: { x: number; y: number } | null = null;
  private decoyTimer = 0;

  // Rules / progress.
  phase: GamePhase = 'menu';
  private score = 0;
  private high = 0;
  private level = 1;
  private lives = PLAYER_LIVES;
  private pacLives = PAC_LIVES;

  // Timers.
  private readyTimer = 0;
  private dyingTimer = 0;
  private levelClearTimer = 0;
  private freezeTimer = 0;
  private msgTimer = 0;
  private sirenTimer = 0;
  private wakaAlt = false;
  private menuSelect = 0;
  private demoStanceTimer = 0;
  private demoPincerTimer = 3;

  // Presentation.
  private readonly world = new Container();
  private readonly backdrop = new Graphics();
  private readonly mazeFill = new Graphics();
  private readonly mazeGfx = new Graphics();
  private readonly wallDots = new Graphics();
  private readonly dotGfx = new Graphics();
  private readonly powerGfx = new Graphics();
  private readonly doorGfx = new Graphics();
  private readonly actorLayer = new Container();
  private readonly overlayGfx = new Graphics();
  private readonly intentGfx = new Graphics();
  private readonly pacView = new Graphics();
  private readonly decoyView = new Graphics();
  private readonly playerRing = new Graphics();
  private readonly ghostViews = new Map<GhostId, Graphics>();
  private bloom = createBloom();
  private crt: CrtResult | null = null;
  private crtOn = true;
  private showFps = false;

  private dotsDirty = true;
  private elapsed = 0;
  private camY = 0;
  private pacAngle = dirAngle('left', Math.PI);
  private muted = false;
  private lastFps = 60;
  private message = '';
  private submessage = '';
  private messageColor = PALETTE.gold;

  constructor(app: Application) {
    this.app = app;
    this.nav = new NavCache(this.maze);
    this.pac = new Pacman(this.maze);
    this.high = Number(localStorage.getItem('ghost-man.high') ?? 0) || 0;

    for (const def of GHOSTS) {
      const g = new Ghost(this.maze, def);
      this.ghosts.push(g);
      const view = new Graphics();
      this.ghostViews.set(def.id, view);
      this.actorLayer.addChild(view);
    }

    this.actorLayer.addChild(this.playerRing, this.intentGfx, this.pacView, this.decoyView);
    this.world.addChild(
      this.mazeFill,
      this.wallDots,
      this.mazeGfx,
      this.dotGfx,
      this.powerGfx,
      this.doorGfx,
      this.actorLayer,
    );
    this.world.position.set(0, 0);

    this.buildMaze();
    this.buildBackdrop();

    // Stage layering: menu background → world → HUD → menu UI → flash.
    app.stage.addChild(
      this.backdrop,
      this.menu.bgLayer,
      this.world,
      this.overlayGfx,
      this.hud.layer,
      this.menu.uiLayer,
      this.fx.flashLayer,
    );
    this.fx.layer.visible = true;
    this.world.addChild(this.fx.layer);

    this.hud.layer.visible = false;

    try {
      this.crt = createCRT();
      app.stage.filters = [this.crt.filter];
      this.crt.resize(app.renderer.width, app.renderer.height);
    } catch (err) {
      console.warn('[ghost-man] CRT unavailable', err);
      this.crt = null;
    }
    this.world.filters = [this.bloom];

    this.selectGhost(0);
    this.enterAttract();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private selectGhost(index: number): void {
    this.menuSelect = ((index % GHOSTS.length) + GHOSTS.length) % GHOSTS.length;
    this.playerId = GHOSTS[this.menuSelect].id;
    this.playerGhost = this.ghosts.find((g) => g.id === this.playerId) as Ghost;
  }

  private buildMaze(): void {
    const inset = 2;
    const isWall = (c: number, r: number): boolean => {
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
      return this.maze.kindAt(c, r) === WALL;
    };

    // Solid fill, row-tinted for a vertical gradient.
    for (let r = 0; r < ROWS; r++) {
      const col = lerpColor(0x120727, 0x1f0c3c, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (this.maze.kindAt(c, r) === WALL) {
          this.mazeFill.rect(c * TILE, r * TILE, TILE, TILE).fill(col);
        }
      }
    }

    // Neon outline: only the edges that face open space, grouped by row so each
    // row can carry its own gradient colour.
    for (let r = 0; r < ROWS; r++) {
      let started = false;
      const col = lerpColor(PALETTE.wallTop, PALETTE.wallBot, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (!isWall(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        // Corner-aware outline. A segment's end is pulled in to the inset
        // corner point only when the perpendicular edge actually turns there
        // (i.e. that edge exists AND the diagonal tile is open). Otherwise it
        // runs to the tile boundary so runs stay continuous and corners join
        // cleanly instead of crossing and leaving spurs.
        const L = !isWall(c - 1, r);
        const R = !isWall(c + 1, r);
        const T = !isWall(c, r - 1);
        const B = !isWall(c, r + 1);
        const TL = !isWall(c - 1, r - 1);
        const TR = !isWall(c + 1, r - 1);
        const BL = !isWall(c - 1, r + 1);
        const BR = !isWall(c + 1, r + 1);

        if (T) {
          this.mazeGfx
            .moveTo(L && TL ? x + inset : x, y + inset)
            .lineTo(R && TR ? x + TILE - inset : x + TILE, y + inset);
          started = true;
        }
        if (B) {
          this.mazeGfx
            .moveTo(L && BL ? x + inset : x, y + TILE - inset)
            .lineTo(R && BR ? x + TILE - inset : x + TILE, y + TILE - inset);
          started = true;
        }
        if (L) {
          this.mazeGfx
            .moveTo(x + inset, T && TL ? y + inset : y)
            .lineTo(x + inset, B && BL ? y + TILE - inset : y + TILE);
          started = true;
        }
        if (R) {
          this.mazeGfx
            .moveTo(x + TILE - inset, T && TR ? y + inset : y)
            .lineTo(x + TILE - inset, B && BR ? y + TILE - inset : y + TILE);
          started = true;
        }
      }
      if (started) {
        this.mazeGfx.stroke({ width: 3, color: col, cap: 'round', join: 'round' });
      }
    }
    this.mazeGfx.position.set(0, 0);
  }

  /**
   * Wall texture: one soft dot per wall tile whose size and position are driven
   * by slowly drifting value noise. Nearby dots share the field, so the walls
   * breathe in soft waves instead of flickering. Only tiles inside the camera
   * window are drawn, keeping the cost flat.
   */
  private drawWallDots(): void {
    this.wallDots.clear();
    const demo = this.phase === 'menu' || this.phase === 'gameover';
    const visibleH = SCREEN_H / MAZE_ZOOM;
    const r0 = demo ? 0 : Math.max(0, Math.floor(this.camY / TILE) - 1);
    const r1 = demo ? ROWS : Math.min(ROWS, Math.ceil((this.camY + visibleH) / TILE) + 1);
    const t = this.elapsed;

    // The noise field itself drifts diagonally; the second octave adds detail.
    const driftX = t * 0.045;
    const driftY = t * 0.03;

    for (let r = r0; r < r1; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.maze.kindAt(c, r) !== WALL) continue;

        // 2x2 sub-dots per tile (~17px apart) matches the original density.
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const fx = sx === 0 ? 0.28 : 0.72;
            const fy = sy === 0 ? 0.28 : 0.72;

            const nx = (c + fx) * 0.34 + driftX;
            const ny = (r + fy) * 0.34 + driftY;

            let n = valueNoise(nx, ny, 1);
            n += valueNoise(nx * 2.3, ny * 2.3, 2) * 0.45;
            n /= 1.45; // back to ~0..1

            // A slow global breath keeps it alive without ever feeling random.
            const breathe = 0.5 + 0.5 * Math.sin(t * 0.4 + (c * 0.7 + r * 0.9 + sx + sy));
            const k = n * 0.72 + breathe * 0.28;

            const ox = (valueNoise(nx + 5.3, ny, 3) - 0.5) * 3.5;
            const oy = (valueNoise(nx, ny + 7.1, 4) - 0.5) * 3.5;

            this.wallDots
              .circle(c * TILE + fx * TILE + ox, r * TILE + fy * TILE + oy, 0.7 + k * 1.5)
              .fill({ color: PALETTE.accent2, alpha: 0.05 + k * 0.09 });
          }
        }
      }
    }
  }

  /**
   * Full-canvas backdrop so the background is continuous edge to edge, behind
   * both the maze viewport and the side panel.
   */
  private buildBackdrop(): void {
    this.backdrop.clear();
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      this.backdrop
        .rect(0, t * SCREEN_H - 1, SCREEN_W, SCREEN_H / bands + 2)
        .fill(lerpColor(0x180a30, 0x2a1250, t));
    }
    // Faint horizon glow so the panel side isn't dead flat.
    this.backdrop.rect(0, SCREEN_H * 0.62 - 2, SCREEN_W, 4).fill({ color: PALETTE.horizon, alpha: 0.05 });
  }

  private rebuildDots(): void {
    this.dotGfx.clear();
    const rad = TILE * 0.085;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      this.dotGfx.circle(centerOf(c), centerOf(r), rad).fill(PALETTE.dot);
    }
  }

  // -------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------

  private enterAttract(): void {
    this.phase = 'menu';
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.ghosts) g.isPlayer = false;
    this.maze.resetDots();
    this.dotsDirty = true;
    this.spawnRound();
    this.audio.stopMusic();
    this.message = '';
    this.submessage = '';
    this.syncMusic();
  }

  private startGame(): void {
    this.audio.resume();
    this.audio.uiConfirm();
    this.score = 0;
    this.level = 1;
    this.lives = PLAYER_LIVES;
    this.pacLives = PAC_LIVES;
    this.maze.resetDots();
    this.dotsDirty = true;
    for (const g of this.ghosts) g.isPlayer = false;
    this.playerGhost.isPlayer = true;
    this.hud.layer.visible = true;
    this.menu.setVisible(false);
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.audio.ready();
    this.syncMusic();
  }

  private spawnRound(): void {
    this.pac.spawn();
    for (const g of this.ghosts) g.spawn(this.level);
    this.frightTimer = 0;
    this.pac.powered = false;
    this.pincerTimer = 0;
    this.pincerCd = 0;
    this.ghostsEaten = 0;
    this.decoy = null;
    this.decoyTimer = 0;
    this.nav.clear();

    // Snap the camera so a round never opens with a long pan.
    const visibleH = SCREEN_H / MAZE_ZOOM;
    const focusY = (this.playerGhost ? this.playerGhost.py : this.pac.py) * 0.68 + this.pac.py * 0.32;
    this.camY = Math.max(0, Math.min(CAM_MAX, focusY - visibleH * 0.56));
  }

  private newLevel(): void {
    this.level++;
    this.pacLives = PAC_LIVES;
    this.maze.resetDots();
    this.dotsDirty = true;
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.syncMusic();
  }

  private gameOver(): void {
    this.phase = 'gameover';
    this.audio.gameOver();
    this.saveHigh();
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.ghosts) g.isPlayer = false;
    this.maze.resetDots();
    this.dotsDirty = true;
    this.spawnRound();
    this.fx.clear();
    this.syncMusic();
  }

  /** True while the attract title / game-over screen is showing. */
  private get isAttract(): boolean {
    return this.phase === 'menu' || this.phase === 'gameover';
  }

  /**
   * Called from the first user gesture so the browser lets audio play.
   * Must be wired to a keydown/pointerdown listener.
   */
  unlockAudio(): void {
    this.audio.resume();
    this.music.unlock();
    this.syncMusic();
  }

  /** Point the music player at the right track for the current phase/level. */
  private syncMusic(): void {
    if (this.music.available) {
      this.audio.stopMusic();
      if (this.isAttract) this.music.playMenu();
      else this.music.playForLevel(this.level);
    } else if (this.isAttract) {
      this.audio.stopMusic();
    } else {
      this.audio.startMusic();
    }
  }

  private saveHigh(): void {
    if (this.score > this.high) {
      this.high = this.score;
      try {
        localStorage.setItem('ghost-man.high', String(this.high));
      } catch {
        /* ignore */
      }
    }
  }

  private flashMessage(text: string, sub: string, color: number, time = 1.4): void {
    this.message = text;
    this.submessage = sub;
    this.messageColor = color;
    this.msgTimer = time;
  }

  // -------------------------------------------------------------------------
  // Input-driven actions
  // -------------------------------------------------------------------------

  private setStance(s: Stance): void {
    if (this.stance === s) return;
    this.stance = s;
    this.audio.uiSelect();
  }

  private cycleStance(dir: number): void {
    const i = STANCE_ORDER.indexOf(this.stance);
    this.setStance(STANCE_ORDER[(i + dir + STANCE_ORDER.length) % STANCE_ORDER.length]);
  }

  private triggerPincer(): void {
    this.pincerTimer = PINCER_TIME;
    this.pincerCd = PINCER_COOLDOWN;
    this.audio.pincer();
    this.fx.flash(PALETTE.accent2, 0.4, 0.35);
    this.fx.shake(6, 0.35);
    this.flashMessage('PINCER!', 'SQUAD CONVERGING', PALETTE.accent2, PINCER_TIME);
  }

  private useAbility(): void {
    const g = this.playerGhost;
    // Only while actively hunting. Being frightened, eaten, or waiting in the
    // house locks the ability — that's the cost of the power-pellet reversal.
    if (!g || g.cooldown > 0 || g.state !== 'normal') return;
    g.cooldown = g.def.cooldown;
    this.audio.ability();
    switch (g.def.ability) {
      case 'dash':
        g.dashTimer = ABILITY_TIME;
        this.fx.burst(g.px, g.py, g.def.color, 22, { speed: 200, life: 0.5, size: 3 });
        break;
      case 'blink': {
        const m = g.mover;
        const d = (m.dir === 'none' ? 'left' : m.dir) as UnitDir;
        let moved = false;
        for (let i = 0; i < 2; i++) {
          if (!m.canEnter(d)) break;
          m.tx += DIRS[d].x;
          m.ty += DIRS[d].y;
          if (m.tx < 0) m.tx = COLS - 1;
          else if (m.tx >= COLS) m.tx = 0;
          moved = true;
        }
        m.t = 0;
        if (moved) {
          this.fx.flash(PALETTE.accent, 0.25, 0.2);
          this.fx.burst(g.px, g.py, g.def.color, 26, { speed: 220, life: 0.5, size: 3 });
        }
        break;
      }
      case 'phase':
        g.beginPhase();
        this.fx.burst(g.px, g.py, g.def.color, 18, { speed: 160, life: 0.5, size: 3 });
        break;
      case 'decoy':
        this.decoy = { x: g.mover.tx, y: g.mover.ty };
        this.decoyTimer = 5;
        this.fx.burst(centerOf(g.mover.tx), centerOf(g.mover.ty), PALETTE.fruit, 20, {
          speed: 180,
          life: 0.6,
          size: 3,
        });
        break;
    }
  }

  private toggleCRT(): void {
    this.crtOn = !this.crtOn;
    if (this.crt) this.crt.filter.enabled = this.crtOn;
    this.audio.uiSelect();
  }

  private toggleFps(): void {
    this.showFps = !this.showFps;
    this.audio.uiSelect();
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private dotTiles: TilePos[] | null = null;

  private dotTilesNow(): TilePos[] {
    if (!this.dotTiles) this.dotTiles = this.maze.allDotTiles();
    return this.dotTiles;
  }

  private computeFields(): SimFields {
    const dangerous: TilePos[] = [];
    const edible: TilePos[] = [];
    for (const g of this.ghosts) {
      if (g.state === 'normal' || g.state === 'leaving') dangerous.push({ x: g.mover.tx, y: g.mover.ty });
      else if (g.state === 'frightened') edible.push({ x: g.mover.tx, y: g.mover.ty });
    }
    // The decoy is tracked separately so it can dominate Pac-Man's attention.
    const decoy = this.decoy
      ? this.maze.field([{ x: this.decoy.x, y: this.decoy.y }], false)
      : null;

    const avoid = this.maze.field(dangerous, false);
    const hunt = edible.length ? this.maze.field(edible, false) : null;
    const dot = this.maze.dotsLeft > 0 ? this.maze.field(this.dotTilesNow(), false) : null;
    return { avoid, hunt, dot, decoy };
  }

  private context(fields: SimFields): SimContext {
    return {
      maze: this.maze,
      nav: this.nav,
      pac: this.pac,
      ghosts: this.ghosts,
      fields,
      decoy: this.decoy,
      stance: this.stance,
      pincer: this.pincerTimer > 0,
      playerId: this.playerId,
      level: this.level,
    };
  }

  private updateSim(dt: number, ctx: SimContext): void {
    this.nav.clear();
    this.pac.update(dt, ctx);
    for (const g of this.ghosts) {
      if (g.state === 'frightened') g.frightTimer = this.frightTimer;
      g.update(dt, ctx);
    }
  }

  // -------------------------------------------------------------------------
  // Phase updates
  // -------------------------------------------------------------------------

  update(dt: number, input: Input): void {
    this.elapsed += dt;
    this.lastFps = 1 / Math.max(0.0001, dt);

    if (input.justPressed('KeyM')) {
      this.music.cycle();
      this.audio.uiSelect();
    }
    if (input.justPressed('KeyC')) this.toggleCRT();
    if (input.justPressed('KeyF')) this.toggleFps();
    if (input.justPressed('KeyN')) {
      this.muted = this.audio.toggleMute();
      this.music.setMuted(this.muted);
    }

    const sdt = dt * this.fx.timeScale;

    switch (this.phase) {
      case 'menu':
      case 'gameover':
        this.updateAttract(sdt, input);
        break;
      case 'ready':
        this.updateReady(sdt, input);
        break;
      case 'playing':
        this.updatePlaying(sdt, input);
        break;
      case 'dying':
        this.updateDying(sdt);
        break;
      case 'levelclear':
        this.updateLevelClear(sdt);
        break;
      case 'paused':
        if (input.anyPressed('KeyP', 'Escape', 'Space')) {
          this.phase = 'playing';
          this.music.setDucked(false);
        }
        break;
    }

    this.audio.updateMusic();
    this.music.update(dt);
    if (this.crt) this.crt.update(this.elapsed);

    this.render(dt);
    this.hud.update(this.hudState());
    input.clearPresses();
  }

  private updateAttract(dt: number, input: Input): void {
    if (input.anyPressed('ArrowUp', 'KeyW')) {
      this.selectGhost(this.menuSelect - 1);
      this.audio.uiSelect();
    }
    if (input.anyPressed('ArrowDown', 'KeyS')) {
      this.selectGhost(this.menuSelect + 1);
      this.audio.uiSelect();
    }
    for (let i = 0; i < GHOSTS.length; i++) {
      if (input.justPressed(`Digit${i + 1}`)) {
        this.selectGhost(i);
        this.audio.uiSelect();
      }
    }
    if (input.anyPressed('Space', 'Enter', 'NumpadEnter')) {
      this.startGame();
      return;
    }

    // Live demo: all four ghosts hunt, stances rotate, pincers fire.
    this.demoStanceTimer -= dt;
    if (this.demoStanceTimer <= 0) {
      this.demoStanceTimer = 5 + Math.random() * 3;
      this.stance = STANCE_ORDER[(Math.random() * STANCE_ORDER.length) | 0];
      if (Math.random() < 0.5) this.stance = 'hunt';
    }
    this.demoPincerTimer -= dt;
    if (this.demoPincerTimer <= 0) {
      this.demoPincerTimer = 9 + Math.random() * 5;
      this.pincerTimer = PINCER_TIME;
    }
    if (this.pincerTimer > 0) this.pincerTimer -= dt;

    this.pac.powered = this.frightTimer > 0;
    if (this.frightTimer > 0) {
      this.frightTimer -= dt;
      if (this.frightTimer <= 0) this.pac.powered = false;
    }

    const ctx = this.context(this.computeFields());
    this.updateSim(dt, ctx);
    this.resolveDots();
    this.resolveCollisions(true);

    if (this.maze.dotsLeft <= 0) {
      this.maze.resetDots();
      this.dotsDirty = true;
      this.dotTiles = null;
    }

    this.menu.update(
      dt,
      this.menuSelect,
      this.high,
      this.phase === 'gameover' ? 'gameover' : 'menu',
      this.audioHintText(),
      this.muted,
    );
    this.hud.layer.visible = false;
  }

  private updateReady(dt: number, input: Input): void {
    this.readyTimer -= dt;
    this.message = 'READY!';
    this.submessage = `LEVEL ${this.level}  ·  CATCH PAC-MAN ${this.pacLives}×`;
    this.messageColor = PALETTE.gold;
    if (this.readyTimer <= 0) {
      this.phase = 'playing';
      this.message = '';
      this.submessage = '';
    }
    // Let the player pre-steer during the countdown.
    if (this.playerGhost.state !== 'house') {
      this.playerGhost.mover.want = input.wantDir;
    }
  }

  private updatePlaying(dt: number, input: Input): void {
    // --- Controls ---
    // Steering stays available while banished (state 'eaten') so the player can
    // drive their eyes back to the house; only the in-house wait locks input.
    const pg = this.playerGhost;
    if (pg.state !== 'house') pg.mover.want = input.wantDir;

    if (input.justPressed('Digit1')) this.setStance('hunt');
    if (input.justPressed('Digit2')) this.setStance('ambush');
    if (input.justPressed('Digit3')) this.setStance('flank');
    if (input.justPressed('Digit4')) this.setStance('guard');
    if (input.anyPressed('KeyE')) this.cycleStance(1);
    if (input.anyPressed('KeyQ')) this.cycleStance(-1);
    if (input.justPressed('Space') && this.pincerCd <= 0 && this.pincerTimer <= 0) this.triggerPincer();
    if (input.anyPressed('ShiftLeft', 'ShiftRight')) this.useAbility();
    if (input.anyPressed('KeyP', 'Escape')) {
      this.phase = 'paused';
      this.music.setDucked(true);
      return;
    }

    // --- Timers ---
    if (this.pincerTimer > 0) this.pincerTimer -= dt;
    if (this.pincerCd > 0) this.pincerCd = Math.max(0, this.pincerCd - dt);
    if (this.decoyTimer > 0) {
      this.decoyTimer -= dt;
      if (this.decoyTimer <= 0) this.decoy = null;
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.message = '';
        this.submessage = '';
      }
    }

    if (this.frightTimer > 0) {
      this.frightTimer = Math.max(0, this.frightTimer - dt);
      if (this.frightTimer === 0) {
        this.pac.powered = false;
        this.ghostsEaten = 0;
      }
    }

    // Hit-stop after a big moment.
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      this.fx.update(dt);
      this.render(dt);
      return;
    }

    // --- Sim ---
    this.pac.powered = this.frightTimer > 0;
    const ctx = this.context(this.computeFields());
    this.updateSim(dt, ctx);
    this.resolveDots();
    this.resolveCollisions(false);

    // Siren pitch tracks how close Pac-Man is to clearing the board.
    this.sirenTimer -= dt;
    if (this.sirenTimer <= 0) {
      this.sirenTimer = 0.55;
      const eaten = 1 - this.maze.dotsLeft / Math.max(1, this.maze.dotsTotal);
      this.audio.siren(eaten);
    }
  }

  private updateDying(dt: number): void {
    this.dyingTimer -= dt;
    this.pac.deathT += dt;
    this.message = 'CAUGHT!';
    this.messageColor = PALETTE.gold;
    if (this.dyingTimer <= 0) {
      this.spawnRound();
      this.phase = 'ready';
      this.readyTimer = READY_TIME;
    }
  }

  private updateLevelClear(dt: number): void {
    this.levelClearTimer -= dt;
    this.message = 'LEVEL CLEAR!';
    this.submessage = `ALL ${PAC_LIVES} CATCHES MADE`;
    this.messageColor = PALETTE.accent2;
    if (this.levelClearTimer <= 0) this.newLevel();
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  private resolveDots(): void {
    // Pac-Man eats the pellet under his current tile.
    if (!this.pac.alive) return;
    const t = this.pac.mover.tile;
    const v = this.maze.eat(t.x, t.y);
    if (v === 0) return;

    this.dotsDirty = true;
    this.dotTiles = null;
    this.wakaAlt = !this.wakaAlt;
    this.audio.waka(this.wakaAlt);

    if (v === 2) {
      this.frightTimer = FRIGHT_TIME;
      this.pac.powered = true;
      this.ghostsEaten = 0;
      for (const g of this.ghosts) g.frighten();
      this.audio.powerUp();
      this.fx.flash(PALETTE.power, 0.35, 0.3);
      this.fx.shake(5, 0.3);
      this.flashMessage('POWER UP!', 'PAC-MAN HUNTS YOU', PALETTE.power, 1.4);
    } else {
      this.fx.burst(this.pac.px, this.pac.py, PALETTE.dot, 5, {
        speed: 70,
        life: 0.3,
        size: 2,
        grav: 0,
      });
    }

    if (this.maze.dotsLeft <= 0) this.pacEscaped();
  }

  private pacEscaped(): void {
    this.lives--;
    this.audio.banished();
    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.flashMessage('PAC-MAN ESCAPED!', `${this.lives} LIVES LEFT`, PALETTE.danger, 2);
    this.level++;
    this.pacLives = PAC_LIVES;
    this.maze.resetDots();
    this.dotsDirty = true;
    this.dotTiles = null;
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.syncMusic();
  }

  private resolveCollisions(demo: boolean): void {
    if (!this.pac.alive) return;
    const reach = TILE * 0.55;

    for (const g of this.ghosts) {
      const d = Math.hypot(g.px - this.pac.px, g.py - this.pac.py);

      if (this.frightTimer > 0 && g.state === 'frightened') {
        if (d < reach) this.eatGhost(g, demo);
        continue;
      }

      if (g.isDangerous() && d < reach) {
        if (demo) {
          this.demoReset();
        } else {
          this.onPacCaught();
        }
        return;
      }
    }
  }

  private demoReset(): void {
    this.fx.burst(this.pac.px, this.pac.py, PALETTE.pac, 30, { speed: 220, life: 0.7, size: 4 });
    this.spawnRound();
  }

  private onPacCaught(): void {
    const combo = this.pincerTimer > 0 ? 2 : 1;
    const pts = 200 * this.level * combo;
    this.score += pts;
    this.saveHigh();
    this.audio.catchPac();
    this.fx.flash(PALETTE.gold, 0.55, 0.25);
    this.fx.shake(10, 0.5);
    this.fx.burst(this.pac.px, this.pac.py, PALETTE.pac, 44, { speed: 280, life: 0.8, size: 4 });
    this.fx.pop(`+${pts}${combo > 1 ? ' ×2' : ''}`, this.pac.px, this.pac.py - 24, PALETTE.gold, 16);

    this.pac.alive = false;
    this.pac.deathT = 0;
    this.pacLives--;

    if (this.pacLives <= 0) {
      this.message = 'LEVEL CLEAR!';
      this.messageColor = PALETTE.accent2;
      this.phase = 'levelclear';
      this.levelClearTimer = 2.6;
      this.audio.levelClear();
    } else {
      this.message = 'CAUGHT!';
      this.messageColor = PALETTE.gold;
      this.phase = 'dying';
      this.dyingTimer = 1.3;
    }
  }

  private eatGhost(g: Ghost, demo: boolean): void {
    g.state = 'eaten';
    g.mover.ghostPass = true;
    g.mover.phase = false;
    g.frightTimer = 0;
    this.ghostsEaten++;
    const pts = 200 * this.ghostsEaten;

    // The attract-mode demo runs the real simulation but must never touch the
    // player's score or the persisted high score.
    if (!demo) {
      this.score += pts;
      this.saveHigh();
    }

    this.audio.eatGhost();
    this.fx.shake(7, 0.4);
    this.fx.flash(PALETTE.power, 0.4, 0.22);
    this.fx.burst(g.px, g.py, g.def.color, 30, { speed: 240, life: 0.7, size: 4 });
    this.fx.pop(`+${pts}`, g.px, g.py - 18, PALETTE.power, 13);
    this.freezeTimer = demo ? 0 : 0.35;

    if (g.isPlayer && !demo) {
      this.score = Math.max(0, this.score - 300);
      this.flashMessage("YOU'RE BANISHED!", 'PAC-MAN GOT YOU', PALETTE.danger, 2);
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(dt: number): void {
    const shake = this.fx.updateShake(dt);
    const demo = this.phase === 'menu' || this.phase === 'gameover';

    if (demo) {
      // Title screen: present the whole board, scaled to the viewport.
      const scale = Math.min((VIEW_W - 20) / WORLD_W, (SCREEN_H - 20) / WORLD_H);
      this.world.alpha = 0.62;
      this.world.scale.set(scale);
      this.world.position.set(
        (VIEW_W - WORLD_W * scale) / 2 + shake.x,
        (SCREEN_H - WORLD_H * scale) / 2 + shake.y,
      );
    } else {
      // Vertically scrolling camera: frame the player and Pac-Man together.
      const visibleH = SCREEN_H / MAZE_ZOOM;
      const focusY = this.playerGhost.py * 0.68 + this.pac.py * 0.32;
      const target = Math.max(0, Math.min(CAM_MAX, focusY - visibleH * 0.56));
      this.camY += (target - this.camY) * Math.min(1, dt * 5.5);
      this.world.alpha = 1;
      this.world.scale.set(MAZE_ZOOM);
      this.world.position.set(MAZE_OFFSET_X + shake.x, -this.camY * MAZE_ZOOM + shake.y);
    }

    if (this.dotsDirty) {
      this.rebuildDots();
      this.dotsDirty = false;
    }
    // Drift the wall texture for a subtle living surface.
    this.drawWallDots();
    this.drawPower();
    this.drawDoorGfx();
    this.drawPac();
    for (const g of this.ghosts) this.drawGhostView(g);
    this.drawDecoy();
    this.drawPlayerRing();
    this.drawIntent();
    this.drawOffscreenPac();

    this.fx.update(dt);
  }

  /** Edge arrow pointing at Pac-Man when he scrolls out of view. */
  private drawOffscreenPac(): void {
    this.overlayGfx.clear();
    if (this.phase === 'menu' || this.phase === 'gameover' || !this.pac.alive) return;

    const sy = (this.pac.py - this.camY) * MAZE_ZOOM;
    const sx = this.pac.px * MAZE_ZOOM + MAZE_OFFSET_X;
    const pad = 22;
    if (sy >= pad && sy <= SCREEN_H - pad) return;

    const top = sy < pad;
    const y = top ? pad : SCREEN_H - pad;
    const x = Math.max(40, Math.min(VIEW_W - 40, sx));
    const dir = top ? -1 : 1;

    this.overlayGfx.moveTo(x, y + dir * 9);
    this.overlayGfx.lineTo(x - 13, y - dir * 6);
    this.overlayGfx.lineTo(x + 13, y - dir * 6);
    this.overlayGfx.closePath();
    this.overlayGfx.fill({ color: PALETTE.pac, alpha: 0.92 });
    this.overlayGfx
      .circle(x, y - dir * 18, 5)
      .fill({ color: PALETTE.pac, alpha: 0.55 });
  }

  private drawPower(): void {
    this.powerGfx.clear();
    const a = 0.85 + 0.15 * Math.sin(this.elapsed * 6);
    const r = TILE * 0.2 * a;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 2) continue;
      const c = i % COLS;
      const rr = (i / COLS) | 0;
      this.powerGfx.circle(centerOf(c), centerOf(rr), r).fill(PALETTE.power);
    }
  }

  private drawDoorGfx(): void {
    this.doorGfx.clear();
    const a = 0.45 + 0.3 * Math.sin(this.elapsed * 4);
    drawDoor(this.doorGfx, TILE * 1.9, 5, a);
    this.doorGfx.position.set((COLS / 2) * TILE, centerOf(12));
  }

  private drawPac(): void {
    const g = this.pacView;
    g.clear();
    if (!this.pac.alive) {
      const t = Math.min(1, this.pac.deathT / 1.1);
      const r = TILE * 0.46 * (1 - t);
      if (r > 0.6) drawPacman(g, r, 0.05 + t * 2.6, PALETTE.pac);
      g.position.set(this.pac.px, this.pac.py);
      this.pacAngle = angleLerp(this.pacAngle, this.pacAngle, 1);
      g.rotation = this.pacAngle;
      return;
    }
    drawPacman(g, TILE * 0.46, this.pac.mouth, PALETTE.pac);
    // Powered up: a visible "hunter" aura so the reversal reads instantly.
    if (this.pac.powered) {
      const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * 12);
      g.circle(0, 0, TILE * 0.62).stroke({
        width: 2.5,
        color: PALETTE.power,
        alpha: 0.35 + 0.4 * pulse,
      });
      g.circle(0, 0, TILE * 0.78).stroke({
        width: 1.5,
        color: PALETTE.power,
        alpha: 0.15 + 0.2 * pulse,
      });
    }
    g.position.set(this.pac.px, this.pac.py);
    const target = dirAngle(this.pac.mover.dir, this.pacAngle);
    this.pacAngle = angleLerp(this.pacAngle, target, 0.25);
    g.rotation = this.pacAngle;
  }

  private drawGhostView(g: Ghost): void {
    const view = this.ghostViews.get(g.id);
    if (!view) return;
    view.clear();
    const frightened = g.state === 'frightened';
    drawGhost(view, TILE * 0.45, {
      color: g.def.color,
      dir: g.mover.dir,
      frightened,
      flash: g.flash,
      eaten: g.state === 'eaten',
      wave: 2.5 + 2.5 * Math.sin(this.elapsed * 9 + g.mover.tx),
    });
    view.position.set(g.px, g.py);
    view.alpha = g.state === 'eaten' ? 0.75 : 1;
  }

  private drawDecoy(): void {
    this.decoyView.clear();
    if (!this.decoy) return;
    const x = centerOf(this.decoy.x);
    const y = centerOf(this.decoy.y);
    this.decoyView.position.set(x, y);
    drawGhost(this.decoyView, TILE * 0.45, {
      color: PALETTE.fruit,
      dir: 'left',
      wave: 3,
    });
    this.decoyView.alpha = 0.55 + 0.3 * Math.sin(this.elapsed * 8);
    this.decoyView
      .circle(0, 0, TILE * 0.72)
      .stroke({ width: 1.5, color: PALETTE.fruit, alpha: 0.3 + 0.25 * Math.sin(this.elapsed * 8) });
  }

  private drawPlayerRing(): void {
    this.playerRing.clear();
    if (this.phase === 'menu' || this.phase === 'gameover') return;
    const g = this.playerGhost;
    if (!g) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 5);
    this.playerRing.circle(g.px, g.py, TILE * 0.66).stroke({
      width: 1.5,
      color: g.def.color,
      alpha: 0.25 + 0.3 * pulse,
    });
  }

  private drawIntent(): void {
    this.intentGfx.clear();
    const show = this.phase === 'playing' || this.phase === 'ready' || this.phase === 'menu' || this.phase === 'gameover';
    if (!show) return;

    // Banished? Mark the house so it's obvious where to drive back to.
    if (this.playerGhost.state === 'eaten') {
      const hx = centerOf(HOUSE_CENTER.x);
      const hy = centerOf(HOUSE_CENTER.y);
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 6);
      this.intentGfx.circle(hx, hy, TILE * (0.8 + 0.25 * pulse)).stroke({
        width: 2,
        color: this.playerGhost.def.color,
        alpha: 0.35 + 0.35 * pulse,
      });
      this.intentGfx.circle(hx, hy, TILE * 0.45).fill({
        color: this.playerGhost.def.color,
        alpha: 0.18,
      });
    }

    for (const g of this.ghosts) {
      if (g.isPlayer) continue;
      if (g.state === 'eaten' || g.state === 'house') continue;
      const tx = centerOf(g.lastTarget.x);
      const ty = centerOf(g.lastTarget.y);
      this.intentGfx.moveTo(g.px, g.py).lineTo(tx, ty);
      this.intentGfx.stroke({ width: 1, color: g.def.color, alpha: 0.14 });
      this.intentGfx.circle(tx, ty, 3).stroke({ width: 1.2, color: g.def.color, alpha: 0.3 });
    }
  }

  private hudState(): HudState {
    const pg = this.playerGhost;
    const banished = !!pg && (pg.state === 'eaten' || pg.state === 'house');

    return {
      score: this.score,
      high: this.high,
      level: this.level,
      lives: this.lives,
      pacLives: this.pacLives,
      stance: this.stance,
      pincerReady: this.pincerCd <= 0 && this.pincerTimer <= 0,
      pincerCd: this.pincerCd,
      pincerMax: PINCER_COOLDOWN,
      abilityName: banished ? 'BANISHED' : pg ? pg.def.abilityName : '',
      abilityLocked: !!pg && pg.state !== 'normal',
      abilityReady: pg ? pg.cooldown <= 0 && pg.state === 'normal' : false,
      abilityCd: pg ? pg.cooldown : 0,
      abilityMax: pg ? pg.def.cooldown : 1,
      playerColor: pg ? pg.def.color : PALETTE.accent,
      playerName: pg ? pg.def.name : '',
      playerAbility: pg ? pg.def.abilityName : '',
      playerAbilityDesc: pg ? pg.def.abilityDesc : '',
      frightTimer: this.frightTimer,
      frightMax: FRIGHT_TIME,
      message:
        this.phase === 'paused'
          ? 'PAUSED'
          : banished
            ? 'BANISHED!'
            : this.message,
      submessage:
        this.phase === 'paused'
          ? 'PRESS P TO RESUME'
          : banished
            ? pg && pg.state === 'eaten'
              ? 'DRIVE BACK TO THE HOUSE'
              : 'RESPAWNING…'
            : this.submessage,
      messageColor:
        this.phase === 'paused'
          ? PALETTE.text
          : banished
            ? PALETTE.danger
            : this.messageColor,
      muted: this.muted,
      trackName: this.audioHintText(),
      showFps: this.showFps,
      fps: this.lastFps,
    };
  }

  /** Menu/HUD line describing the audio state, so silence is never a mystery. */
  private audioHintText(): string {
    if (!this.music.available) return '';
    if (this.muted) return 'SOUND MUTED  ·  N TO UNMUTE';
    if (!this.music.unlockedFlag) {
      return this.music.buffered ? 'PRESS ANY KEY FOR SOUND' : 'LOADING AUDIO…';
    }
    return this.music.trackName ? `♪ ${this.music.trackName}` : '';
  }

  /** Called by the bootstrap if the frame rate can't hold up. */
  setLowQuality(): void {
    this.bloom = createBloom('low');
    this.world.filters = [this.bloom];
    this.crtOn = false;
    if (this.crt) this.crt.filter.enabled = false;
  }

  /** Re-run every width-dependent layout after a viewport change. */
  layout(): void {
    this.buildBackdrop();
    this.hud.layout();
    this.menu.layout();
    this.fx.resize(SCREEN_W, SCREEN_H);
    this.crt?.resize(this.app.renderer.width, this.app.renderer.height);
  }

  /** Called on window resize; keeps the CRT in step with the render target. */
  onResize(): void {
    this.layout();
  }

  destroy(): void {
    this.audio.stopMusic();
    this.app.stage.removeChildren();
  }
}
