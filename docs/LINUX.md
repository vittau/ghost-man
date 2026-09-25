# Linux and Steam Deck notes

What we learned getting the Electron build to run on a Steam Deck, for the
next agent who touches `electron/`, `build/linux/ghost-man` or the release
workflow. It records what was **observed on the device** (logs the owner ran
and pasted back), what was **inferred**, and what is still **open**. None of
it could be reproduced on the Mac except where noted, so test on a Deck
before believing a fix.

## The setup that works (v0.1.4)

| | Desktop Mode | Gaming Mode |
| --- | --- | --- |
| Session | KDE Plasma, **Wayland** (`DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`) | gamescope, **X11 only** (`DISPLAY=:1`, no `WAYLAND_DISPLAY`) |
| Started by | Konsole, or Steam | Steam (`SteamGameId`, `SteamAppId`, `SteamDeck=1`, `SteamOS=1` set) |
| Chromium platform | Wayland (Chromium's own pick) | X11 |
| WebGL | ANGLE on Vulkan (RADV) | ANGLE on Vulkan (RADV) |
| Compositing | GPU | **software** (`--disable-gpu-compositing`) |
| Sandbox | on | **off** when Steam starts it (`--no-sandbox`) |

The chain: Steam or the shell runs `Ghost-Man/ghost-man`, which is the
launcher script from `build/linux/ghost-man`. The launcher logs, cleans the
environment, adds flags, and `exec`s `Ghost-Man/ghost-man-bin`, the Electron
binary. Then `electron/main.js` adds the SteamOS GPU switches and writes its
own log.

Where each decision lives:

- `build/linux/ghost-man`: clears `LD_PRELOAD` and `LD_LIBRARY_PATH`. When
  Steam starts it (`SteamGameId` set), it adds `--no-sandbox`, plus
  `--disable-gpu-compositing` if there is no `WAYLAND_DISPLAY`. It appends
  `$GHOST_MAN_FLAGS`.
- `electron/main.js`: on SteamOS (`ID=steamos` in `/etc/os-release`), and
  unless `--use-angle` was given, it adds `--use-angle=vulkan
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`. It shows
  the window at once (not on `ready-to-show`) and logs.
- `src/main.ts`: render resolution is never below 1, there is no automatic
  quality drop, and it logs the first three FPS samples.

## Logs: where and how to read them

All three live in `~/.config/Ghost-Man/`. The folder follows `productName`
in `package.json`; before that was set, it was `~/.config/gorgeous-ghost-man/`.

| File | Written by | Lifetime | Contents |
| --- | --- | --- | --- |
| `launch.log` | the launcher | **rewritten** every launch | args, the `LD_*` and Steam/session variables it saw, the flags it added, the final `exec ghost-man-bin …` line, then all of the binary's stdout/stderr (Chromium errors, `[Gamescope WSI]` layer chatter) |
| `ghost-man.log` | `main.js` | **rewritten** every launch | start (version, argv, env), GPU feature status, `child process gone`, page load, renderer console (`[ghost-man] renderer up: webgl 1216x760`, `[ghost-man] fps …`) |
| `chromium.log` | Chromium (`--log-file`) | **appends** across launches | Chromium's own log; filter by the PID or timestamp you care about |

Reading them:

- **If `launch.log` is not from the launch you just made** (check its
  timestamp and args), the launcher never ran. The problem is before the
  game, in how it was started.
- **If `launch.log` is fresh but `ghost-man.log` is stale or empty**, the
  binary hung or died before `main.js` ran: sandbox, libraries, or GPU
  process start.
- **`renderer up: webgl …` is the line that matters.** `renderer up:
  canvas` means the GPU process died and Pixi fell back to Canvas2D. All
  filters are then skipped (`filter "…" is not supported in Canvas2D`), so
  rendering bugs "disappear" without being fixed.
- `child process gone {"type":"GPU","reason":"abnormal-exit"}` three times
  in a row means Chromium gave up on the GPU.
- Read the logs **before launching again**, because the first two are
  overwritten. The owner reads them in Desktop Mode after a Gaming Mode
  attempt.

## Findings, in the order we hit them

### 1. Gaming Mode: Steam's spinner forever, Abort doesn't work (fixed in v0.1.2)

- **Observed.**
  - Steam's launch spinner never cleared, and *Abort Game* did nothing.
  - The only way out was the power menu → Restart, and switching to Desktop
    Mode afterwards took a long time.
  - No music played.
  - The attempt **wrote nothing to `ghost-man.log`**, so `main.js` never ran.
  - The same build ran fine from Konsole in Desktop Mode.
- **Environment Steam passes** (captured later by the launcher):
  `LD_PRELOAD=:…/ubuntu12_32/gameoverlayrenderer.so:…/ubuntu12_64/gameoverlayrenderer.so`.
  `LD_LIBRARY_PATH` was empty in the captures we have.
- **Fix.** The launcher script clears `LD_PRELOAD` and `LD_LIBRARY_PATH` and
  adds `--no-sandbox` when `SteamGameId` is set. With v0.1.2, Gaming Mode
  started: sound and controller worked, and the screen was black (finding 4).
- **Not isolated:** which of the three changes mattered. The owner
  remembered Chromium in Steam needing `--no-sandbox`. That fits the
  "hangs before `main.js`" symptom, because the zygote/sandbox starts before
  JS. It is still unproven. v0.1.1 had also moved window showing off
  `ready-to-show` and pinned ANGLE on OpenGL; neither changed the spinner.

### 2. Black triangle in the lower right (fixed by ANGLE on Vulkan)

- **Observed** in Desktop Mode with Chromium's default (ANGLE on OpenGL,
  Mesa radeonsi):
  - a solid triangle of background colour covers the lower right of the
    whole screen, HUD included;
  - its edge runs from about the bottom-left corner to about a quarter of
    the way up the right edge, so it is *not* a screen diagonal.
