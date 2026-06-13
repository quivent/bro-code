import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      // Silence a11y warnings during active development/port cleanup (original patterns used many clickable divs).
      // Real a11y can be addressed later; comments in .svelte files still present for IDEs.
      onwarn(warning, handler) {
        if (warning.code && (warning.code.startsWith('a11y_') || warning.code === 'export_let_unused')) return;
        handler(warning);
      }
    }),
    {
      name: 'browser-console-relay',
      configureServer(server) {
        // Dev-only endpoint for the relay script injected in index.html.
        // Any console.error/warn or window errors from the Svelte app are POSTed here
        // and printed to the terminal with [browser:...] prefix (per AGENTS.md rules).
        server.middlewares.use('/__log', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}');
              const prefix = `[browser:${data.lvl || 'log'}]`;
              console.log(prefix, data.msg || '');
            } catch (e) {
              console.log('[browser:log]', body);
            }
            res.statusCode = 204;
            res.end();
          });
        });
      }
    }
  ],
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
  // Do not pre-bundle/analyze Tauri API packages in Vite dev. They are provided by the Tauri
  // webview runtime (or resolved from node_modules for static imports). Prevents occasional
  // dynamic import resolution noise for @tauri-apps/* specifiers during HMR/dev.
  optimizeDeps: {
    exclude: ['@tauri-apps/api', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-shell', '@tauri-apps/api/webview']
  },
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
