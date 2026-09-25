import {
  COLS,
  FRIGHT_TIME,
  GHOSTS,
  HOUSE_CENTER,
  HOUSE_DOOR,
  HOUSE_SLOTS,
  PAC_START,
  PALETTE,
  RESPAWN_BANISH,
  ROWS,
  SCATTER,
  SPEED,
  STANCE_INFO,
  TILE,
  TUNNEL_SLOW,
} from './config';
import { Maze, NavCache, isTunnel } from './maze';
import { Mover } from './mover';
import { DIRS, DIR_ORDER, OPPOSITE, addTile } from './types';
import type { Dir, GhostState, GhostId, Stance, TilePos, UnitDir } from './types';
import type { GhostDef } from './config';

export const neighborOf = (tx: number, ty: number, d: UnitDir): TilePos => ({
  x: (tx + DIRS[d].x + COLS) % COLS,
  y: ty + DIRS[d].y,
});

export const fieldAt = (maze: Maze, field: Int32Array, x: number, y: number): number =>
  field[maze.index(x, y)];

/** Danger/proximity fields recomputed once per frame and shared by the AI. */
export interface SimFields {
  /** Distance to the nearest remaining pellet (null when the maze is cleared). */
  dot: Int32Array | null;
  /** Seconds until the quickest dangerous ghost could reach each tile (-1: never). */
  threat: Float32Array;
  /** Distance to the nearest remaining power pellet (null when none are left). */
  power: Int32Array | null;
}

export interface SimContext {
  maze: Maze;
  nav: NavCache;
  pac: Pacman;
  ghosts: Ghost[];
  fields: SimFields;
  stance: Stance;
  playerId: GhostId;
  level: number;
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

const DASH_BOOST = 1.75;

/** AI ghosts speed up a little each level. */
const levelSpeedUp = (level: number): number => Math.min(1.35, 1 + (level - 1) * 0.045);

/**
 * Seconds until any dangerous ghost could reach each tile. Each ghost gets its
 * own travel-time field at its current top speed (dash included), so Pac-Man
 * reads a dashing Blinky as the threat it is; the tunnel slowdown is priced in,
 * which is what makes the side portals a real escape route.
 */
export function threatField(maze: Maze, ghosts: Ghost[], level: number): Float32Array {
  const out = new Float32Array(COLS * ROWS).fill(-1);
  for (const g of ghosts) {
    // A frightened ghost about to recover is already a threat, just a later one.
    const recovering = g.state === 'frightened' && g.frightTimer < 1.2;
    if (!g.isDangerous() && !recovering) continue;
    const delay = recovering ? g.frightTimer : 0;
    const speed = g.cruiseSpeed(level);
    const m = g.mover;
    // Mid-tile, the ghost could end up on either end of its step (the player
    // can reverse at will), so seed both.
    const seeds = [{ x: m.tx, y: m.ty, t: delay + m.t / speed }];
    if (m.t > 0 && m.dir !== 'none') {
      const n = m.nextTile;
      seeds.push({ x: n.x, y: n.y, t: delay + (1 - m.t) / speed });
    }
    const f = maze.travelTime(seeds, speed, TUNNEL_SLOW, g.state === 'leaving');
    for (let i = 0; i < out.length; i++) {
      if (f[i] >= 0 && (out[i] < 0 || f[i] < out[i])) out[i] = f[i];
    }
  }
  return out;
}

// Pac-Man AI tuning.
/** A ghost this many seconds from Pac-Man's next tile puts him in escape mode. */
const THREAT_HORIZON = 1.1;
/** Pac-Man must beat a ghost to a tile by this much for it to count as safe. */
const SAFE_MARGIN = 0.12;
/** Escape-room tiles worth counting; beyond this a route is simply "open". */
const ROOM_CAP = 40;
/** Prey this close (in tiles) gets his full, locked-on attention. */
const FURY_RANGE = 5;
/** Minimum time between two reversals, so he commits instead of dithering. */
const REVERSE_COOLDOWN = 0.45;

/** One way Pac-Man could go from where he is now. */
interface Route {
  dir: UnitDir;
  /** First tile on the route. */
  tile: TilePos;
  /** Tiles Pac-Man covers to reach it. */
  lead: number;
  /** The tile he'd be putting behind him (the escape search can't re-enter it). */
  behind: TilePos;
  reverse: boolean;
}

/** What lies down a route: how much of the maze he can still reach first. */
interface Room {
  tiles: number;
  power: boolean;
  tunnel: boolean;
}

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
  /** Clyde's BLINDSIDE: seconds left disoriented, picking turns at random. */
  blind = 0;
  /** While blind: the tile he last picked a turn for, and the turn. */
  private blindAt = -1;
  private blindDir: UnitDir = 'left';
  /** The frightened ghost he has locked onto at close range, if any. */
  private prey: Ghost | null = null;
  private reverseCd = 0;

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
    this.blind = 0;
    this.prey = null;
    this.reverseCd = 0;
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

