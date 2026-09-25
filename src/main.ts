import { Application } from 'pixi.js';
import './style.css';
import { PALETTE, SCREEN_H, SCREEN_W, setViewportWidth } from './config';
import { Input } from './input';
import { Game } from './game';

/** Keep the total pixel count sane so bloom + CRT stay affordable. */
const MAX_PIXELS = 3_200_000;

function resolutionFor(w: number, h: number): number {
  const dpr = window.devicePixelRatio || 1;
  const budget = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  return Math.max(0.7, Math.min(2, dpr, budget));
}

/**
 * The canvas height is fixed and the width follows the window aspect, so the
 * logical canvas maps 1:1 onto the window: no letterbox and no stretching.
 */
function widthForWindow(): number {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return Math.round(SCREEN_H * aspect);
}

async function boot(): Promise<void> {
  try {
    await document.fonts.load('16px "Press Start 2P"');
    await document.fonts.ready;
  } catch {
    /* fall back to monospace */
  }

  setViewportWidth(widthForWindow());

  const app = new Application();
  await app.init({
    width: SCREEN_W,
    height: SCREEN_H,
    background: PALETTE.bg,
    antialias: true,
    resolution: resolutionFor(SCREEN_W, SCREEN_H),
    autoDensity: false,
    preference: 'webgl',
    // Lets backdrop filters read what's already drawn (the title screen's
    // frosted header and panel).
    useBackBuffer: true,
    powerPreference: 'high-performance',
  });
  app.ticker.maxFPS = 60;

  document.getElementById('loading')?.remove();
  const mount = document.getElementById('app') ?? document.body;
  mount.appendChild(app.canvas);

  const input = new Input();
  const game = new Game(app);
  let downgraded = false;
  let accMs = 0;
  let frames = 0;

  const fit = (): void => {
    setViewportWidth(widthForWindow());
    app.renderer.resolution = resolutionFor(SCREEN_W, SCREEN_H);
    app.renderer.resize(SCREEN_W, SCREEN_H);
    game.layout();
  };
  window.addEventListener('resize', fit);

  // Audio can only start from a user gesture.
  const unlock = (): void => {
    game.unlockAudio();
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);

  app.ticker.add((ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    game.update(dt, input);

    // One-way adaptive quality: drop render resolution and bloom detail rather
    // than stutter on weaker GPUs.
    if (!downgraded) {
      accMs += ticker.deltaMS;
      frames++;
      if (frames >= 150) {
        const avgFps = 1000 / (accMs / frames);
        if (avgFps < 45) {
          downgraded = true;
          app.renderer.resolution = Math.max(0.7, app.renderer.resolution * 0.75);
          app.renderer.resize(SCREEN_W, SCREEN_H);
          game.setLowQuality();
          game.layout();
        }
        accMs = 0;
        frames = 0;
      }
    }
  });

  // Handy for debugging from the console.
  (window as unknown as Record<string, unknown>).ghostman = { app, game, input };
}

boot().catch((err: unknown) => {
  console.error('[ghost-man] failed to start', err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'FAILED TO START — CHECK THE CONSOLE';
});
