import { defineConfig } from 'vite';

export default defineConfig(() => ({
  // Relative asset URLs, so the same build works wherever it is hosted:
  // GitHub Pages (www.vitormach.dev/ghost-man/), any other sub-path, or a
  // desktop wrapper.
  base: './',
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