  /** Closing in on a locked-on prey: faster, and it shows. */
  get furious(): boolean {
    return this.powered && this.prey !== null && this.blind <= 0;
  }

  private get speed(): number {
    if (this.furious) return SPEED.pacFury;
    return this.powered ? SPEED.pacPowered : SPEED.pac;
  }

  /**
   * Every way he can go. Turns are judged at the tile where they can actually
   * happen (the one he's heading into), and reversing is its own route — it's
   * the only way out when a ghost appears ahead.
   */
  private routes(): Route[] {
    const m = this.mover;
    const at = m.nextTile;
    const moving = m.dir !== 'none';
    const midTile = moving && m.t > 0;
    const lead = midTile ? 1 - m.t : 0;
    const back = OPPOSITE[m.dir];
    const out: Route[] = [];

    for (const d of DIR_ORDER) {
      if (d === back || !m.canEnterFrom(at.x, at.y, d)) continue;
      out.push({ dir: d, tile: neighborOf(at.x, at.y, d), lead: lead + 1, behind: at, reverse: false });
    }
    if (back !== 'none') {
      const b = back as UnitDir;
      if (midTile) {
        out.push({ dir: b, tile: m.tile, lead: m.t, behind: at, reverse: true });
      } else if (m.canEnterFrom(at.x, at.y, b)) {
        out.push({ dir: b, tile: neighborOf(at.x, at.y, b), lead: 1, behind: at, reverse: true });
      }
    }
    return out;
  }

  /** Can he reach tile index `i` (after `tiles` steps) before any ghost? */
  private safeAt(threat: Float32Array, i: number, tiles: number): boolean {
    const t = threat[i];
    return t < 0 || tiles / this.speed + SAFE_MARGIN < t;
  }

  /**
   * Flood outward from a route's first tile through every tile Pac-Man reaches
   * before any ghost can. A big room means a real escape; a small one is a
   * trap closing. Power pellets and the tunnel in the room are noted.
   */
  private room(ctx: SimContext, r: Route): Room {
    const { maze } = ctx;
    const threat = ctx.fields.threat;
    const out: Room = { tiles: 0, power: false, tunnel: false };
    const start = maze.index(r.tile.x, r.tile.y);
    if (!this.safeAt(threat, start, r.lead)) return out;

    const seen = new Set<number>([maze.index(r.behind.x, r.behind.y), start]);
    const queue: Array<[number, number]> = [[start, r.lead]];
    for (let head = 0; head < queue.length && out.tiles < ROOM_CAP; head++) {
      const [i, d] = queue[head];
      out.tiles++;
      const c = i % COLS;
      const row = (i / COLS) | 0;
      if (maze.dots[i] === 2) out.power = true;
      if (isTunnel(c, row)) out.tunnel = true;
      for (const dir of DIR_ORDER) {
        const n = neighborOf(c, row, dir);
        if (!maze.walkable(n.x, n.y)) continue;
        const ni = maze.index(n.x, n.y);
        if (seen.has(ni)) continue;
        seen.add(ni);
        if (this.safeAt(threat, ni, d + 1)) queue.push([ni, d + 1]);
      }
    }
    return out;
  }