- **Inference.**
  - It spans the HUD, so it comes from a full-screen pass: the CRT filter on
    `app.stage`, or the back-buffer present (`useBackBuffer: true`), which
    Pixi draws as one oversized triangle (`GlBackBufferSystem`).
  - The CRT shader clamps its sampling and writes alpha 1, so it would smear
    rather than paint a clean triangle. That points at a triangle going
    unrasterised, or a bad vertex, in the last pass.
- **Not reproducible on macOS**, not even with `--use-angle=gl` and a forced
  low-quality mode.
- **Fix.** `--use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`
  renders correctly on the Deck (owner-verified, effects on). `main.js`
  applies it on SteamOS only; other Linux keeps Chromium's default.
- **Open.** Root cause in the GL path. Finding it would let Linux use OpenGL
  throughout, with GPU compositing in Gaming Mode (see finding 4). The next
  step would be a build with debug switches to turn off the CRT, bloom and
  back buffer one at a time under `--use-angle=gl`.

### 3. `--use-angle=vulkan` alone "fixed" the triangle by killing the GPU

With v0.1.1, which pinned `--disable-features=Vulkan`, passing only
`--use-angle=vulkan` crashed the GPU process three times (exit code 8704).
Chromium fell back to software and Pixi to Canvas2D (`renderer up:
canvas`). The picture had no triangle only because it had no filters at all.
Asking ANGLE for Vulkan needs the `Vulkan` feature enabled. **Lesson:**
confirm `renderer up: webgl` before calling a rendering bug fixed.

### 4. Gaming Mode: black screen after "LOADING…" (fixed in v0.1.3, at a cost)

- **Observed.**
  - The HTML "LOADING…" text shows, then black. The game is running behind
    it: music plays, controls work.
  - `launch.log` showed the Gamescope WSI Vulkan layer creating a surface
    and swapchain for the window, then `Destroying swapchain`, then nothing.
  - With `DISABLE_GAMESCOPE_WSI=1 %command%` the `[Gamescope WSI]` lines
    disappeared and it was **still black**, so that layer is not the cause.
- **Reproduced in Desktop Mode:** `./ghost-man --ozone-platform=x11` gives the
  same black screen. `./ghost-man --ozone-platform=x11 --disable-gpu-compositing`
  shows the game.
