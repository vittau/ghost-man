# AGENTS.md

Guidance for agents and contributors working in this repository.

## What this is

**Ghost-Man** — a browser arcade game. You play as one of four ghosts hunting an
AI-controlled Pac-Man, and you command your three AI teammates with squad
stances. Built with **PixiJS v8 + Vite + TypeScript**. All art is drawn
procedurally in code; there are no sprite sheets.

## Commands

```bash
npm install
npm run dev          # dev server at http://localhost:5173/  (alias: npm start, or `make`)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build on :4173
```

`npm run dev` serves at the root URL; only the production build uses the
`/gorgeous-ghost-man/` base path (see `vite.config.ts`).

## Layout of the source

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Bootstrap: Pixi app, responsive sizing, game loop, audio unlock |
| `src/game.ts` | State machine, rules, camera, rendering, orchestration |
| `src/config.ts` | Dimensions, palette, maze layout, ghost roster, speeds |
| `src/types.ts` | Shared types and direction tables |
| `src/maze.ts` | Tile grid, pellet layer, BFS distance fields (`NavCache`) |
| `src/mover.ts` | Grid-locked, drift-free movement |
| `src/actors.ts` | Pac-Man + ghost simulation and AI |
| `src/draw.ts` | Procedural vector art (Pac-Man, ghosts, door) |
| `src/crt-filter.ts` | Custom `crt-geom`/Blargg-style CRT filter |
| `src/filters.ts` | Bloom + CRT construction (with fallback) |
| `src/fx.ts` | Particles, popups, screen shake, flash, hit-stop |
| `src/audio.ts` | Procedural WebAudio SFX (no files) |
| `src/music.ts` | Bundled MP3 playback, pre-buffering, ducking |
| `src/hud.ts` | Right-hand panel (score, squad orders, ability, lives) |
| `src/menu.ts` | Attract screen: synthwave backdrop + ghost select |
| `src/input.ts` | Keyboard state + edge detection |
| `src/color.ts` | Colour blending helpers |
| `src/style.css` | Page shell, bundled font, full-bleed canvas |

## Invariants — please don't break these

1. **Procedural art only.** No sprite sheets or image assets. Draw with
   `Graphics`/`draw.ts`. The only binary assets are the music and the font.
2. **Movement uses the tile+progress model** (`Mover`): an actor sits between the
   centre of tile `(tx,ty)` and `(tx,ty)+dir` at progress `t ∈ [0,1]`, and the
   pixel position is a pure function of those. This is what makes turning exact
   and drift-free. Do not replace it with free pixel movement.
3. **Ghost AI uses BFS distance fields** (`maze.field`, `NavCache.to`), not
   greedy Euclidean targeting. Greedy breaks the ghost-house exit and the
   eaten-ghost return path.
4. **Responsive layout.** Canvas height is fixed (`SCREEN_H = 760`); width
   adapts to the window aspect via `setViewportWidth()` so the canvas maps 1:1
   with no letterbox and no stretching. After changing the viewport you must
   call `hud.layout()`, `menu.layout()` and `fx.resize(...)`. **Never capture
   `SCREEN_W`/`HUD_W`/`VIEW_W` in module-scope constants** — they change on
   resize. Keep positions in `layout()` methods.
5. **The CRT filter must receive the render-target size** (`renderer.width` /
   `renderer.height`), not the CSS size. Feeding it the displayed size breaks
   its aspect correction and skews the curvature.
6. **The attract-mode demo runs the real simulation** but must never mutate the
   score or the persisted high score. See the `demo` flag in `eatGhost()`.
7. **The player's ability is only usable in state `'normal'`.** It is locked
   while frightened, eaten, or in the house — that's the cost of the power
   pellet reversal.
8. **Pac-Man hunts when powered.** `Pacman.decide()` has an explicit hunt mode
   that takes priority over pellet seeking.
9. **Clyde's decoy outranks real ghosts** in Pac-Man's threat model
   (`SimFields.decoy`), so it can genuinely herd him.
10. **PHASE crosses one wall** and switches off the moment the ghost is back on
    a walkable tile (`Ghost.beginPhase`). It must never strand an actor inside
    geometry.
11. **No minimap.** Deliberate design decision: a board-wide tactical overlay
    lets a good player ignore the maze entirely, which defeats the game. Don't
    add one, or any equivalent whole-board readout.
12. **Music is CC-BY 4.0** by *vandalorum / Primal Light*. The attribution must
    remain in `README.md` and on the title screen (`menu.ts`).
13. **Audio needs a user gesture.** Nothing plays until `unlockAudio()` runs from
    a key/pointer handler; the menu surfaces the state via `audioHintText()`.

## Conventions

- Speeds are expressed in **tiles per second** (`SPEED` in `config.ts`); multiply
  by `TILE` for pixels.
- Colours come from `PALETTE` / `SKY` in `config.ts`. Keep the vaporwave
  palette (hot pink → cyan gradients, deep violet) rather than inventing new
  colours inline.
- `npm run build` runs `tsc --noEmit` first and the project is strict
  (`noUnusedLocals`, `noUnusedParameters`), so unused imports fail the build.

## Verifying changes

```bash
npm run typecheck && npm run build
```

For visual checks, run the dev server and drive a headless browser over the
Chrome DevTools Protocol (a small script that connects to
`--remote-debugging-port`, dispatches key events and captures a screenshot works
well). WebGL must be available; the renderer is pinned to `preference: 'webgl'`
because the CRT filter is GLSL-only.

## Deploying

`npm run build` emits a static bundle in `dist/`, already configured for
`vitormach.dev/gorgeous-ghost-man/`. It also runs from `file://`, so wrapping it
in Tauri or Electron for a desktop build needs no code changes.
