// Sandboxed preload (hence CommonJS): the page's only way to reach the shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostDesktop', {
  quit: () => ipcRenderer.send('quit'),
});