  /**
   * Powered up: the tiles of the frightened ghosts worth chasing. Once one is
   * within FURY_RANGE he locks onto it and won't be distracted until it's
   * eaten or recovers. Otherwise, the ones he can catch before the power runs
   * out, and your ghost when it's anywhere near as close as the rest — eating
   * the player is what hurts.
   */
  private huntGoals(ctx: SimContext): Set<number> | null {
    const { maze } = ctx;
    const from = maze.field([this.mover.nextTile], false);
    const distTo = (g: Ghost): number => fieldAt(maze, from, g.mover.tx, g.mover.ty);
    // The tile nearest to where the ghost actually is. Aiming at where it's
    // heading breaks head-on (that's the tile Pac-Man is leaving, so he'd turn
    // away); aiming at where it came from lags a fleeing ghost.
    const goal = (g: Ghost): Set<number> => {
      const t = g.mover.t >= 0.5 ? g.mover.nextTile : g.mover.tile;
      return new Set([maze.index(t.x, t.y)]);
    };

    const prey = this.prey;
    if (prey && prey.state === 'frightened') {
      const d = distTo(prey);
      if (d >= 0 && d <= FURY_RANGE + 3) return goal(prey);
    }
    this.prey = null;

    const catchable: Array<{ g: Ghost; d: number }> = [];
    for (const g of ctx.ghosts) {
      if (g.state !== 'frightened') continue;
      const d = distTo(g);
      // Frightened ghosts wander, so he closes at most of his speed.
      if (d >= 0 && d / (SPEED.pacPowered * 0.7) < g.frightTimer) catchable.push({ g, d });
    }
    if (!catchable.length) return null;
    const nearest = catchable.reduce((a, b) => (b.d < a.d ? b : a));
    const player = catchable.find((c) => c.g.isPlayer);
    const pick = player && player.d <= nearest.d + 6 ? [player] : catchable;
    const closest = pick.reduce((a, b) => (b.d < a.d ? b : a));
    if (closest.d <= FURY_RANGE) {
      this.prey = closest.g;
      return goal(closest.g);
    }
    const out = new Set<number>();
    for (const c of pick) for (const i of goal(c.g)) out.add(i);
    return out;
  }

  /**
   * Tiles to the nearest goal along a route, never doubling back through the
   * tile the route leaves behind. (A shared distance field would let a
   * reversal "reach" prey through the very tile he's turning away from.)
   */
  private routeLength(ctx: SimContext, goals: Set<number>, r: Route): number {
    const { maze } = ctx;
    const start = maze.index(r.tile.x, r.tile.y);
    if (goals.has(start)) return r.lead;
    const seen = new Set<number>([maze.index(r.behind.x, r.behind.y), start]);
    let frontier = [start];
    for (let steps = 1; frontier.length && steps < 60; steps++) {
      const next: number[] = [];
      for (const i of frontier) {
        const c = i % COLS;
        const row = (i / COLS) | 0;
        for (const dir of DIR_ORDER) {
          const n = neighborOf(c, row, dir);
          if (!maze.walkable(n.x, n.y)) continue;
          const ni = maze.index(n.x, n.y);
          if (seen.has(ni)) continue;
          if (goals.has(ni)) return r.lead + steps;
          seen.add(ni);
          next.push(ni);
        }
      }
      frontier = next;
    }
    return Infinity;
  }

