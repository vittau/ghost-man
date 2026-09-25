import {
  FRIGHT_TIME,
  GHOSTS,
  HOUSE_CENTER,
  HOUSE_DOOR,
  HOUSE_SLOTS,
  PAC_START,
  PALETTE,
  RESPAWN_BANISH,
  SCATTER,
  SPEED,
  STANCE_INFO,
  TILE,
  TUNNEL_ROW,
} from './config';
import { Maze, NavCache } from './maze';
import { Mover } from './mover';
import { DIRS, DIR_ORDER, OPPOSITE, addTile } from './types';
import type { Dir, GhostState, GhostId, Stance, TilePos, UnitDir } from './types';
import type { GhostDef } from './config';

export const neighborOf = (tx: number, ty: number, d: UnitDir): TilePos => ({
  x: tx + DIRS[d].x,
  y: ty + DIRS[d].y,
});

export const fieldAt = (maze: Maze, field: Int32Array, x: number, y: number): number =>
  field[maze.index(x, y)];

/** Danger/proximity fields recomputed once per frame and shared by the AI. */
export interface SimFields {
  /** Distance to the nearest remaining pellet (null when the maze is cleared). */
  dot: Int32Array | null;
  /** Distance to the nearest dangerous ghost. */
  avoid: Int32Array;
  /** Distance to the nearest edible (frightened) ghost. */
  hunt: Int32Array | null;
  /** Distance to Clyde's decoy — Pac-Man prioritises this above real ghosts. */
  decoy: Int32Array | null;
}

export interface SimContext {
  maze: Maze;
  nav: NavCache;
  pac: Pacman;
  ghosts: Ghost[];
  fields: SimFields;
  decoy: { x: number; y: number } | null;
  stance: Stance;
  pincer: boolean;
  playerId: GhostId;
  level: number;
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

// ---------------------------------------------------------------------------
// Pac-Man — the AI hero. Clears pellets, flees ghosts, and hunts when powered.
// ---------------------------------------------------------------------------
export class Pacman {
  readonly mover: Mover;
  mouth = 0.2;
  private mouthPhase = 0;
  powered = false;
  alive = true;
  deathT = 0;
  dir: Dir = 'left';

  constructor(maze: Maze) {
    this.mover = new Mover(maze);
  }

  spawn(): void {
    this.mover.place(PAC_START.x, PAC_START.y, PAC_START.dir);
    this.mover.speed = SPEED.pac;
    this.powered = false;
    this.alive = true;
    this.deathT = 0;
    this.dir = PAC_START.dir;
  }

  get px(): number {
    return this.mover.px;
  }

  get py(): number {
    return this.mover.py;
  }

  get tile(): TilePos {
    return this.mover.tile;
  }

  private options(): UnitDir[] {
    const m = this.mover;
    const back = OPPOSITE[m.dir];
    const out: UnitDir[] = [];
    for (const d of DIR_ORDER) {
      if (d === back) continue;
      if (m.canEnter(d)) out.push(d);
    }
    if (out.length === 0 && back !== 'none' && m.canEnter(back as UnitDir)) {
      out.push(back as UnitDir);
    }
    return out;
  }

