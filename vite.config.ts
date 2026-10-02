import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works under a GitHub Pages subpath.
  base: './',
  worker: { format: 'es' },
});
