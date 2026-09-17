import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-threaded WASM inference needs SharedArrayBuffer, which browsers only
// allow on cross-origin isolated pages. vercel.json sets the same headers in production.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  // Keep Vite's dependency cache out of the project folder: sync clients (Dropbox, OneDrive) and
  // antivirus lock files there on Windows, which breaks Vite's cache rebuilds with EBUSY errors.
  cacheDir: join(tmpdir(), 'imago-vite-cache'),
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand'],
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench/index.html', import.meta.url)),
      },
    },
  },
});