  decide(ctx: SimContext): void {
    const m = this.mover;
    const opts = this.options();
    if (opts.length === 0) return;

    const { fields, maze } = ctx;
    const edible = ctx.ghosts.some((g) => g.state === 'frightened');

    // --- Hunt mode ---------------------------------------------------------
    // Powered up: chase the nearest frightened ghost and nothing else. This is
    // the whole payoff of a power pellet, so it takes priority over pellets.
    if (this.powered && edible && fields.hunt) {
      let huntDir: UnitDir | null = null;
      let huntDist = Infinity;
      for (const d of opts) {
        const n = neighborOf(m.tx, m.ty, d);
        const hv = fieldAt(maze, fields.hunt, n.x, n.y);
        if (hv >= 0 && hv < huntDist) {
          huntDist = hv;
          huntDir = d;
        }
      }
      if (huntDir) {
        m.want = huntDir;
        return;
      }
    }

    // --- Normal: clear pellets while staying out of reach ------------------
    const nearest = fields.avoid[maze.index(m.tx, m.ty)];
    const threat = nearest >= 0 && nearest < 6;

    let best = opts[0];
    let bestScore = -Infinity;

    for (const d of opts) {
      const n = neighborOf(m.tx, m.ty, d);
      const avoid = fields.avoid[maze.index(n.x, n.y)];
      const avoidV = avoid < 0 ? 0 : Math.min(avoid, 14);
      const dotRaw = fields.dot ? fieldAt(maze, fields.dot, n.x, n.y) : 0;
      const dotV = dotRaw < 0 ? 60 : dotRaw;

      let score = -dotV + avoidV * (threat ? 2.4 : 0.85);
      // Grab a power pellet when boxed in — it's his escape hatch.
      if (threat && maze.dots[maze.index(n.x, n.y)] === 2) score += 9;

      // Clyde's decoy outranks every real ghost: Pac-Man reacts to it harder
      // than anything else, so it can herd him wherever Clyde wants.
      if (fields.decoy) {
        const dv = fieldAt(maze, fields.decoy, n.x, n.y);
        if (dv >= 0) score += Math.min(dv, 14) * 3.2;
      }

      score += Math.random() * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    m.want = best;
  }

  update(dt: number, ctx: SimContext): void {
    if (!this.alive) {
      this.deathT += dt;
      return;
    }
    this.decide(ctx);
    this.mover.speed = this.powered ? SPEED.pacPowered : SPEED.pac;
    this.mover.update(dt);
    this.dir = this.mover.dir;

    const moving = this.mover.dir !== 'none';
    this.mouthPhase += dt * (moving ? 14 : 4);
    const open = 0.5 - 0.5 * Math.cos(this.mouthPhase);
    this.mouth = 0.06 + open * 0.95;
  }
}

// ---------------------------------------------------------------------------
// Ghosts — the squad. One is driven by the player, the rest by AI.
// ---------------------------------------------------------------------------
export class Ghost {
  readonly mover: Mover;
  readonly def: GhostDef;
  readonly slot: { x: number; y: number; release: number };
  state: GhostState = 'house';
  isPlayer = false;
  /** Last tile this ghost chose to path toward (used for intent lines). */
  lastTarget: TilePos = { x: 0, y: 0 };

  wave = 0;
  bob = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private releaseTimer = 0;
  frightTimer = 0;
  flash = false;

  // Ability / status.
  dashTimer = 0;
  cooldown = 0;
  decoyTimer = 0;
  /** PHASE: true while the ghost may pass through walls. */
  phaseActive = false;
  private phaseInsideWall = false;
  private phaseTimeout = 0;

  constructor(maze: Maze, def: GhostDef) {
    this.def = def;
    this.mover = new Mover(maze);
    this.slot = HOUSE_SLOTS[def.id];
  }

  get id(): GhostId {
    return this.def.id;
  }

  get px(): number {
    return this.mover.px;
  }

  get py(): number {
    return this.mover.py + this.bob;
  }

  get tile(): TilePos {
    return this.mover.tile;
  }

  isDangerous(): boolean {
    return this.state === 'normal' || this.state === 'leaving';
  }

  isEdible(): boolean {
    return this.state === 'frightened';
  }

  spawn(level: number): void {
    const speedUp = Math.min(1.35, 1 + (level - 1) * 0.045);
    if (this.isPlayer) {
      this.mover.place(HOUSE_DOOR.x + 0, HOUSE_DOOR.y, 'left');
      this.state = 'normal';
    } else {
      this.mover.place(this.slot.x, this.slot.y, 'up');
      this.state = 'house';
      this.releaseTimer = 0;
    }
    this.mover.speed = SPEED.ghost * speedUp;
    this.mover.ghostPass = false;
    this.mover.phase = false;
    this.mover.want = 'none';
    this.frightTimer = 0;
    this.flash = false;
    this.dashTimer = 0;
    this.cooldown = 0;
    this.phaseActive = false;
    this.phaseInsideWall = false;
    this.phaseTimeout = 0;
    this.bob = 0;
    this.decoyTimer = 0;
  }

