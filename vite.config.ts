import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Local dev serves at http://localhost:5173/ for convenience; only the
  // production build uses the /gorgeous-ghost-man/ base for vitormach.dev.
  base: command === 'build' ? '/gorgeous-ghost-man/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    host: true,
    open: true,
  },
  preview: {
    port: 4173,
  },
}));
