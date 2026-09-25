# Ghost-Man

> An absolutely gorgeous, procedurally-rendered arcade game where **you are the ghost**.

You command a squad of four ghosts hunting an AI Pac-Man through a neon
vaporwave maze. Pac-Man is smart: he clears dots, grabs power pellets, and
hunts *you* when he's powered up.

## Quick start (local testing)

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/** — it opens automatically.

Even shorter, if you have `make`:

```bash
make        # installs deps and starts the dev server
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Vite dev server with hot reload |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build locally on :4173 |

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move your ghost |
| `1`–`4` | Squad stance: HUNT / AMBUSH / FLANK / GUARD |
| `Q` / `E` | Cycle stance |
| `Space` | **PINCER!** — the squad converges on Pac-Man |
| `Shift` | Signature ability (depends on your ghost) |
| `P` / `Esc` | Pause |
| `M` | Skip to the next song (in game) |
| `C` | Toggle the CRT effect |
| `F` | Toggle the FPS readout |
| `N` | Mute / unmute |

## The four ghosts

| Ghost | Ability |
| --- | --- |
| **Blinky** | *Shadow Dash* — burst of speed |
| **Pinky** | *Warp* — jump straight to the end of the corridor ahead |
| **Inky** | *Phase* — slip through walls |
| **Clyde** | *Blindside* — Pac-Man loses his bearings and wanders blindly for two and a half seconds |

## Rules

Catch Pac-Man three times to clear a level. You lose a life each time Pac-Man
eats your ghost, and earn one back every 2,000 points (up to five). If Pac-Man
clears the maze, it's game over on the spot.

## Deploying

`npm run build` emits a fully static bundle to `dist/`, already configured with
the `/gorgeous-ghost-man/` base path for **vitormach.dev/gorgeous-ghost-man/**.
Drop `dist/` on any static host.

## Architecture

```
src/
  main.ts      boot: Pixi app, resize, game loop
  game.ts      state machine, rules, orchestration
  config.ts    dimensions, vaporwave palette, maze layout, roster
  types.ts     shared types + direction tables
  maze.ts      tile grid, pellet layer, BFS distance fields
  mover.ts     grid-locked, drift-free movement
  actors.ts    Pac-Man + ghost simulation and AI
  draw.ts      procedural vector art (Pac-Man, ghosts, pellets)
  filters.ts   bloom + CRT post-processing
  fx.ts        particles, popups, screen shake, flash
  audio.ts     procedural WebAudio synth (SFX + music)
  hud.ts       in-game HUD
  menu.ts      attract-mode title screen + ghost select
```

Everything is drawn from code — no sprite sheets, no binary assets.
