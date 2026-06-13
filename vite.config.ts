import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  root: 'src/app',
  envDir: '../..',
  clearScreen: false,
  build: {
    outDir: '../../dist/app',
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  server: {
    port: 5314,
    strictPort: true,
    // Tauri expects a fixed host for the dev server
    host: '127.0.0.1',
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 5314,
    },
    watch: {
      // Watch for changes in linked packages too
      ignored: ['!**/node_modules/@mercenary/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    alias: {
      '@app': '/src/app',
    },
  },
});