  decide(ctx: SimContext): void {
    const m = this.mover;
    const routes = this.routes();
    if (routes.length === 0) return;
    const { fields, maze } = ctx;
    const at = m.nextTile;

    // --- Blinded: he's lost track of everything. At each junction he takes a
    // turn at random (never doubling back unless it's a dead end) and sticks
    // with it until the next one.
    if (this.blind > 0) {
      const forward = routes.filter((r) => !r.reverse);
      const pool = forward.length ? forward : routes;
      const key = maze.index(at.x, at.y);
      if (this.blindAt !== key || !pool.some((r) => r.dir === this.blindDir)) {
        this.blindAt = key;
        this.blindDir = pool[(Math.random() * pool.length) | 0].dir;
      }
      m.want = this.blindDir;
      return;
    }
    this.blindAt = -1;

    const pathTo = (field: Int32Array | null, r: Route, missing: number): number => {
      if (!field) return 0;
      const v = fieldAt(maze, field, r.tile.x, r.tile.y);
      return v < 0 ? missing : r.lead + v;
    };

    const scored: Array<{ r: Route; score: number }> = [];
    const threat = ctx.fields.threat;
    const hunt = this.powered ? this.huntGoals(ctx) : null;
    if (!hunt) this.prey = null;

    if (hunt) {
      // --- Hunt: chase the catchable ghost, turning round for it if needed,
      // but never through a ghost that has recovered. Prey at the tile just
      // ahead is within reach once he gets there: keep charging.
      if (hunt.has(maze.index(at.x, at.y)) && m.dir !== 'none') {
        m.want = m.dir;
        return;
      }
      for (const r of routes) {
        const safe = this.safeAt(threat, maze.index(r.tile.x, r.tile.y), r.lead);
        const len = Math.min(99, this.routeLength(ctx, hunt, r));
        scored.push({ r, score: -len * 4 - (safe ? 0 : 200) });
      }
    } else {
      const near = threat[maze.index(at.x, at.y)];
      const threatened = near >= 0 && near < THREAT_HORIZON;
      const canPressOn = routes.some((r) => !r.reverse);

      for (const r of routes) {
        const i = maze.index(r.tile.x, r.tile.y);
        const dotD = pathTo(fields.dot, r, 60);
        const t = threat[i];
        // How far ahead of the ghosts this tile keeps him, in his own tiles.
        const gap = t < 0 ? 12 : Math.max(-6, Math.min(12, t * this.speed - r.lead));

        if (!threatened) {
          // Nobody close: clear pellets decisively; stay only mildly wary.
          if (r.reverse && canPressOn) continue;
          scored.push({ r, score: -dotD + Math.min(gap, 6) * 0.35 });
          continue;
        }

        // --- Escape: prefer the route with the most maze he can still reach
        // first. A power pellet in that room is a counter-attack; the tunnel
        // slows the ghosts, not him.
        const room = this.room(ctx, r);
        let score = room.tiles * 3 + gap - dotD * 0.6;
        if (room.power && !this.powered && fields.power) score += 30 - pathTo(fields.power, r, 30) * 1.5;
        if (room.tunnel) score += 12;
        scored.push({ r, score });
      }
    }

    let best: { r: Route; score: number } | null = null;
    let bestForward: { r: Route; score: number } | null = null;
    for (const s of scored) {
      s.score += Math.random() * 0.02;
      if (!best || s.score > best.score) best = s;
      if (!s.r.reverse && (!bestForward || s.score > bestForward.score)) bestForward = s;
    }
    if (!best) return;

    // Reversing mid-corridor has to clearly beat pressing on, and not too often.
    if (best.r.reverse && bestForward) {
      const margin = hunt ? 2 : 6;
      if (this.reverseCd > 0 || best.score < bestForward.score + margin) best = bestForward;
    }
    if (best.r.reverse) this.reverseCd = REVERSE_COOLDOWN;
    m.want = best.r.dir;
  }

