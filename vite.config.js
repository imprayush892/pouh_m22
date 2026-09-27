import { defineConfig } from 'vite';

// base './' so the built app works from any folder (GitHub Pages, file
// share, or `npx vite preview` on a phone over LAN).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