  frighten(): void {
    if (this.state === 'normal' || this.state === 'leaving') {
      this.state = 'frightened';
      this.frightTimer = FRIGHT_TIME;
      this.flash = false;
      if (this.mover.dir !== 'none') this.mover.reverse();
    } else if (this.state === 'frightened') {
      this.frightTimer = FRIGHT_TIME;
    }
  }

  get isBanished(): boolean {
    return this.state === 'eaten';
  }

  /**
   * PHASE: one traversal through a wall. It switches off the moment the ghost
   * is back on a walkable tile, so it can never strand anyone inside geometry,
   * and expires if it isn't used promptly.
   */
  beginPhase(): void {
    this.phaseActive = true;
    this.phaseInsideWall = false;
    this.phaseTimeout = 1.6;
    this.mover.phase = true;
    // Travel straight through rather than turning inside the wall.
    if (this.mover.dir !== 'none') this.mover.want = this.mover.dir;
  }

  private updateTimers(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.decoyTimer > 0) this.decoyTimer = Math.max(0, this.decoyTimer - dt);

    if (this.phaseActive) {
      const inWall = this.mover.maze.isWall(this.mover.tx, this.mover.ty);
      if (inWall) {
        this.phaseInsideWall = true;
      } else if (this.phaseInsideWall) {
        this.phaseActive = false; // back on the track
      } else {
        this.phaseTimeout -= dt;
        if (this.phaseTimeout <= 0) this.phaseActive = false;
      }
      this.mover.phase = this.phaseActive;
    } else if (this.mover.phase) {
      this.mover.phase = false;
    }
  }

  private speedFor(): number {
    const m = this.mover;
    const inTunnel = m.ty === TUNNEL_ROW && (m.tx < 6 || m.tx > 21);
    const tunnel = inTunnel ? 0.55 : 1;
    switch (this.state) {
      case 'house':
        return 0;
      case 'leaving':
        return SPEED.ghost * 0.8;
      case 'eaten':
        return SPEED.ghostEaten;
      case 'frightened':
        return SPEED.ghostFright * tunnel;
      default:
        return (this.isPlayer ? SPEED.playerGhost : m.speed) * tunnel * (this.dashTimer > 0 ? 1.75 : 1);
    }
  }