- **Cause (inferred from the above).** With the `Vulkan` feature on,
  Chromium presents GPU-composited frames through a Vulkan swapchain when
  running on X11, and on the Deck nothing reaches the screen. On Wayland it
  doesn't take that path; it logs `'--ozone-platform=wayland' is not
  compatible with Vulkan`. That is why Desktop Mode always worked and Gaming
  Mode, which is X11 only, never did.
- **Fix.** The launcher adds `--disable-gpu-compositing` when Steam starts
  the game without Wayland. WebGL stays on the GPU; the compositor reads the
  canvas back each frame (`GPU stall due to ReadPixels` in `launch.log`)
  and presents it as a plain X11 image.
- **Cost.** One 1216×760 readback per frame. The owner reports performance
  on the Deck as great. Deck FPS numbers were not captured; they are in
  `ghost-man.log` (`[ghost-man] fps`) if you need them.
- **ANGLE's backend is per GPU process,** so there is no "WebGL on Vulkan,
  compositor on OpenGL" option. The alternatives are software compositing
  (what we ship) or OpenGL everywhere once finding 2 is root-caused.

### 5. Band across the bottom of the maze with the CRT on (fixed in v0.1.4)

- **Observed in Gaming Mode:**
  - the CRT was off at start;
  - turning it on showed a background-coloured band across the bottom of
    the maze (not the HUD).
- **Cause, reproduced on the Mac.** `src/main.ts` had a one-way adaptive
  downgrade: under 45 fps at start, it set render resolution to 0.75 and
  turned the CRT off. The Deck tripped it while software compositing warmed
  up. At a render resolution below 1, the bloom on `world`, nested under
  the CRT on `app.stage`, loses its bottom rows. `game.layout()` does not
  fix it.
- **Fix.** The downgrade is gone, and `resolutionFor()` floors at 1, which
  also covers a browser zoomed out below 1× on the web. See AGENTS.md
  invariant 5.

### 6. Steam launch options: arguments after `%command%` never reach the game

- **Observed.** Launch options `%command% --use-angle=gl` and `%command%
  --disable-gpu-compositing` made the game "crash instantly" in Gaming Mode,
  and `launch.log` was **not rewritten**, so the launcher never ran.
  `DISABLE_GAMESCOPE_WSI=1 %command%` (variables before `%command%`) did run
  it.
- **Why:** unknown. The shortcut targets the launcher script; that is all
  we know.
- **Workaround.** The launcher reads extra flags from `GHOST_MAN_FLAGS`, so
  test with `GHOST_MAN_FLAGS="--use-angle=gl" %command%`. From Konsole, pass
  flags directly: `./ghost-man --flag`.

### 7. Switches that `main.js` can't set

`app.commandLine.appendSwitch('ozone-platform', 'x11')` in `main.js` had no
effect: the Desktop Mode log still showed Chromium on Wayland. The display
platform is chosen before `main.js` runs, so we removed that switch.
Platform switches belong on the real command line (launcher,
`GHOST_MAN_FLAGS`). `--use-angle` and `--enable-features` from `main.js` *do*
take effect, because the GPU process starts later and inherits them.

Also: the platform name is lowercase. `--ozone-platform=X11` dies at once
with `Trace/breakpoint trap (core dumped)` (a Chromium CHECK), which looks
like a crash of ours.

### 8. The controller in Desktop Mode

Started from Konsole, the game gets no gamepad. Steam's desktop layout turns
the Deck's controls into keyboard and mouse:

- the D-pad arrives as arrow keys, so movement works;
- the face buttons become keys the game doesn't use in play;
- **R2 is a left mouse click**, which cost the window its focus. The game
  releases all keys on `blur`, so the controls seemed to stop.

Started by Steam (Gaming Mode, or the library in Desktop Mode), Steam Input
exposes a virtual Xbox pad, and every binding in `src/input.ts` works
(owner-verified in Gaming Mode). To test the controller without a Deck,
override `navigator.getGamepads` over CDP (see AGENTS.md).

### 9. Packaging

- An AppImage is awkward on the Deck. We ship a `.tar.xz` of
  electron-builder's unpacked `dir` target, which CI repacks as a fixed
  `Ghost-Man/` folder: extracting an update over it keeps the Steam shortcut
  valid.
- xz −9 is about 106 MB against about 136 MB for `.tar.gz`.
- `--transform` in `release.yml` is GNU tar (Ubuntu runner). macOS bsdtar
  spells it `-s`.
- The launcher ships via `extraFiles`. The binary is renamed with
  `executableName: ghost-man-bin` so the script can take the name
  `ghost-man`, which is what the README tells players to add to Steam.

## Playbook for the next Deck bug

1. **Get logs first.** Ask for `launch.log` and `ghost-man.log`, plus
   `tail -40 chromium.log` or a `grep -iE "error|vulkan|swapchain|gpu"`,
   read **before** relaunching. Check the timestamps and the `exec` line.
2. **Try to reproduce Gaming Mode from Konsole in Desktop Mode.** Konsole
   gives immediate output and no restart when it hangs.
   - `--ozone-platform=x11` gets you gamescope's X11 conditions on KDE.
   - `SteamGameId=1 ./ghost-man` makes the launcher take its Steam branch.
3. **Pass one change at a time,** through `./ghost-man --flag` in Konsole or
   `GHOST_MAN_FLAGS="--flag" %command%` in Steam.
4. **Confirm the renderer** (`renderer up: webgl`) before trusting a
   rendering result.
5. **If Gaming Mode wedges,** the way out is the power button → Restart.
   Returning to Desktop Mode can take a while as Steam waits for the process.

## Open questions

- The ANGLE-on-OpenGL triangle (finding 2): which pass, and why only on the
  Deck.
- Which of `--no-sandbox`, clearing `LD_PRELOAD` and clearing
  `LD_LIBRARY_PATH` actually cured the Gaming Mode hang (finding 1).
- Why arguments after `%command%` don't reach the launcher (finding 6).
- Deck frame rate with software compositing, measured rather than reported.

## Reference: the Deck in these sessions

- Steam Deck **LCD**. GPU vendor `0x1002` (AMD), device `0x163f` (5695): the
  Van Gogh ("Aerith") APU. The OLED model's APU ("Sephiroth") is a die
  shrink of the same design and has not been tested.
- Electron 44.4.5. Chromium reports `hardwareSupportsVulkan: false` in the
  early GPU info even when Vulkan works; ignore it.
- Gaming Mode also sets `vk_xwayland_wait_ready` (Mesa prints `ATTENTION:
  default value of option vk_xwayland_wait_ready overridden by environment`)
  and points Fossilize at Steam's shader cache. Neither caused a problem.
