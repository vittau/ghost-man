// ---------------------------------------------------------------------------
// Ghost-Man — global configuration: dimensions, palette, ghost roster.
// ---------------------------------------------------------------------------

import type { Dir, GhostId, Stance, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Layout. A wide 16:10-ish canvas: the maze lives in a vertically-scrolling
// viewport on the left, and a tall HUD panel occupies the right column.
// ---------------------------------------------------------------------------
export const TILE = 35;
export const COLS = 28;
export const ROWS = 31;

export const WORLD_W = COLS * TILE; // 980
export const WORLD_H = ROWS * TILE; // 1085

/** Height is fixed; width adapts to the window aspect so nothing is stretched. */
export const SCREEN_H = 760;
export let SCREEN_W = 1280;
export let HUD_W = 320;
export let VIEW_W = SCREEN_W - HUD_W;

/** Maze zoom so the board always fills the viewport width. */
export let MAZE_ZOOM = 1;
export let MAZE_OFFSET_X = 0;
/** Maximum vertical camera scroll (in world pixels). */
export let CAM_MAX = 0;

/**
 * Recompute the layout for a given window width. Keeping the logical aspect
 * equal to the window aspect means the canvas maps 1:1 with no letterbox and
 * no non-uniform stretching.
 */
export function setViewportWidth(width: number): void {
  SCREEN_W = Math.max(1040, Math.round(width));
  HUD_W = Math.max(300, Math.min(460, Math.round(SCREEN_W * 0.22)));
  VIEW_W = SCREEN_W - HUD_W;
  MAZE_ZOOM = Math.min(2.2, VIEW_W / WORLD_W);
  MAZE_OFFSET_X = (VIEW_W - WORLD_W * MAZE_ZOOM) / 2;
  CAM_MAX = Math.max(0, WORLD_H - SCREEN_H / MAZE_ZOOM);
}

/** Minimap scale factor for the side panel. */
export const MINIMAP_SCALE = 0.18;

export const TUNNEL_ROW = 14;

// Speeds are expressed in tiles per second (classic arcade feel).
export const SPEED = {
  pac: 8.6,
  pacPowered: 10.4,
  ghost: 8.0,
  ghostFright: 5.2,
  ghostEaten: 15.0,
  playerGhost: 8.6,
};

export const FRIGHT_TIME = 7.5;
export const FRIGHT_FLASH = 2.2;

export const PAC_LIVES = 3; // times you must catch Pac-Man to clear a level
export const PLAYER_LIVES = 3; // hearts; lost when Pac-Man clears the maze
export const RESPAWN_BANISH = 4.5; // seconds a caught ghost sits in the house
export const READY_TIME = 2.0;

export const PINCER_TIME = 3.2;
export const PINCER_COOLDOWN = 11.0;

export const ABILITY_COOLDOWN = 8.0;
export const ABILITY_TIME = 1.4;

// Scatter / chase schedule (classic flavour).
export const MODE_SCHEDULE: Array<{ mode: 'scatter' | 'chase'; time: number }> = [
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 7 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: 20 },
  { mode: 'scatter', time: 5 },
  { mode: 'chase', time: Infinity },
];

// Vaporwave palette. Hot pink → cyan gradients, sunset chrome, deep violet.
export const PALETTE = {
  bg: 0x1a0b34,
  bgDeep: 0x0a0318,
  wallTop: 0xff3fb0,
  wallBot: 0x00e5ff,
  wall: 0xff3fb0,
  wallDim: 0x6a2b8f,
  wallFill: 0x14062b,
  door: 0xffa8e8,
  dot: 0xffe3fb,
  power: 0x7dfcff,
  pac: 0xffe14d,
  pacGlow: 0xfff4b0,
  frightBody: 0x3a4bff,
  frightFlash: 0xfff0ff,
  eyeWhite: 0xf7f4ff,
  eyePupil: 0x24104a,
  text: 0xffe6ff,
  textDim: 0x9d7fc4,
  accent: 0xff4fd8,
  accent2: 0x00e5ff,
  danger: 0xff2d6e,
  gold: 0xffc94d,
  fruit: 0xff5470,
  white: 0xffffff,
  chrome0: 0xbff4ff,
  chrome1: 0xffffff,
  chrome2: 0xd9b8ff,
  sunTop: 0xffd76a,
  sunMid: 0xff6fb0,
  sunBot: 0x7a2ff0,
  horizon: 0xff5f9e,
  grid: 0xff3fb0,
};

