# AGENTS.md

Guidance for agents and contributors working in this repository.

## What this is

**Ghost-Man** — a browser arcade game. You play as one of four ghosts hunting an
AI-controlled Pac-Man, and you command your three AI teammates with squad
stances. Built with **PixiJS v8 + Vite + TypeScript**, shipped on the web and
as an **Electron** desktop app (Steam Deck/Linux first, plus Windows and
macOS). All art is drawn procedurally in code; there are no sprite sheets.

## Commands

```bash
npm install
npm run dev          # dev server at http://localhost:5173/  (alias: npm start, or `make`)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build on :4173
npm run desktop      # build, then run it in the Electron shell (make desktop)
npm run dist         # package the desktop app for this OS into release/
```

Node 24 (`.nvmrc`). The game's npm packages are `devDependencies` on purpose:
Vite bundles them into `dist/`, and electron-builder would otherwise ship a
second copy in the app's `node_modules`.

`npm run dev` serves at the root URL. `make deploy` publishes to GitHub Pages
(see Deploying).

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
| `src/draw.ts` | Procedural vector art (Pac-Man, ghosts, silhouettes, sparkles, door) |
| `src/crt-filter.ts` | Custom `crt-geom`/Blargg-style CRT filter |
| `src/filters.ts` | Bloom + CRT construction (with fallback) |
| `src/fx.ts` | Particle streaks, shockwave rings, popups, shake, flash, hit-stop |
| `src/audio.ts` | Procedural WebAudio SFX (no files) |
| `src/music.ts` | Bundled MP3 playback, pre-buffering, ducking |
| `src/hud.ts` | Right-hand panel (score, squad orders, ability, lives) |
| `src/menu.ts` | Attract screen: sunset, wireframe terrain + mountains, ghost select |
| `src/input.ts` | Keyboard + gamepad state, command bindings, last-used device |
| `src/desktop.ts` | Hooks the desktop shell exposes (quit); absent on the web |
| `src/color.ts` | Colour blending helpers |
| `src/noise.ts` | Value noise (wall texture, menu terrain) |
| `src/style.css` | Page shell, bundled font, full-bleed canvas |
| `electron/main.js` | Desktop shell: window, `app://` file server, switches |
| `electron/preload.cjs` | Sandboxed bridge behind `src/desktop.ts` |
| `electron-builder.yml` | Desktop packaging, one section per OS |
| `build/linux/ghost-man` | Linux launcher script: cleans Steam's environment, picks flags |
| `docs/LINUX.md` | Steam Deck findings: what broke, why, how to debug it |
| `docs/readme/generate.mjs` | Renders the README banner and section headers |

## Invariants — please don't break these

1. **Procedural art only.** No sprite sheets or image assets. Draw with
   `Graphics`/`draw.ts`. The only binary assets are the music, the font and
   the favicon PNGs (`public/favicon-32.png`, `public/apple-touch-icon.png`),
   which are renders of `public/favicon.svg` for Safari, which ignores SVG
   favicons, and `build/icon.png`, a 1024px render of the same SVG that
   electron-builder turns into the app icons. Re-render them if the SVG
   changes. `docs/` holds the README's screenshots and art and notes such as
   `LINUX.md`; none of it ships.
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
   resize. Keep positions in `layout()` methods. Always follow a
   `renderer.resize()` with `game.layout()`: it also clears stale filter-stack
   textures (`clearStaleFilterTextures`), working around a Pixi 8.21 bug where
   a resize destroys a texture the next frame still reads — the throw stops
   Pixi's ticker for good and the game freezes.
5. **The CRT filter must receive the render-target size** (`renderer.width` /
   `renderer.height`), not the CSS size. Feeding it the displayed size breaks
   its aspect correction and skews the curvature. The shader also normalises
   `vTextureCoord` by `uOutputFrame.zw * uInputSize.zw`: Pixi's pooled filter
   texture can be larger than the frame, and centring on raw coordinates
   skews the warp. Keep the render resolution at 1 or above
   (`resolutionFor()` in `main.ts`): below 1, the bloom nested under the CRT
   pass loses its bottom rows (a background-coloured band across the lower
   maze). That is also why there is no automatic quality drop.
