import { Application, Container, Graphics } from 'pixi.js';
import {
  ABILITY_TIME,
  CAM_MAX,
  COLS,
  BLIND_TIME,
  EXTRA_LIFE_EVERY,
  FRIGHT_TIME,
  GHOSTS,
  HOUSE_CENTER,
  MAX_LIVES,
  MAZE_OFFSET_X,
  MAZE_ZOOM,
  PAC_LIVES,
  PALETTE,
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
  themeForLevel,
} from './config';
import type { FieldTheme } from './config';
import { lerpColor } from './color';
import { levelFor } from './levels';
import { Maze, NavCache, WALL } from './maze';
import { centerOf } from './mover';
import { Ghost, Pacman, threatField } from './actors';
import type { SimContext, SimFields } from './actors';
import { SKIRT_RATE, drawDoor, drawGhost, drawGhostSilhouette, drawPacman, drawSparkle } from './draw';
import { Fx } from './fx';
import { GameAudio } from './audio';
import { Hud } from './hud';
import type { HudState } from './hud';
import { HEADER_H, Menu } from './menu';
import { createBloom, createCRT } from './filters';
import type { CrtResult } from './filters';
import { DIRS } from './types';
import type { Dir, GamePhase, GhostId, Stance, TilePos, UnitDir } from './types';
import type { Input, InputDevice } from './input';
import { desktop } from './desktop';
import { MusicPlayer } from './music';
import { lattice, valueNoise } from './noise';

// Bundled music (CC-BY 4.0 — see README for attribution).
import menuTrack from './assets/audio/01-falling-organ.mp3';
import levelTrack1 from './assets/audio/02-tyranny-of-the-sun.mp3';
import levelTrack2 from './assets/audio/03-work-in-progress.mp3';
import levelTrack3 from './assets/audio/04-demons-on-the-beach.mp3';
import levelTrack4 from './assets/audio/05-solitude.mp3';
import levelTrack5 from './assets/audio/06-the-climax.mp3';

/** Pause-screen entries: only the desktop build can quit from inside the game. */
const PAUSE_ITEMS: readonly string[] = desktop ? ['RESUME', 'QUIT GAME'] : [];