// Synthwave sky / floor gradient stops.
export const SKY = {
  top: 0x0a0318,
  upper: 0x2a0a4a,
  mid: 0x5b1d6e,
  lower: 0x8a2a7a,
  horizon: 0xff5f9e,
  floor: 0x1a0b34,
};

export interface GhostDef {
  id: GhostId;
  name: string;
  color: number;
  colorDark: number;
  ability: 'dash' | 'blink' | 'phase' | 'decoy';
  abilityName: string;
  abilityDesc: string;
  cooldown: number;
  blurb: string;
}

export const GHOSTS: GhostDef[] = [
  {
    id: 'blinky',
    name: 'BLINKY',
    color: 0xff3b30,
    colorDark: 0x7a1410,
    ability: 'dash',
    abilityName: 'SHADOW DASH',
    abilityDesc: 'Burst of raw speed',
    cooldown: 6,
    blurb: 'The shadow. Always on your tail.',
  },
  {
    id: 'pinky',
    name: 'PINKY',
    color: 0xff79c8,
    colorDark: 0x8a2f68,
    ability: 'blink',
    abilityName: 'BLINK',
    abilityDesc: 'Warp two tiles ahead',
    cooldown: 7,
    blurb: 'The ambusher. Cuts you off.',
  },
  {
    id: 'inky',
    name: 'INKY',
    color: 0x22d3ee,
    colorDark: 0x10606f,
    ability: 'phase',
    abilityName: 'PHASE',
    abilityDesc: 'Through one wall',
    cooldown: 8,
    blurb: 'The wildcard. Ignores the maze.',
  },
  {
    id: 'clyde',
    name: 'CLYDE',
    color: 0xff9f43,
    colorDark: 0x8a4c14,
    ability: 'decoy',
    abilityName: 'DECOY',
    abilityDesc: 'Lure Pac-Man with a phantom',
    cooldown: 8,
    blurb: 'The trickster. Plays with minds.',
  },
];

export const STANCE_ORDER: Stance[] = ['hunt', 'ambush', 'flank', 'guard'];

export const STANCE_INFO: Record<Stance, { name: string; desc: string; key: string }> = {
  hunt: { name: 'HUNT', desc: 'Direct pursuit', key: '1' },
  ambush: { name: 'AMBUSH', desc: 'Cut him off', key: '2' },
  flank: { name: 'FLANK', desc: 'Take his escape', key: '3' },
  guard: { name: 'GUARD', desc: 'Camp the pellets', key: '4' },
};

export const FONT_FAMILY = '"Press Start 2P", ui-monospace, Menlo, monospace';

// ---------------------------------------------------------------------------
// The maze. 28 x 31.
//   #  wall
//   .  dot
//   o  power pellet
//   =  ghost-house door (ghosts only)
//  (space) empty walkable floor
// Cells outside the maze are spaces too; a reachability pass prunes them.
// ---------------------------------------------------------------------------
export const MAZE_LAYOUT: string[] = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###==### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

// Starting tiles.
export const PAC_START = { x: 13, y: 23, dir: 'left' as Dir };
export const HOUSE_DOOR = { x: 13, y: 11 }; // tile just above the door
export const HOUSE_CENTER = { x: 13, y: 14 };

export const PLAYER_START = { x: 13, y: 11 }; // player ghost starts outside, above the house

// Corner scatter targets, one per ghost.
export const SCATTER: Record<GhostId, Vec2> = {
  blinky: { x: 25, y: -2 },
  pinky: { x: 2, y: -2 },
  inky: { x: 27, y: 32 },
  clyde: { x: 0, y: 32 },
};

// Where the three AI friends wait inside the house, and their release delays.
export const HOUSE_SLOTS: Record<GhostId, { x: number; y: number; release: number }> = {
  blinky: { x: 13, y: 11, release: 0 },
  pinky: { x: 13, y: 14, release: 1.5 },
  inky: { x: 11, y: 14, release: 4.5 },
  clyde: { x: 15, y: 14, release: 8.0 },
};