6. **The attract-mode demo runs the real simulation** but must never mutate the
   score or the persisted high score. See the `demo` flag in `eatGhost()`.
7. **The player's ability is only usable in state `'normal'`.** It is locked
   while frightened, eaten, or in the house — that's the cost of the power
   pellet reversal.
8. **Pac-Man hunts when powered.** `Pacman.decide()` has an explicit hunt mode
   that takes priority over pellet seeking, and prefers the player's ghost.
9. **Every AI actor judges turns at the tile it's heading into**
   (`Mover.nextTile`), not the one it's leaving — Pac-Man in `decide()`, ghosts
   in `chooseDir()`. Judging from the tile being left makes actors overshoot
   junctions and zig-zag. Pac-Man escapes by comparing arrival times
   (`threatField`: per-ghost travel time with dash and tunnel slowdown priced
   in).
10. **PHASE crosses one wall** and switches off the moment the ghost is back on
    a walkable tile (`Ghost.beginPhase`). It must never strand an actor inside
    geometry.
11. **No minimap.** Deliberate design decision: a board-wide tactical overlay
    lets a good player ignore the maze entirely, which defeats the game. Don't
    add one, or any equivalent whole-board readout.
12. **Music is CC-BY 4.0** by *vandalorum / Primal Light*, from OpenGameArt's
    [Space / Fast Synth / Epic Themes](https://opengameart.org/content/space-fast-synth-epic-themes).
    The attribution must remain in `README.md` and on the title screen
    (`menu.ts`).
13. **Audio needs a user gesture.** Nothing plays until `unlockAudio()` runs from
    a key/pointer handler; the menu surfaces the state via `audioHintText()`.
    The one exception is where autoplay is allowed — the desktop shell turns
    the policy off — which `autoplayAllowed()` in `main.ts` detects to unlock
    at boot. Don't bypass the check on the web.
14. **Every command works on keyboard and controller.** Game code reads
    `input.pressed(action)`, never raw key codes (bar the keyboard-only
    toggles `C`/`F`/digits). A new command gets bindings in both tables in
    `input.ts`, and any text that names a key has a gamepad wording picked
    by `input.lastDevice` (menu `CONTROLS`, HUD `HINTS`, prompts).

## Conventions

- **Text is sized for a 7" 1280x800 handheld (Steam Deck).** Nothing below
  10px in `Press Start 2P`; check new HUD/menu text at that resolution (the
  HUD panel is at its 350px minimum there).
- Most art is redrawn every frame into `Graphics`. Cache anything that owns a
  GPU resource — `FillGradient`s are built once per colour (`bodyGradient()`
  in `draw.ts`), never per frame.
- Speeds are expressed in **tiles per second** (`SPEED` in `config.ts`); multiply
  by `TILE` for pixels.
- Colours come from `PALETTE` / `SKY` in `config.ts`. Keep the vaporwave
  palette (hot pink → cyan gradients, deep violet) rather than inventing new
  colours inline.
- `npm run build` runs `tsc --noEmit` first and the project is strict
  (`noUnusedLocals`, `noUnusedParameters`), so unused imports fail the build.
- **Controller labels follow the Steam Deck** (Xbox layout under Steam
  Input): A/B/X/Y, L1/R1, L2/R2, VIEW ⧉, MENU ☰.

## Verifying changes

```bash
npm run typecheck && npm run build
```

For visual checks, run the dev server and drive a headless browser over the
Chrome DevTools Protocol (a small script that connects to
`--remote-debugging-port`, dispatches key events and captures a screenshot works
well). WebGL must be available; the renderer is pinned to `preference: 'webgl'`
because the CRT filter is GLSL-only. Also test with
`Emulation.setDeviceMetricsOverride({ deviceScaleFactor: 2 })`: a fractional
render resolution is what exposes filter-texture sizing bugs (skewed CRT,
resize freezes).

For the desktop shell, `npm run desktop` and pass `--remote-debugging-port`
to Electron to drive it the same way. There's no gamepad in CDP; override
`navigator.getGamepads` from `Runtime.evaluate` with a scripted pad object.
A viewport override is dropped when the CDP session closes, and the resize
that follows re-runs `fit()`, so do all steps of a check in one session.

Linux/Steam Deck problems mostly don't reproduce on a Mac. Read
[`docs/LINUX.md`](docs/LINUX.md) before changing the desktop shell, the
launcher or the GPU switches: it has the log layout, the Deck findings and a
debugging playbook.

## Deploying

`npm run build` emits a static bundle in `dist/` with a relative base
(`base: './'`), so it works under any sub-path. `make deploy` builds and
commits `dist/` onto the `gh-pages` branch; GitHub Pages serves it at
`https://www.vitormach.dev/ghost-man/` (the account's Pages domain).

- Keep the base relative — an absolute base 404s every asset on Pages.
- The domain sits behind Cloudflare, which caches HTML (and 404s) at the
  edge for up to a day. After a deploy, the owner purges the Cloudflare cache
  to make it live. Until then a stale `index.html` may be served, so
  `make deploy` never deletes old hashed files from `assets/` — the stale page
  must still find the bundle it references. Don't switch it to a fresh
  force-pushed branch.

## Desktop builds and releases

The Electron shell (`electron/main.js`) loads the same `dist/` bundle:

- It serves `dist/` over a privileged `app://ghost-man` scheme, never
  `file://`: fetch, `<audio>` range requests and a stable localStorage origin
  (the high score) depend on it. The `grantFileProtocolExtraPrivileges` fuse
  is off accordingly.
- The renderer is sandboxed with context isolation; its only link to the
  shell is `window.ghostDesktop` from `preload.cjs` (CommonJS, as sandboxed
  preloads must be). Anything desktop-only checks `desktop` first.
- The window shows at once, not on `ready-to-show`.
- Electron is chosen over Tauri for Chromium's WebGL and media stack on
  Linux (Tauri would use WebKitGTK there). Chromium is most of the ~120 MB
  download; `electronLanguages` and per-arch DMGs trim what can be trimmed.

Linux / Steam Deck (details and evidence in [`docs/LINUX.md`](docs/LINUX.md)):

- `ghost-man` is a launcher script (`build/linux/ghost-man`, shipped via
  `extraFiles`); the Electron binary is `ghost-man-bin`. Keep the README's
  Steam Deck steps pointing at `ghost-man`. The script clears `LD_PRELOAD`
  (Steam overlay) and `LD_LIBRARY_PATH` (Steam runtime), adds
  `--no-sandbox` when Steam started it, and adds `--disable-gpu-compositing`
  in Gaming Mode (Steam-started, no Wayland): GPU-composited frames go out
  through a Vulkan swapchain that never reaches gamescope's screen.
- `main.js` runs WebGL on ANGLE's Vulkan backend on SteamOS; the OpenGL
  backend drops part of the last full-screen pass there (a black triangle).
- Display-platform switches (`--ozone-platform`) are chosen before
  `main.js` runs, so they only work on the real command line. GPU switches
  (`--use-angle`, `--enable-features`) from `main.js` do work.
- Test flags: `./ghost-man --flag` from a shell, or Steam launch options
  `GHOST_MAN_FLAGS="--flag" %command%`. Arguments *after* `%command%` never
  reached the launcher on the Deck.
- Logs in `userData` (`~/.config/Ghost-Man/`, following `productName`):
  `launch.log` (launcher + the binary's stderr) and `ghost-man.log` (shell
  events, GPU status, renderer console) are rewritten every launch;
  `chromium.log` appends. Keep logging failure-proof: it runs before
  anything else.

`npm version X.Y.Z && git push --follow-tags` releases:
`.github/workflows/release.yml` builds one job per OS (electron-builder's
Linux `dir` target repacked as a `Ghost-Man/` folder in a `.tar.xz` for the
Deck, NSIS + portable for Windows, arm64 + x64 DMGs for macOS), stamps the
tag's version with `-c.extraMetadata.version`, and publishes a GitHub release
with `SHA256SUMS.txt`. The builds are unsigned (macOS ad-hoc), so the README
explains the Gatekeeper and SmartScreen prompts.