/** Title-screen demo camera: tiles visible top to bottom, and seconds per ghost. */
const DEMO_TILES_TALL = 11;
const DEMO_FOCUS_TIME = 5;
/** Redraw rate of the drifting wall texture (see drawWallDots). */
const WALL_DOTS_HZ = 20;
/** Motion-trail sampling interval (see drawTrails). */
const TRAIL_STEP = 1 / 60;

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
  private frightTimer = 0;

  // Rules / progress.
  phase: GamePhase = 'menu';
  private score = 0;
  private high = 0;
  private level = 1;
  private lives = PLAYER_LIVES;
  private nextLifeAt = EXTRA_LIFE_EVERY;
  private pacLives = PAC_LIVES;
  /** Was the player's ability usable last frame? (For the "ready" cue.) */
  private abilityWasReady = true;
  /** Game over is decided; it lands once the current hit-stop ends. */
  private gameOverPending = false;

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

  // Presentation.
  private readonly world = new Container();
  private readonly backdrop = new Graphics();
  private readonly floorGrid = new Graphics();
  private readonly floorGlow = new Graphics();
  /** This level's playfield colours. */
  private theme: FieldTheme = themeForLevel(1);
  private readonly mazeFill = new Graphics();
  private readonly mazeGfx = new Graphics();
  private readonly wallDots = new Graphics();
  private readonly dotGfx = new Graphics();
  private readonly sparkleGfx = new Graphics();
  private readonly powerGfx = new Graphics();
  private readonly doorGfx = new Graphics();
  private readonly portalGfx = new Graphics();
  private readonly trailGfx = new Graphics();
  private readonly actorLayer = new Container();
  private readonly overlayGfx = new Graphics();
  private readonly intentGfx = new Graphics();
  private readonly pacView = new Graphics();
  /** The "!" over Pac-Man while Clyde has him blinded. */
  private readonly alertView = new Graphics();
  private readonly playerRing = new Graphics();
  private readonly ghostViews = new Map<GhostId, Graphics>();
  /** Recent on-screen positions per actor, newest last, for motion trails. */
  private readonly trails = new Map<string, Array<{ x: number; y: number }>>();
  private bloom = createBloom();
  private crt: CrtResult | null = null;
  private crtOn = true;
  private showFps = false;

  private dotsDirty = true;
  private elapsed = 0;
  private camY = 0;
  /** Title-screen demo: the framed area, the ghost in focus, and the camera. */
  private readonly demoMask = new Graphics();
  private demoFocus = 0;
  private demoFocusT = 0;
  private demoCam: { x: number; y: number } | null = null;
  private wallDotsWindow = -1;
  private wallDotsAt = 0;
  private trailClock = 0;
  private pacAngle = dirAngle('left', Math.PI);
  private muted = false;
  /** Last device the player used; prompts and hints are worded for it. */
  private device: InputDevice = 'keyboard';
  /** Highlighted entry of the pause menu (desktop build only). */
  private pauseSelect = 0;
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

    this.actorLayer.addChildAt(this.trailGfx, 0);
    this.actorLayer.addChild(this.playerRing, this.intentGfx, this.pacView, this.alertView);
    this.world.addChild(
      this.floorGrid,
      this.floorGlow,
      this.mazeFill,
      this.wallDots,
      this.mazeGfx,
      this.portalGfx,
      this.dotGfx,
      this.sparkleGfx,
      this.powerGfx,
      this.doorGfx,
      this.actorLayer,
    );
    this.world.position.set(0, 0);

    this.buildMaze();
    this.buildBackdrop();
    this.layoutDemoMask();

    // Stage layering: menu background → world → HUD → menu UI → FPS → flash.
    app.stage.addChild(
      this.backdrop,
      this.menu.bgLayer,
      this.world,
      this.overlayGfx,
      this.hud.layer,
      this.menu.uiLayer,
      this.hud.fpsLayer,
      this.fx.flashLayer,
      this.demoMask,
    );
    this.fx.layer.visible = true;
    this.world.addChild(this.fx.layer);

    this.hud.layer.visible = false;

    try {
      this.crt = createCRT();
      app.stage.filters = [this.crt.filter];
      // Pin the pass to the full screen so the warp centre never depends on the
      // stage's content bounds.
      app.stage.filterArea = app.screen;
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

  private isWallTile(c: number, r: number): boolean {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return this.maze.kindAt(c, r) === WALL;
  }

  /**
   * Corner-aware wall outline at a given inset, grouped by row so each row can
   * carry its own gradient colour. Returns [x1, y1, x2, y2] segments.
   *
   * A segment's end is pulled in to the inset point where the outline turns
   * convexly (that edge exists AND the diagonal tile is open), pushed out past
   * the tile boundary where it turns concavely (neighbour and diagonal are both
   * wall, so the perpendicular line sits `inset` beyond the boundary), and
   * otherwise runs to the boundary so straight runs stay continuous.
   */
  private wallSegments(inset: number): number[][][] {
    const isWall = (c: number, r: number): boolean => this.isWallTile(c, r);
    const end = (open: boolean, diagOpen: boolean, base: number, sign: number): number => {
      if (open && diagOpen) return base + sign * inset;
      if (!open && !diagOpen) return base - sign * inset;
      return base;
    };

    const rows: number[][][] = [];
    for (let r = 0; r < ROWS; r++) {
      const segs: number[][] = [];
      for (let c = 0; c < COLS; c++) {
        if (!isWall(c, r)) continue;
        const x = c * TILE;
        const y = r * TILE;
        const L = !isWall(c - 1, r);
        const R = !isWall(c + 1, r);
        const T = !isWall(c, r - 1);
        const B = !isWall(c, r + 1);
        const TL = !isWall(c - 1, r - 1);
        const TR = !isWall(c + 1, r - 1);
        const BL = !isWall(c - 1, r + 1);
        const BR = !isWall(c + 1, r + 1);

        if (T) segs.push([end(L, TL, x, 1), y + inset, end(R, TR, x + TILE, -1), y + inset]);
        if (B) segs.push([end(L, BL, x, 1), y + TILE - inset, end(R, BR, x + TILE, -1), y + TILE - inset]);
        if (L) segs.push([x + inset, end(T, TL, y, 1), x + inset, end(B, BL, y + TILE, -1)]);
        if (R) segs.push([x + TILE - inset, end(T, TR, y, 1), x + TILE - inset, end(B, BR, y + TILE, -1)]);
      }
      rows.push(segs);
    }
    return rows;
  }

  private strokeSegments(
    g: Graphics,
    rows: number[][][],
    width: number,
    alpha: number,
    tint: (base: number) => number = (c) => c,
  ): void {
    rows.forEach((segs, r) => {
      if (!segs.length) return;
      for (const [x1, y1, x2, y2] of segs) g.moveTo(x1, y1).lineTo(x2, y2);
      const col = tint(lerpColor(this.theme.top, this.theme.bottom, r / (ROWS - 1)));
      g.stroke({ width, color: col, alpha, cap: 'round', join: 'round' });
    });
  }

  /**
   * The maze and theme for `level` (both cycle through their lists), pellets
   * reset; the playfield is repainted when either changes.
   */
  private setupLevel(level: number): void {
    const def = levelFor(level);
    const theme = themeForLevel(level);
    const newMaze = def !== this.maze.level;
    if (newMaze) this.maze.load(def);
    else this.maze.resetDots();
    this.dotsDirty = true;
    this.dotTiles = null;
    this.nav.clear();
    if (!newMaze && theme === this.theme) return;
    this.theme = theme;
    this.buildMaze();
  }

  private buildMaze(): void {
    this.wallDotsWindow = -1; // the texture takes the theme's accent
    this.mazeFill.clear();
    this.mazeGfx.clear();
    // Solid fill, row-tinted for a vertical gradient.
    for (let r = 0; r < ROWS; r++) {
      const col = lerpColor(this.theme.fillTop, this.theme.fillBottom, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (this.maze.kindAt(c, r) === WALL) {
          this.mazeFill.rect(c * TILE, r * TILE, TILE, TILE).fill(col);
        }
      }
    }

    // Neon tubes: a soft halo, an inner "double wall" echo (the classic arcade
    // two-line look), the coloured tube itself and a white-hot core.
    const outer = this.wallSegments(2);
    const inner = this.wallSegments(8);
    this.strokeSegments(this.mazeGfx, outer, 11, 0.07);
    this.strokeSegments(this.mazeGfx, inner, 1.5, 0.42);
    this.strokeSegments(this.mazeGfx, outer, 3, 1);
    this.strokeSegments(this.mazeGfx, outer, 1, 0.55, (c) => lerpColor(c, PALETTE.white, 0.75));

    this.buildFloor();
  }

  /**
   * The corridor floor: a faint synthwave grid (it scrolls, see drawFloorGrid)
   * plus light spilling off every neon wall onto the adjacent floor, and a warm
   * glow inside the ghost house. Walls are opaque, so the grid only shows
   * through the corridors.
   */
  private buildFloor(): void {
    const grid = this.floorGrid;
    grid.clear();
    for (let x = 0; x <= COLS; x++) grid.moveTo(x * TILE, -TILE).lineTo(x * TILE, WORLD_H + TILE);
    for (let y = -1; y <= ROWS + 1; y++) grid.moveTo(0, y * TILE).lineTo(WORLD_W, y * TILE);
    grid.stroke({ width: 1, color: this.theme.top, alpha: 0.075 });

    const glow = this.floorGlow;
    glow.clear();
    const spill = [3, 7, 12];
    for (let r = 0; r < ROWS; r++) {
      const col = lerpColor(this.theme.top, this.theme.bottom, r / (ROWS - 1));
      for (let c = 0; c < COLS; c++) {
        if (this.isWallTile(c, r)) continue;
        // Out-of-bounds tiles (the tunnel mouths) aren't walls: no spill there.
        const wallAt = (cc: number, rr: number): boolean => cc >= 0 && cc < COLS && this.isWallTile(cc, rr);
        const x = c * TILE;
        const y = r * TILE;
        for (const w of spill) {
          if (wallAt(c, r - 1)) glow.rect(x, y, TILE, w);
          if (wallAt(c, r + 1)) glow.rect(x, y + TILE - w, TILE, w);
          if (wallAt(c - 1, r)) glow.rect(x, y, w, TILE);
          if (wallAt(c + 1, r)) glow.rect(x + TILE - w, y, w, TILE);
        }
        glow.fill({ color: col, alpha: 0.045 });
      }
    }

    // Ghost house: a little striped sunset behind the waiting ghosts.
    const hx = 11 * TILE;
    const hy = 13 * TILE;
    const hw = 6 * TILE;
    const hh = 3 * TILE;
    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      const t = i / (stripes - 1);
      const sh = hh / stripes;
      const gap = sh * 0.45 * t;
      glow.rect(hx, hy + i * sh + gap, hw, sh - gap).fill({
        color: lerpColor(PALETTE.sunMid, PALETTE.sunBot, t),
        alpha: 0.13 * (1 - t * 0.6),
      });
    }
  }

  /**
   * Wall texture: one soft dot per wall tile whose size and position are driven
   * by slowly drifting value noise. Nearby dots share the field, so the walls
   * breathe in soft waves instead of flickering. Only tiles inside the camera
   * window are drawn, keeping the cost flat. The field drifts slowly, so it is
   * rebuilt at WALL_DOTS_HZ (or when the window gains a tile) rather than every
   * frame: rebuilding a thousand-odd circles was a big share of each frame.
   */
  private drawWallDots(): void {
    // The camera window in tiles, from the world transform (already set).
    const s = this.world.scale.x;
    const c0 = Math.max(0, Math.floor(-this.world.x / s / TILE) - 1);
    const c1 = Math.min(COLS, Math.ceil((VIEW_W - this.world.x) / s / TILE) + 1);
    const r0 = Math.max(0, Math.floor(-this.world.y / s / TILE) - 1);
    const r1 = Math.min(ROWS, Math.ceil((SCREEN_H - this.world.y) / s / TILE) + 1);
    const t = this.elapsed;
    const win = c0 + c1 * 64 + r0 * 4096 + r1 * 262144;
    if (win === this.wallDotsWindow && t - this.wallDotsAt < 1 / WALL_DOTS_HZ) return;
    this.wallDotsWindow = win;
    this.wallDotsAt = t;
    this.wallDots.clear();

    // The noise field itself drifts diagonally; the second octave adds detail.
    const driftX = t * 0.045;
    const driftY = t * 0.03;

    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
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
              .fill({ color: this.theme.accent, alpha: 0.05 + k * 0.09 });
          }
        }
      }
    }
  }

  /** Slow downward scroll of the floor grid — the synthwave road, underfoot. */
  private drawFloorGrid(): void {
    this.floorGrid.y = (this.elapsed * 5) % TILE;
    this.floorGrid.alpha = 0.8 + 0.2 * Math.sin(this.elapsed * 0.7);
  }

  /** A few pellets at a time flare into a brief four-point glint. */
  private drawSparkles(): void {
    const g = this.sparkleGfx;
    g.clear();
    const t = this.elapsed;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      const h = lattice(i, 7, 3);
      const s = Math.sin(t * (0.5 + h * 0.6) + h * 60);
      if (s < 0.99) continue;
      const k = (s - 0.99) / 0.01;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      drawSparkle(g, centerOf(c), centerOf(r), TILE * 0.3 * k, PALETTE.white, 0.85 * k, t * 2);
    }
  }

  /** The wrap-around tunnel mouths: warp-gate stripes streaming outward. */
  private drawPortals(): void {
    const g = this.portalGfx;
    g.clear();
    for (const row of this.maze.tunnelRows) this.drawPortal(g, row * TILE);
  }

  private drawPortal(g: Graphics, y: number): void {
    const depth = TILE * 1.6;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? 0 : WORLD_W;
      for (let i = 0; i < 4; i++) {
        const w = depth * (1 - i / 4);
        g.rect(side < 0 ? edge : edge - w, y + 4, w, TILE - 8).fill({ color: PALETTE.accent2, alpha: 0.035 });
      }
      for (let k = 0; k < 6; k++) {
        const p = (this.elapsed * 1.2 + k / 6) % 1;
        const x = edge - side * depth * (1 - p);
        g.rect(x - 1, y + 5, 2, TILE - 10).fill({ color: PALETTE.accent2, alpha: 0.5 * p });
      }
      g.rect(side < 0 ? edge : edge - 2, y + 2, 2, TILE - 4).fill({ color: PALETTE.white, alpha: 0.6 });
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
      this.dotGfx.circle(centerOf(i % COLS), centerOf((i / COLS) | 0), rad * 2.6);
    }
    this.dotGfx.fill({ color: PALETTE.accent, alpha: 0.13 });
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 1) continue;
      this.dotGfx.circle(centerOf(i % COLS), centerOf((i / COLS) | 0), rad);
    }
    this.dotGfx.fill(PALETTE.dot);
  }

  // -------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------

  private enterAttract(): void {
    this.phase = 'menu';
    this.setupLevel(1);
    this.demoCam = null;
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.ghosts) g.isPlayer = false;
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
    this.setupLevel(this.level);
    this.lives = PLAYER_LIVES;
    this.nextLifeAt = EXTRA_LIFE_EVERY;
    this.gameOverPending = false;
    this.pacLives = PAC_LIVES;
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
    this.abilityWasReady = true;
    this.openPellet = null;
    this.nav.clear();

    // Snap the camera so a round never opens with a long pan.
    const visibleH = SCREEN_H / MAZE_ZOOM;
    const focusY = (this.playerGhost ? this.playerGhost.py : this.pac.py) * 0.68 + this.pac.py * 0.32;
    this.camY = Math.max(0, Math.min(CAM_MAX, focusY - visibleH * 0.56));
  }

  private newLevel(): void {
    this.level++;
    this.setupLevel(this.level);
    this.pacLives = PAC_LIVES;
    this.spawnRound();
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
    this.syncMusic();
  }

  private gameOver(): void {
    this.demoCam = null;
    this.setupLevel(1);
    this.gameOverPending = false;
    this.freezeTimer = 0;
    this.phase = 'gameover';
    this.audio.gameOver();
    this.saveHigh();
    this.hud.layer.visible = false;
    this.menu.setVisible(true);
    for (const g of this.ghosts) g.isPlayer = false;
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

  /** Menu track on the title screen; the in-game playlist (never restarted) otherwise. */
  private syncMusic(): void {
    if (this.music.available) {
      this.audio.stopMusic();
      if (this.isAttract) this.music.playMenu();
      else this.music.playGame();
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

  private useAbility(): void {
    const g = this.playerGhost;
    // Only while actively hunting. Being frightened, eaten, or waiting in the
    // house locks the ability — that's the cost of the power-pellet reversal.
    if (!g || g.cooldown > 0 || g.state !== 'normal') return;
    g.cooldown = g.def.cooldown;
    this.audio.ability();
    this.fx.ring(g.px, g.py, g.def.color, TILE * 1.8, 0.35, 2.5);
    switch (g.def.ability) {
      case 'dash':
        g.dashTimer = ABILITY_TIME;
        this.fx.burst(g.px, g.py, g.def.color, 22, { speed: 200, life: 0.5, size: 3 });
        break;
      case 'warp': {
        const m = g.mover;
        const d = m.dir !== 'none' ? m.dir : m.want;
        const dest = d === 'none' ? null : this.corridorEnd(g, d as UnitDir);
        if (!dest) break;
        this.fx.burst(g.px, g.py, g.def.color, 18, { speed: 180, life: 0.4, size: 3 });
        m.place(dest.x, dest.y, d);
        m.want = d;
        this.fx.flash(PALETTE.accent, 0.25, 0.2);
        this.fx.burst(g.px, g.py, g.def.color, 26, { speed: 220, life: 0.5, size: 3 });
        this.fx.ring(g.px, g.py, g.def.color, TILE * 1.8, 0.35, 2.5);
        break;
      }
      case 'phase':
        g.beginPhase();
        this.fx.burst(g.px, g.py, g.def.color, 18, { speed: 160, life: 0.5, size: 3 });
        break;
      case 'blind': {
        const p = this.pac;
        p.blind = BLIND_TIME;
        this.audio.alert();
        this.fx.ring(p.px, p.py, PALETTE.danger, TILE * 2.4, 0.4, 3);
        break;
      }
    }
  }

  /**
   * WARP: straight ahead to the far end of the corridor — the last tile before
   * a wall, ignoring side openings on the way. It follows the side portal like
   * any corridor, and lands one tile short of Pac-Man rather than on or past
   * him, so it sets up a catch instead of making one.
   */
  private corridorEnd(g: Ghost, d: UnitDir): TilePos | null {
    const m = g.mover;
    const pac = [this.pac.mover.tile, this.pac.mover.nextTile];
    let cur = m.tile;
    let moved = false;
    for (let i = 0; i < COLS + ROWS && m.canEnterFrom(cur.x, cur.y, d); i++) {
      const next = { x: (cur.x + DIRS[d].x + COLS) % COLS, y: cur.y + DIRS[d].y };
      if (pac.some((p) => p.x === next.x && p.y === next.y)) break;
      cur = next;
      moved = true;
    }
    return moved ? cur : null;
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
  private openPellet: TilePos | null = null;

  /**
   * GUARD never covers one power pellet, so Pac-Man always has one to go for.
   * It's picked at random each round, and again once he's eaten it.
   */
  private pickOpenPellet(): TilePos | null {
    const tiles = this.maze.powerTiles();
    const p = this.openPellet;
    if (!p || !tiles.some((t) => t.x === p.x && t.y === p.y)) {
      this.openPellet = tiles.length ? tiles[(Math.random() * tiles.length) | 0] : null;
    }
    return this.openPellet;
  }

  private dotTilesNow(): TilePos[] {
    if (!this.dotTiles) this.dotTiles = this.maze.allDotTiles();
    return this.dotTiles;
  }

  private computeFields(): SimFields {
    const threat = threatField(this.maze, this.ghosts, this.level);
    const dot = this.maze.dotsLeft > 0 ? this.maze.field(this.dotTilesNow(), false) : null;
    const power = this.maze.powerLeft > 0 ? this.maze.field(this.maze.powerTiles(), false) : null;
    return { threat, dot, power };
  }

  private context(fields: SimFields): SimContext {
    return {
      maze: this.maze,
      nav: this.nav,
      pac: this.pac,
      ghosts: this.ghosts,
      fields,
      stance: this.stance,
      openPellet: this.pickOpenPellet(),
      playerId: this.playerId,
      level: this.level,
    };
  }

  private updateSim(dt: number, ctx: SimContext): void {
    this.nav.clear();
    this.pac.update(dt, ctx);
    for (const g of this.ghosts) {
      if (g.state === 'frightened' || (g.state === 'leaving' && g.frightTimer > 0)) g.frightTimer = this.frightTimer;
      g.update(dt, ctx);
    }
  }

  // -------------------------------------------------------------------------
  // Phase updates
  // -------------------------------------------------------------------------

  update(dt: number, input: Input): void {
    this.elapsed += dt;
    this.lastFps = 1 / Math.max(0.0001, dt);
    this.device = input.lastDevice;

    if (input.pressed('nextSong')) {
      this.music.cycle();
      this.audio.uiSelect();
    }
    if (input.justPressed('KeyC')) this.toggleCRT();
    if (input.justPressed('KeyF')) this.toggleFps();
    if (input.pressed('mute')) {
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
        this.updatePaused(input);
        break;
    }

    this.audio.updateMusic();
    this.music.update(dt);
    if (this.crt) this.crt.update(this.elapsed);

    this.render(dt);
    this.hud.update(this.hudState());
    input.clearPresses();
  }

  private updatePaused(input: Input): void {
    const items = PAUSE_ITEMS;
    let resume = input.pressed('pause') || input.pressed('back');
    if (items.length) {
      const step = (input.pressed('down') ? 1 : 0) - (input.pressed('up') ? 1 : 0);
      if (step) {
        this.pauseSelect = (this.pauseSelect + step + items.length) % items.length;
        this.audio.uiSelect();
      }
      if (!resume && input.pressed('confirm')) {
        if (items[this.pauseSelect] === 'QUIT GAME') {
          desktop?.quit();
          return;
        }
        resume = true;
      }
    } else if (input.pressed('confirm')) {
      resume = true;
    }
    if (resume) {
      this.phase = 'playing';
      this.music.setDucked(false);
    }
  }

  private updateAttract(dt: number, input: Input): void {
    if (input.pressed('up')) {
      this.selectGhost(this.menuSelect - 1);
      this.audio.uiSelect();
    }
    if (input.pressed('down')) {
      this.selectGhost(this.menuSelect + 1);
      this.audio.uiSelect();
    }
    for (let i = 0; i < GHOSTS.length; i++) {
      if (input.justPressed(`Digit${i + 1}`)) {
        this.selectGhost(i);
        this.audio.uiSelect();
      }
    }
    if (input.pressed('confirm')) {
      this.startGame();
      return;
    }

    // Live demo: all four ghosts hunt, stances rotate.
    this.demoStanceTimer -= dt;
    if (this.demoStanceTimer <= 0) {
      this.demoStanceTimer = 5 + Math.random() * 3;
      this.stance = STANCE_ORDER[(Math.random() * STANCE_ORDER.length) | 0];
      if (Math.random() < 0.5) this.stance = 'hunt';
    }

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
      this.device,
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
    // Banished eyes (state 'eaten') find their own way home, and the in-house
    // wait locks input too.
    const pg = this.playerGhost;
    if (pg.state !== 'house' && pg.state !== 'eaten') pg.mover.want = input.wantDir;

    if (input.justPressed('Digit1')) this.setStance('hunt');
    if (input.justPressed('Digit2')) this.setStance('ambush');
    if (input.justPressed('Digit3')) this.setStance('flank');
    if (input.justPressed('Digit4')) this.setStance('guard');
    if (input.pressed('stanceNext')) this.cycleStance(1);
    if (input.pressed('stancePrev')) this.cycleStance(-1);
    if (input.pressed('ability')) this.useAbility();
    if (input.pressed('pause')) {
      this.phase = 'paused';
      this.pauseSelect = 0;
      this.music.setDucked(true);
      return;
    }

    // --- Timers ---
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.message = '';
        this.submessage = '';
      }
    }

    if (this.frightTimer > 0) {
      this.frightTimer = Math.max(0, this.frightTimer - dt);
      if (this.frightTimer === 0) this.pac.powered = false;
    }

    // Hit-stop after a big moment.
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      this.fx.update(dt);
      this.render(dt);
      if (this.freezeTimer <= 0 && this.gameOverPending) this.gameOver();
      return;
    }

    // --- Sim ---
    this.pac.powered = this.frightTimer > 0;
    const ctx = this.context(this.computeFields());
    this.updateSim(dt, ctx);
    if (pg.phaseEjected) {
      pg.phaseEjected = false;
      this.fx.burst(pg.px, pg.py, pg.def.color, 22, { speed: 200, life: 0.5, size: 3 });
      this.fx.ring(pg.px, pg.py, pg.def.color, TILE * 1.8, 0.35, 2.5);
    }
    this.resolveDots();
    if (this.gameOverPending) return;
    this.resolveCollisions(false);

    // The ability just came back (cooldown over, or back from banishment).
    const ready = pg.cooldown <= 0 && pg.state === 'normal';
    if (ready && !this.abilityWasReady) {
      this.audio.abilityReady();
      this.hud.flashAbility();
      this.fx.ring(pg.px, pg.py, pg.def.color, TILE * 1.3, 0.4, 2);
    }
    this.abilityWasReady = ready;

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
      for (const g of this.ghosts) g.frighten();
      this.audio.powerUp();
      this.fx.flash(PALETTE.power, 0.35, 0.3);
      this.fx.shake(5, 0.3);
      this.fx.ring(this.pac.px, this.pac.py, PALETTE.power, TILE * 5, 0.7, 4);
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

  /** Pac-Man cleared the maze: that's the game, however many lives are left. */
  private pacEscaped(): void {
    this.audio.banished();
    this.fx.flash(PALETTE.danger, 0.45, 0.4);
    this.flashMessage('PAC-MAN ESCAPED!', 'GAME OVER', PALETTE.danger, 1.6);
    this.gameOverPending = true;
    this.freezeTimer = 1.6;
  }

  /** Award points; every EXTRA_LIFE_EVERY crossed earns a life, up to MAX_LIVES. */
  private addScore(pts: number): void {
    this.score += pts;
    while (this.score >= this.nextLifeAt) {
      this.nextLifeAt += EXTRA_LIFE_EVERY;
      if (this.lives >= MAX_LIVES) continue;
      this.lives++;
      this.audio.fruit();
      this.fx.pop('1UP', this.playerGhost.px, this.playerGhost.py - 26, PALETTE.gold, 16);
    }
    this.saveHigh();
  }

  private resolveCollisions(demo: boolean): void {
    if (!this.pac.alive) return;
    const reach = TILE * 0.55;

    for (const g of this.ghosts) {
      if (this.gameOverPending) return;
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
    this.fx.ring(this.pac.px, this.pac.py, PALETTE.pac, TILE * 3, 0.5, 3);
    this.spawnRound();
  }

  private onPacCaught(): void {
    const pts = 200 * this.level;
    this.addScore(pts);
    this.audio.catchPac();
    this.fx.flash(PALETTE.gold, 0.55, 0.25);
    this.fx.shake(10, 0.5);
    this.fx.burst(this.pac.px, this.pac.py, PALETTE.pac, 44, { speed: 280, life: 0.8, size: 4 });
    this.fx.ring(this.pac.px, this.pac.py, PALETTE.gold, TILE * 4, 0.6, 4);
    this.fx.ring(this.pac.px, this.pac.py, PALETTE.accent, TILE * 2.4, 0.45, 2);
    this.fx.pop(`+${pts}`, this.pac.px, this.pac.py - 24, PALETTE.gold, 20);

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

    this.audio.eatGhost();
    this.fx.shake(7, 0.4);
    this.fx.flash(PALETTE.power, 0.4, 0.22);
    this.fx.burst(g.px, g.py, g.def.color, 30, { speed: 240, life: 0.7, size: 4 });
    this.fx.ring(g.px, g.py, PALETTE.power, TILE * 2.6, 0.5, 3);
    this.freezeTimer = demo ? 0 : 0.35;

    // The attract-mode demo runs the real simulation but must never touch the
    // player's score, lives or the persisted high score.
    if (g.isPlayer && !demo) {
      this.score = Math.max(0, this.score - 300);
      this.lives--;
      this.fx.pop('-1 LIFE', g.px, g.py - 18, PALETTE.danger, 16);
      if (this.lives <= 0) {
        this.flashMessage('EATEN!', 'NO LIVES LEFT', PALETTE.danger, 1.6);
        this.gameOverPending = true;
        this.freezeTimer = 1.6;
      } else {
        const left = `${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`;
        this.flashMessage("YOU'RE BANISHED!", left, PALETTE.danger, 2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** The title-screen demo's frame: below the header, left of the panel. */
  private layoutDemoMask(): void {
    this.demoMask.clear().rect(0, HEADER_H, VIEW_W, SCREEN_H - HEADER_H).fill(PALETTE.white);
  }

  /** The ghost the title-screen camera follows: a new one every few seconds. */
  private demoTarget(dt: number): { x: number; y: number } {
    const outside = (g: Ghost): boolean => g.state !== 'house';
    this.demoFocusT -= dt;
    if (this.demoFocusT <= 0 || !outside(this.ghosts[this.demoFocus])) {
      this.demoFocusT = DEMO_FOCUS_TIME;
      for (let i = 1; i <= this.ghosts.length; i++) {
        const j = (this.demoFocus + i) % this.ghosts.length;
        if (outside(this.ghosts[j])) {
          this.demoFocus = j;
          break;
        }
      }
    }
    const g = this.ghosts[this.demoFocus];
    return { x: g.px, y: g.py };
  }

  private render(dt: number): void {
    const shake = this.fx.updateShake(dt);
    const demo = this.phase === 'menu' || this.phase === 'gameover';

    if (demo) {
      // Title screen: a close shot that drifts from ghost to ghost, framed in
      // the space below the header and left of the panel.
      const viewH = SCREEN_H - HEADER_H;
      const scale = viewH / (DEMO_TILES_TALL * TILE);
      const focus = this.demoTarget(dt);
      const clampAxis = (v: number, half: number, size: number): number =>
        half * 2 >= size ? size / 2 : Math.max(half, Math.min(size - half, v));
      const tx = clampAxis(focus.x, VIEW_W / 2 / scale, WORLD_W);
      const ty = clampAxis(focus.y, viewH / 2 / scale, WORLD_H);
      // Snap on the first frame and across the tunnel wrap; glide otherwise.
      if (!this.demoCam || Math.abs(tx - this.demoCam.x) > WORLD_W / 2) this.demoCam = { x: tx, y: ty };
      const k = Math.min(1, dt * 3);
      this.demoCam.x += (tx - this.demoCam.x) * k;
      this.demoCam.y += (ty - this.demoCam.y) * k;
      this.world.alpha = 0.8;
      this.world.scale.set(scale);
      this.world.position.set(
        VIEW_W / 2 - this.demoCam.x * scale + shake.x,
        HEADER_H + viewH / 2 - this.demoCam.y * scale + shake.y,
      );
      this.demoMask.visible = true;
      this.world.mask = this.demoMask;
    } else {
      // Out of use as a mask it would draw as a plain white rectangle.
      this.world.mask = null;
      this.demoMask.visible = false;
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
    this.drawFloorGrid();
    this.drawSparkles();
    this.drawPortals();
    this.drawPower();
    this.drawDoorGfx();
    this.drawTrails(dt);
    this.drawPac();
    this.drawAlert();
    for (const g of this.ghosts) this.drawGhostView(g);
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
    const g = this.powerGfx;
    const a = 0.85 + 0.15 * Math.sin(this.elapsed * 6);
    const r = TILE * 0.2 * a;
    let n = 0;
    for (let i = 0; i < this.maze.dots.length; i++) {
      if (this.maze.dots[i] !== 2) continue;
      const x = centerOf(i % COLS);
      const y = centerOf((i / COLS) | 0);
      n++;
      // Sonar ripple, halo, core and a slowly turning glint.
      const k = (this.elapsed * 0.7 + n * 0.23) % 1;
      g.circle(x, y, r * (1.1 + 2.4 * k)).stroke({ width: 1.5, color: PALETTE.power, alpha: 0.55 * (1 - k) });
      g.circle(x, y, r * 2).fill({ color: PALETTE.power, alpha: 0.12 });
      g.circle(x, y, r).fill(PALETTE.power);
      g.circle(x - r * 0.25, y - r * 0.25, r * 0.45).fill({ color: PALETTE.white, alpha: 0.8 });
      drawSparkle(g, x, y, r * 2.3, PALETTE.white, 0.35 + 0.2 * a, this.elapsed * 0.8);
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
      if (r > 0.6) drawPacman(g, r, 0.05 + t * 2.6, PALETTE.pac, this.pacAngle);
      g.position.set(this.pac.px, this.pac.py);
      g.rotation = this.pacAngle;
      return;
    }
    const target = dirAngle(this.pac.mover.dir, this.pacAngle);
    this.pacAngle = angleLerp(this.pacAngle, target, 0.25);
    drawPacman(g, TILE * 0.46, this.pac.mouth, PALETTE.pac, this.pacAngle);
    // Powered up: a visible "hunter" aura so the reversal reads instantly. On a
    // close chase it runs hot: red, faster, and wider.
    if (this.pac.powered) {
      const fury = this.pac.furious;
      const color = fury ? PALETTE.danger : PALETTE.power;
      const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * (fury ? 26 : 12));
      const grow = fury ? 1.12 : 1;
      g.circle(0, 0, TILE * 0.62 * grow).stroke({
        width: fury ? 3.5 : 2.5,
        color,
        alpha: 0.35 + 0.4 * pulse,
      });
      g.circle(0, 0, TILE * 0.78 * grow).stroke({
        width: fury ? 2.5 : 1.5,
        color,
        alpha: 0.15 + 0.25 * pulse,
      });
    }
    g.position.set(this.pac.px, this.pac.py);
    g.rotation = this.pacAngle;
  }

  /**
   * Clyde's BLINDSIDE: a Metal Gear-style "!" over Pac-Man. It pops in with an
   * overshoot, holds with a slight bob, and flickers out in the last moments.
   */
  private drawAlert(): void {
    const g = this.alertView;
    g.clear();
    const left = this.pac.blind;
    if (left <= 0 || !this.pac.alive) return;
    const age = BLIND_TIME - left;
    if (left < 0.4 && Math.floor(left * 16) % 2 === 0) return;

    // Pop: 0 → 1.35 → 1 over the first 0.18s.
    const k = Math.min(1, age / 0.18);
    const scale = k < 0.6 ? (k / 0.6) * 1.35 : 1.35 - ((k - 0.6) / 0.4) * 0.35;
    const s = TILE * 1.05 * scale;
    const bob = Math.sin(age * 9) * 1.5;
    g.position.set(this.pac.px, this.pac.py - TILE * 1.25 + bob);

    // A tapered bar and a dot, leaning slightly like the comic-book original.
    const bar = [-0.18, -0.6, 0.24, -0.6, 0.07, 0.12, -0.09, 0.12].map((v) => v * s);
    for (const [w, color] of [
      [7, PALETTE.bgDeep],
      [3.5, PALETTE.white],
    ] as const) {
      g.poly(bar).stroke({ width: w, color, join: 'round' });
      g.circle(-0.03 * s, 0.34 * s, 0.13 * s).stroke({ width: w, color });
    }
    g.poly(bar).fill(PALETTE.danger);
    g.circle(-0.03 * s, 0.34 * s, 0.13 * s).fill(PALETTE.danger);
  }

  private drawGhostView(g: Ghost): void {
    const view = this.ghostViews.get(g.id);
    if (!view) return;
    view.clear();
    const frightened = g.state === 'frightened';
    const eaten = g.state === 'eaten';
    const r = TILE * 0.45;
    const body = frightened ? PALETTE.frightBody : g.def.color;
    const wave = this.elapsed * SKIRT_RATE + GHOSTS.indexOf(g.def) * 0.37;
    if (!eaten) {
      // Neon light pooling on the floor beneath the skirt.
      view.ellipse(0, r * 1.02, r * 0.85, r * 0.2).fill({ color: body, alpha: 0.22 });
    }
    if (g.mover.phase && !eaten) {
      // PHASE: the ghost de-syncs into chromatic ghost images while in the wall.
      const j = Math.sin(this.elapsed * 40) * 1.5;
      drawGhostSilhouette(view, -3 + j, 0, r, wave, PALETTE.accent, 0.45);
      drawGhostSilhouette(view, 3 - j, 0, r, wave, PALETTE.accent2, 0.45);
    }
    drawGhost(view, r, {
      color: g.def.color,
      dir: g.mover.dir,
      frightened,
      flash: g.flash,
      eaten: g.state === 'eaten',
      wave,
    });
    view.position.set(g.px, g.py);
    view.alpha = eaten ? 0.75 : g.mover.phase ? (g.phaseBlink ? 0.15 : 0.7) : 1;
  }

  /**
   * Motion trails. Every actor leaves a faint long-exposure smear; SHADOW DASH
   * and a powered Pac-Man leave a bright one (red when he's furious). Samples that jump (tunnel wrap,
   * blink, respawn) break the trail instead of streaking across the board.
   */
  private drawTrails(dt: number): void {
    const g = this.trailGfx;
    g.clear();
    const LEN = 10;
    // Sampled at 60 Hz on average whatever the refresh rate, so a trail spans
    // the same time (and length) on a 120 Hz screen as on a 60 Hz one. The 10%
    // slack keeps frame-time jitter at 60 Hz from skipping samples.
    this.trailClock += dt;
    const due = this.trailClock >= TRAIL_STEP * 0.9;
    if (due) this.trailClock = Math.max(0, this.trailClock - TRAIL_STEP);
    const sample = (key: string, x: number, y: number): Array<{ x: number; y: number }> => {
      let pts = this.trails.get(key);
      if (!pts) {
        pts = [];
        this.trails.set(key, pts);
      }
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - x, last.y - y) > TILE * 1.5) pts.length = 0;
      if (due || !pts.length) {
        pts.push({ x, y });
        if (pts.length > LEN) pts.shift();
      }
      return pts;
    };

    const r = TILE * 0.45;
    for (const gh of this.ghosts) {
      const pts = sample(gh.id, gh.px, gh.py);
      if (gh.state === 'house') continue;
      const dashing = gh.dashTimer > 0;
      const eaten = gh.state === 'eaten';
      const color = gh.state === 'frightened' ? PALETTE.frightBody : gh.def.color;
      for (let i = 0; i < pts.length - 1; i += 2) {
        const k = (i + 1) / pts.length;
        const p = pts[i];
        if (eaten) {
          g.circle(p.x, p.y, 2 + k * 2).fill({ color: PALETTE.eyeWhite, alpha: 0.12 * k });
        } else {
          const tint = dashing ? lerpColor(color, PALETTE.white, 0.35) : color;
          drawGhostSilhouette(g, p.x, p.y, r * (0.8 + 0.2 * k), 3, tint, (dashing ? 0.34 : 0.07) * k);
        }
      }
    }

    const pts = sample('pac', this.pac.px, this.pac.py);
    if (!this.pac.alive) return;
    const powered = this.pac.powered;
    const color = this.pac.furious ? PALETTE.danger : powered ? PALETTE.power : PALETTE.pac;
    for (let i = 0; i < pts.length - 1; i++) {
      const k = (i + 1) / pts.length;
      const p = pts[i];
      g.circle(p.x, p.y, TILE * 0.4 * (0.55 + 0.45 * k)).fill({
        color,
        alpha: (powered ? 0.16 : 0.05) * k,
      });
    }
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

    // Banished? Mark the house the eyes are heading back to.
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
    // A timed announcement (lives left, game over) outranks the banished banner.
    const banner = banished && this.msgTimer <= 0 && !this.gameOverPending;

    return {
      score: this.score,
      high: this.high,
      level: this.level,
      lives: this.lives,
      pacLives: this.pacLives,
      stance: this.stance,
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
          : banner
            ? 'BANISHED!'
            : this.message,
      submessage:
        this.phase === 'paused'
          ? PAUSE_ITEMS.length
            ? ''
            : `PRESS ${this.device === 'gamepad' ? 'MENU' : 'P'} TO RESUME`
          : banner
            ? pg && pg.state === 'eaten'
              ? 'RETURNING TO THE HOUSE'
              : 'RESPAWNING…'
            : this.submessage,
      messageColor:
        this.phase === 'paused'
          ? PALETTE.text
          : banner
            ? PALETTE.danger
            : this.messageColor,
      pauseItems: this.phase === 'paused' ? PAUSE_ITEMS : [],
      pauseSelect: this.pauseSelect,
      device: this.device,
      muted: this.muted,
      trackName: this.audioHintText(),
      showFps: this.showFps,
      fps: this.lastFps,
    };
  }

  /** Menu/HUD line describing the audio state, so silence is never a mystery. */
  private audioHintText(): string {
    if (!this.music.available) return '';
    if (this.muted) return `SOUND MUTED  ·  ${this.device === 'gamepad' ? 'VIEW' : 'N'} TO UNMUTE`;
    if (!this.music.unlockedFlag) {
      return this.music.buffered ? 'PRESS ANY KEY FOR SOUND' : 'LOADING AUDIO…';
    }
    return this.music.trackName ? `♪ ${this.music.trackName}` : '';
  }

  /** Re-run every width-dependent layout after a viewport change. */
  layout(): void {
    this.buildBackdrop();
    this.layoutDemoMask();
    this.hud.layout();
    this.menu.layout();
    this.fx.resize(SCREEN_W, SCREEN_H);
    this.crt?.resize(this.app.renderer.width, this.app.renderer.height);
    this.clearStaleFilterTextures();
  }

  /**
   * Workaround for a Pixi 8.21 bug. FilterSystem.push() picks a nested
   * filter's resolution from its stack slot's input texture *from the previous
   * frame*. A resize prunes idle screen-sized textures from the pool, leaving
   * that slot pointing at a destroyed texture; the null source then throws
   * inside the ticker, and Pixi's ticker stops scheduling frames for good (the
   * game freezes). Clearing the slots makes it fall back to the root
   * resolution for the one frame before they are refilled.
   */
  private clearStaleFilterTextures(): void {
    const fs = this.app.renderer.filter as unknown as { _filterStack?: Array<{ inputTexture: unknown }> };
    for (const slot of fs._filterStack ?? []) slot.inputTexture = null;
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