  update(dt: number, ctx: SimContext): void {
    if (!this.alive) {
      this.deathT += dt;
      return;
    }
    if (this.reverseCd > 0) this.reverseCd = Math.max(0, this.reverseCd - dt);
    if (this.blind > 0) this.blind = Math.max(0, this.blind - dt);
    this.decide(ctx);
    this.mover.speed = this.speed;
    this.mover.update(dt);
    this.dir = this.mover.dir;

    const moving = this.mover.dir !== 'none';
    this.mouthPhase += dt * (moving ? (this.furious ? 24 : 14) : 4);
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
    const speedUp = levelSpeedUp(level);
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

  /** Open-corridor speed right now (dash included), for Pac-Man's threat model. */
  cruiseSpeed(level: number): number {
    if (this.state === 'leaving') return SPEED.ghost * 0.8;
    const base = this.isPlayer ? SPEED.playerGhost : SPEED.ghost * levelSpeedUp(level);
    return base * (this.dashTimer > 0 ? DASH_BOOST : 1);
  }

  private speedFor(): number {
    const m = this.mover;
    const tunnel = isTunnel(m.tx, m.ty) ? TUNNEL_SLOW : 1;
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
        return (this.isPlayer ? SPEED.playerGhost : m.speed) * tunnel * (this.dashTimer > 0 ? DASH_BOOST : 1);
    }
  }

  private targetFor(ctx: SimContext): TilePos {
    if (this.state === 'leaving') return HOUSE_DOOR;
    if (this.state === 'eaten') return HOUSE_CENTER;

    const pacTile = { x: ctx.pac.mover.tx, y: ctx.pac.mover.ty };
    const pacDir: UnitDir = ctx.pac.mover.dir === 'none' ? 'left' : (ctx.pac.mover.dir as UnitDir);

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

  /**
   * Choose a direction: BFS toward the target, random when frightened. Judged
   * at the tile where the turn can actually happen (the one the ghost is
   * heading into), like Pac-Man; judging from the tile it's leaving made every
   * ghost overshoot junctions and zig-zag.
   */
  private chooseDir(ctx: SimContext, target: TilePos): void {
    const m = this.mover;
    const at = m.nextTile;
    const back = OPPOSITE[m.dir];

    // Eyes heading home turn round on the spot when home is behind them,
    // instead of running to the end of the corridor and doubling back.
    if (this.state === 'eaten' && back !== 'none') {
      const field = ctx.nav.to(target, true);
      const ahead = fieldAt(m.maze, field, at.x, at.y);
      const behindTile = m.t > 0 ? m.tile : neighborOf(at.x, at.y, back as UnitDir);
      const canTurn = m.t > 0 || m.canEnterFrom(at.x, at.y, back as UnitDir);
      const behind = canTurn ? fieldAt(m.maze, field, behindTile.x, behindTile.y) : -1;
      const aheadCost = (m.t > 0 ? 1 - m.t : 0) + ahead;
      const behindCost = (m.t > 0 ? m.t : 1) + behind;
      if (behind >= 0 && (ahead < 0 || behindCost + 0.5 < aheadCost)) {
        m.want = back;
        return;
      }
    }

    const opts: UnitDir[] = [];
    for (const d of DIR_ORDER) {
      if (d === back) continue;
      if (m.canEnterFrom(at.x, at.y, d)) opts.push(d);
    }
    if (opts.length === 0) {
      // Dead end ahead: turn round once there, not halfway along the step.
      if (m.t > 0) m.want = m.dir;
      else if (back !== 'none' && m.canEnterFrom(at.x, at.y, back as UnitDir)) m.want = back;
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
      const n = neighborOf(at.x, at.y, d);
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
      this.mover.speed = SPEED.ghost * levelSpeedUp(ctx.level);
      if (this.dashTimer > 0) this.mover.speed *= DASH_BOOST;
    }
  }
}

export const ghostStatusLine = (g: Ghost, ctx: SimContext): string => {
  if (g.state === 'eaten') return 'BANISHED';
  if (g.state === 'frightened') return 'FRIGHTENED';
  if (g.state === 'house') return 'HOUSE';
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
