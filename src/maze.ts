import { COLS, MAZE_LAYOUT, PAC_START, ROWS } from './config';
import type { TilePos } from './types';

export const WALL = 0;
export const FLOOR = 1;
export const DOOR = 2;

export const idx = (c: number, r: number): number => r * COLS + c;

/**
 * Static maze geometry plus the mutable pellet layer.
 *
 * Tiles are stored in flat typed arrays. The layout contains decorative spaces
 * outside the playfield; `pruneUnreachable` floods from Pac-Man's start (with
 * tunnel wrapping and the ghost door open) and turns anything unreachable into
 * a wall, so the outside world simply disappears.
 */
export class Maze {
  readonly kind: Uint8Array;
  private readonly baseDots: Uint8Array;
  dots: Uint8Array;
  dotsLeft = 0;
  dotsTotal = 0;
  powerLeft = 0;
  powerTotal = 0;

  constructor() {
    const n = COLS * ROWS;
    this.kind = new Uint8Array(n);
    this.dots = new Uint8Array(n);

    for (let r = 0; r < ROWS; r++) {
      const row = MAZE_LAYOUT[r] ?? '';
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] ?? ' ';
        const i = idx(c, r);
        if (ch === '#') this.kind[i] = WALL;
        else if (ch === '=') this.kind[i] = DOOR;
        else this.kind[i] = FLOOR;

        if (ch === '.') this.dots[i] = 1;
        else if (ch === 'o') this.dots[i] = 2;
      }
    }

    this.pruneUnreachable();
    this.baseDots = this.dots.slice();
    this.recount();
  }

  private wrapCol(c: number): number {
    if (c < 0) return COLS - 1;
    if (c >= COLS) return 0;
    return c;
  }

  /** Flood from Pac-Man's start; anything unreachable becomes wall. */
  private pruneUnreachable(): void {
    const seen = new Uint8Array(COLS * ROWS);
    const queue: number[] = [];
    const start = idx(PAC_START.x, PAC_START.y);
    seen[start] = 1;
    queue.push(start);

    while (queue.length) {
      const i = queue.pop() as number;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      for (const [dc, dr] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS) continue;
        const nc = this.wrapCol(c + dc);
        const ni = idx(nc, nr);
        // Door counts as reachable so the ghost house survives the pruning.
        if (seen[ni] || this.kind[ni] === WALL) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }

    for (let i = 0; i < this.kind.length; i++) {
      if (this.kind[i] !== WALL && !seen[i]) {
        this.kind[i] = WALL;
        this.dots[i] = 0;
      }
    }
  }

  private recount(): void {
    let dots = 0;
    let power = 0;
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] === 1) dots++;
      else if (this.dots[i] === 2) power++;
    }
    this.dotsLeft = dots;
    this.dotsTotal = dots;
    this.powerLeft = power;
    this.powerTotal = power;
  }

  resetDots(): void {
    this.dots.set(this.baseDots);
    this.recount();
  }

  kindAt(c: number, r: number): number {
    if (r < 0 || r >= ROWS) return WALL;
    const i = idx(this.wrapCol(c), r);
    return this.kind[i];
  }

  /** Flat array index for (c,r), wrapping columns. */
  index(c: number, r: number): number {
    return idx(this.wrapCol(c), Math.max(0, Math.min(ROWS - 1, r)));
  }

  isWall(c: number, r: number): boolean {
    return this.kindAt(c, r) === WALL;
  }

  walkable(c: number, r: number, ghostPass = false): boolean {
    const k = this.kindAt(c, r);
    if (k === WALL) return false;
    if (k === DOOR) return ghostPass;
    return true;
  }

  /** 0 = nothing, 1 = dot, 2 = power pellet. */
  eat(c: number, r: number): number {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 0;
    const i = idx(c, r);
    const v = this.dots[i];
    if (v === 1) this.dotsLeft--;
    else if (v === 2) {
      this.powerLeft--;
      this.dotsLeft--;
    }
    this.dots[i] = 0;
    return v;
  }

  /** All remaining power pellet tiles. */
  powerTiles(): TilePos[] {
    const out: TilePos[] = [];
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] === 2) out.push({ x: i % COLS, y: (i / COLS) | 0 });
    }
    return out;
  }

  allDotTiles(): TilePos[] {
    const out: TilePos[] = [];
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i] !== 0) out.push({ x: i % COLS, y: (i / COLS) | 0 });
    }
    return out;
  }

  /**
   * Multi-source BFS distance field (in tiles) over the maze.
   * Sources that land inside a wall are snapped to adjacent floor.
   */
  field(targets: TilePos[], ghostPass = false): Int32Array {
    const n = COLS * ROWS;
    const dist = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;

    const passable = (i: number): boolean => {
      const k = this.kind[i];
      if (k === WALL) return false;
      if (k === DOOR) return ghostPass;
      return true;
    };

    const seed = (i: number): void => {
      if (dist[i] !== -1) return;
      dist[i] = 0;
      queue[tail++] = i;
    };

    for (const t of targets) {
      const c = Math.max(0, Math.min(COLS - 1, t.x));
      const r = Math.max(0, Math.min(ROWS - 1, t.y));
      const i = idx(c, r);
      if (passable(i)) {
        seed(i);
      } else {
        // Snap a blocked target to whichever neighbours are floor.
        for (const [dc, dr] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          const nr = r + dr;
          if (nr < 0 || nr >= ROWS) continue;
          const ni = idx(this.wrapCol(c + dc), nr);
          if (passable(ni)) seed(ni);
        }
      }
    }

    while (head < tail) {
      const i = queue[head++];
      const c = i % COLS;
      const r = (i / COLS) | 0;
      const d = dist[i] + 1;
      for (const [dc, dr] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS) continue;
        const ni = idx(this.wrapCol(c + dc), nr);
        if (dist[ni] !== -1 || !passable(ni)) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }

    return dist;
  }
}

/** Per-frame memoisation of BFS fields so ghosts can share paths. */
export class NavCache {
  private cache = new Map<string, Int32Array>();

  constructor(private readonly maze: Maze) {}

  clear(): void {
    this.cache.clear();
  }

  to(target: TilePos, ghostPass: boolean): Int32Array {
    const key = `${target.x},${target.y},${ghostPass ? 1 : 0}`;
    let f = this.cache.get(key);
    if (!f) {
      f = this.maze.field([target], ghostPass);
      this.cache.set(key, f);
    }
    return f;
  }

  from(targets: TilePos[], ghostPass: boolean): Int32Array {
    return this.maze.field(targets, ghostPass);
  }
}