  private targetFor(ctx: SimContext): TilePos {
    if (this.state === 'leaving') return HOUSE_DOOR;
    if (this.state === 'eaten') return HOUSE_CENTER;

    const pacTile = { x: ctx.pac.mover.tx, y: ctx.pac.mover.ty };
    const pacDir: UnitDir = ctx.pac.mover.dir === 'none' ? 'left' : (ctx.pac.mover.dir as UnitDir);

    if (ctx.pincer) {
      const f = DIRS[pacDir];
      const perp = { x: f.y, y: f.x };
      const friends = ctx.ghosts.filter((g) => !g.isPlayer);
      const i = friends.indexOf(this);
      const points: TilePos[] = [
        addTile(pacTile, f, 2),
        { x: pacTile.x + perp.x * 2, y: pacTile.y + perp.y * 2 },
        { x: pacTile.x - perp.x * 2, y: pacTile.y - perp.y * 2 },
        { x: pacTile.x - f.x * 2, y: pacTile.y - f.y * 2 },
      ];
      return points[(i < 0 ? 0 : i) % points.length];
    }

    switch (ctx.stance) {
      case 'ambush':
        return addTile(pacTile, DIRS[pacDir], 4);
      case 'flank':
        return addTile(pacTile, DIRS[pacDir], -4);
      case 'guard': {
        const power = ctx.maze.powerTiles();
        if (power.length) {
          let best = power[0];
          let bd = Infinity;
          for (const p of power) {
            const d = dist(p.x, p.y, this.mover.tx, this.mover.ty);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
          return best;
        }
        return addTile(pacTile, DIRS[pacDir], 4);
      }
      default:
        return this.personalityTarget(ctx, pacTile, pacDir);
    }
  }

  private personalityTarget(ctx: SimContext, pacTile: TilePos, pacDir: UnitDir): TilePos {
    switch (this.id) {
      case 'pinky':
        return addTile(pacTile, DIRS[pacDir], 4);
      case 'inky': {
        const blinky = ctx.ghosts.find((g) => g.id === 'blinky');
        const pivot = addTile(pacTile, DIRS[pacDir], 2);
        if (!blinky) return pivot;
        return { x: pivot.x * 2 - blinky.mover.tx, y: pivot.y * 2 - blinky.mover.ty };
      }
      case 'clyde': {
        const d = dist(this.mover.tx, this.mover.ty, pacTile.x, pacTile.y);
        return d > 8 ? pacTile : SCATTER.clyde;
      }
      default:
        return pacTile;
    }
  }

  /** Choose a direction: BFS toward the target, random when frightened. */
  private chooseDir(ctx: SimContext, target: TilePos): void {
    const m = this.mover;
    const back = OPPOSITE[m.dir];
    const opts: UnitDir[] = [];
    for (const d of DIR_ORDER) {
      if (d === back) continue;
      if (m.canEnter(d)) opts.push(d);
    }
    if (opts.length === 0) {
      if (back !== 'none' && m.canEnter(back as UnitDir)) m.want = back;
      return;
    }
    if (opts.length === 1) {
      m.want = opts[0];
      return;
    }
    if (this.state === 'frightened') {
      m.want = opts[(Math.random() * opts.length) | 0];
      return;
    }

    const field = ctx.nav.to(target, m.ghostPass);
    let best = opts[0];
    let bestD = Infinity;
    for (const d of opts) {
      const n = neighborOf(m.tx, m.ty, d);
      const dd = fieldAt(m.maze, field, n.x, n.y);
      if (dd >= 0 && dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    m.want = best;
  }

  update(dt: number, ctx: SimContext): void {
    this.updateTimers(dt);
    this.wave = 0.16 * TILE + 0.09 * TILE * Math.sin(performance.now() / 90 + this.bobPhase);

    if (this.state === 'house') {
      this.bobPhase += dt * 3.2;
      this.bob = Math.sin(this.bobPhase) * 2.5;
      this.releaseTimer += dt;
      if (this.releaseTimer >= this.slot.release) {
        this.state = 'leaving';
        this.mover.ghostPass = true;
      }
      return;
    }

    this.bob = 0;
    this.mover.ghostPass = this.state === 'leaving' || this.state === 'eaten';

    if (this.state === 'frightened') {
      this.flash = this.frightTimer < FRIGHT_TIME * 0.32;
      if (this.frightTimer <= 0) {
        this.state = 'normal';
        this.flash = false;
      }
    }

    if (this.state === 'eaten') {
      const d = dist(this.mover.tx, this.mover.ty, HOUSE_CENTER.x, HOUSE_CENTER.y);
      if (d < 1.2) {
        this.state = 'house';
        this.releaseTimer = -RESPAWN_BANISH;
        this.bobPhase = 0;
        this.mover.speed = SPEED.ghost;
        this.mover.ghostPass = false;
        return;
      }
    }

    if (this.state === 'leaving' && this.mover.ty <= HOUSE_DOOR.y) {
      this.state = 'normal';
      this.mover.ghostPass = false;
    }

    if (!this.isPlayer && !this.phaseActive) {
      this.lastTarget = this.targetFor(ctx);
      this.chooseDir(ctx, this.lastTarget);
    }

    this.mover.speed = this.speedFor();
    this.mover.update(dt);

    // Level-appropriate speed for AI ghosts.
    if (!this.isPlayer && this.state === 'normal') {
      const speedUp = Math.min(1.35, 1 + (ctx.level - 1) * 0.045);
      this.mover.speed = SPEED.ghost * speedUp;
      if (this.dashTimer > 0) this.mover.speed *= 1.75;
    }
  }
}

export const ghostStatusLine = (g: Ghost, ctx: SimContext): string => {
  if (g.state === 'eaten') return 'BANISHED';
  if (g.state === 'frightened') return 'FRIGHTENED';
  if (g.state === 'house') return 'HOUSE';
  if (ctx.pincer) return 'PINCER';
  return STANCE_INFO[ctx.stance].name;
};

export const ghostColors = (): Record<GhostId, number> => {
  const out = {} as Record<GhostId, number>;
  for (const g of GHOSTS) out[g.id] = g.color;
  return out;
};

export const ghostById = (id: GhostId): GhostDef =>
  GHOSTS.find((g) => g.id === id) ?? GHOSTS[0];

export { PALETTE };
