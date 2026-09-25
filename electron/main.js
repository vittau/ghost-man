// Desktop shell (Steam Deck / Linux, Windows, macOS). Serves the Vite build
// from dist/ over a privileged custom scheme rather than file://, so fetch,
// media streaming and localStorage behave exactly as they do on the web.
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://ghost-man`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// A game launched from a library is already the player's gesture: start the
// music at boot instead of asking for a key press (see autoplayAllowed()).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Steam Deck's Gaming Mode (gamescope) hosts games on XWayland. Pin X11 so a
// stray WAYLAND_DISPLAY doesn't send Chromium to a compositor it can't use;
// `--ozone-platform=wayland` on the command line still overrides this.
if (process.platform === 'linux' && !app.commandLine.hasSwitch('ozone-platform')) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

// One game at a time: a second launch focuses the running window.
if (!app.requestSingleInstanceLock()) app.quit();

function serveDist() {
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname);
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    // Forward the headers so <audio> Range requests reach the file loader.
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    fullscreen: true,
    show: false,
    title: 'Ghost-Man',
    backgroundColor: '#0a0318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The game loop must keep running at full rate even when unfocused.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // F11 / Alt+Enter toggle fullscreen (F alone is the in-game FPS toggle).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // Never navigate away from the game; external links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });

  void win.loadURL(`${ORIGIN}/`);
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());

// QUIT GAME on the pause screen (src/desktop.ts).
ipcMain.on('quit', (event) => {
  if (event.senderFrame?.url.startsWith(ORIGIN)) app.quit();
});

app.whenReady().then(() => {
  // macOS keeps the default menu for Cmd+Q / Cmd+Ctrl+F; elsewhere it would
  // only show up as a stray bar.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  serveDist();
  createWindow();
});
