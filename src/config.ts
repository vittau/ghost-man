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
  HUD_W = Math.max(350, Math.min(480, Math.round(SCREEN_W * 0.26)));
  VIEW_W = SCREEN_W - HUD_W;
  MAZE_ZOOM = Math.min(2.2, VIEW_W / WORLD_W);
  MAZE_OFFSET_X = (VIEW_W - WORLD_W * MAZE_ZOOM) / 2;
  CAM_MAX = Math.max(0, WORLD_H - SCREEN_H / MAZE_ZOOM);
}

/** Minimap scale factor for the side panel. */
export const MINIMAP_SCALE = 0.18;

// Speeds are expressed in tiles per second (classic arcade feel).
export const SPEED = {
  pac: 8.6,
  pacPowered: 10.4,
  pacFury: 11.4, // powered and closing in on his prey
  ghost: 8.0,
  ghostEaten: 15.0,
  playerGhost: 8.6,
};

/** Ghosts slow to this fraction of their speed in the side tunnel. */
export const TUNNEL_SLOW = 0.55;

/**
 * Frightened ghosts run at this fraction of their own normal speed (8.34
 * tiles/s for the player's ghost). A powered Pac-Man then closes ~15 tiles
 * over FRIGHT_TIME, under the maze's median path distance of 20. A flat 5.2
 * let him close 39+ (anywhere was in reach); a flat 8.0, ~18.
 */
export const FRIGHT_SLOW = 0.97;

export const FRIGHT_TIME = 7.5;
export const FRIGHT_FLASH = 2.2;

export const PAC_LIVES = 3; // times you must catch Pac-Man to clear a level
export const PLAYER_LIVES = 3; // lost each time Pac-Man eats your ghost
export const MAX_LIVES = 3; // clearing a level adds a life, up to this many
export const RESPAWN_BANISH = 4.5; // seconds a caught ghost sits in the house
export const READY_TIME = 2.0;

export const ABILITY_COOLDOWN = 8.0;
export const ABILITY_TIME = 1.4;
export const BLIND_TIME = 2.5; // Clyde's BLINDSIDE
export const PHASE_WALL_WARN = 3.0; // Inky's PHASE: seconds inside a wall before he blinks
export const PHASE_WALL_MAX = 5.0; // ...and before he's pushed out onto the nearest track

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

/**
 * Playfield colours, one per level (cycling): the neon tube runs from `top` to
 * `bottom` down the board, wall interiors from `fillTop` to `fillBottom`, and
 * `accent` tints the wall texture. All drawn from the vaporwave canon — hot
 * pink, cyan, mint, lavender, sunset gold — so every level stays on-style.
 */
export interface FieldTheme {
  top: number;
  bottom: number;
  fillTop: number;
  fillBottom: number;
  accent: number;
}

export const LEVEL_THEMES: FieldTheme[] = [
  // Neon: hot pink over cyan.
  { top: 0xff3fb0, bottom: 0x00e5ff, fillTop: 0x120727, fillBottom: 0x1f0c3c, accent: 0x00e5ff },
  // Sunset: gold melting into rose.
  { top: 0xffc94d, bottom: 0xff3f8e, fillTop: 0x1f0a1e, fillBottom: 0x2b0b2c, accent: 0xff9f43 },
  // Miami: mint over flamingo pink.
  { top: 0x05ffa1, bottom: 0xff71ce, fillTop: 0x0a1a26, fillBottom: 0x1d0d33, accent: 0x05ffa1 },
  // Ultraviolet: lavender over electric blue.
  { top: 0xb967ff, bottom: 0x01cdfe, fillTop: 0x150a35, fillBottom: 0x0b1540, accent: 0xb967ff },
  // Outrun: laser red into deep violet.
  { top: 0xff2d6e, bottom: 0x8a3bff, fillTop: 0x1d0619, fillBottom: 0x170a3c, accent: 0xff2d6e },
  // Vapor: pale lemon over lilac.
  { top: 0xfffb96, bottom: 0xb967ff, fillTop: 0x1a1430, fillBottom: 0x170b35, accent: 0xfffb96 },
];

export const themeForLevel = (level: number): FieldTheme =>
  LEVEL_THEMES[(Math.max(1, level) - 1) % LEVEL_THEMES.length];

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
  ability: 'dash' | 'warp' | 'phase' | 'blind';
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
    cooldown: 10,
    blurb: 'The shadow. Always on your tail.',
  },
  {
    id: 'pinky',
    name: 'PINKY',
    color: 0xff79c8,
    colorDark: 0x8a2f68,
    ability: 'warp',
    abilityName: 'WARP',
    abilityDesc: 'Jump to the corridor end',
    cooldown: 10,
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
    cooldown: 10,
    blurb: 'The wildcard. Ignores the maze.',
  },
  {
    id: 'clyde',
    name: 'CLYDE',
    color: 0xff9f43,
    colorDark: 0x8a4c14,
    ability: 'blind',
    abilityName: 'BLINDSIDE',
    abilityDesc: 'Blind Pac-Man for 2.5s',
    cooldown: 10,
    blurb: "The trickster. Now you don't."
  },
];

export const STANCE_ORDER: Stance[] = ['hunt', 'ambush', 'flank', 'guard'];

export const STANCE_INFO: Record<Stance, { name: string; desc: string; key: string }> = {
  hunt: { name: 'HUNT', desc: 'Classic chase', key: '1' },
  ambush: { name: 'AMBUSH', desc: 'Cut him off', key: '2' },
  flank: { name: 'FLANK', desc: 'Take his escape', key: '3' },
  guard: { name: 'GUARD', desc: 'Camp the pellets', key: '4' },
};

export const FONT_FAMILY = '"Press Start 2P", ui-monospace, Menlo, monospace';

// Starting tiles. Pac-Man's is each maze's P (see levels.ts); he sets off left.
export const PAC_START_DIR: Dir = 'left';
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
