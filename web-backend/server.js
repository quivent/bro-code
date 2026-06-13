#!/usr/bin/env node
/**
 * Minimal companion backend for running the bro-code (or gemma-code) Vite frontend
 * as a web app co-located with the Gemma inference server.
 *
 * This implements the Tauri-style `invoke` API over HTTP so the web frontend
 * gets real filesystem + shell access on the *server* machine.
 *
 * Usage (on the Gemma host):
 *   cd /path/to/bro-code
 *   npm install express   # or add to package.json
 *   node web-backend/server.js
 *
 * Then in the web app (Settings or env), point it at this server if you extend
 * the web invoke to use fetch instead of the pure localStorage version.
 *
 * Security warning: run_shell is powerful. Use on a trusted LAN only, or add
 * authentication + strict command allow-listing before exposing.
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve the built Vite app (after `npm run build`)
const distPath = path.join(__dirname, '..', 'dist', 'app');
app.use(express.static(distPath));

// Simple home dir resolution (matches config.homeDir style)
function resolveHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', p.slice(2));
  }
  return p;
}

// The core invoke dispatcher — mirrors what Tauri does
async function handleInvoke(cmd, args = {}) {
  try {
    switch (cmd) {
      case 'read_file': {
        const p = resolveHome(args.path);
        const content = await fs.readFile(p, 'utf8');
        return content;
      }

      case 'write_file': {
        const p = resolveHome(args.path);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, args.content || '', 'utf8');
        return;
      }

      case 'run_shell': {
        const cmdStr = args.cmd || '';
        console.log('[web-backend] run_shell:', cmdStr);

        // Basic safety: you can expand this allow-list
        const safePrefixes = ['gemma', 'ls', 'cat', 'echo', 'find', 'mkdir', 'node'];
        const isSafe = safePrefixes.some(pref => cmdStr.trim().startsWith(pref));
        if (!isSafe) {
          return `(web-backend) Command blocked for safety: ${cmdStr}`;
        }

        const { stdout, stderr } = await execAsync(cmdStr, {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        return (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '');
      }

      case 'get_setting': {
        // For a real implementation, persist to a JSON file or DB.
        // Here we just return null (or you can implement simple file-based store).
        const key = args.key;
        // Example: read from a settings file
        const settingsPath = resolveHome('~/bro/web-settings.json');
        try {
          const raw = await fs.readFile(settingsPath, 'utf8');
          const settings = JSON.parse(raw);
          return settings[key] ?? null;
        } catch {
          return null;
        }
      }

      case 'set_setting': {
        const key = args.key;
        const value = args.value;
        const settingsPath = resolveHome('~/bro/web-settings.json');
        let settings = {};
        try {
          const raw = await fs.readFile(settingsPath, 'utf8');
          settings = JSON.parse(raw);
        } catch {}
        settings[key] = value;
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        return;
      }

      default:
        console.warn('[web-backend] Unknown invoke cmd:', cmd);
        return null;
    }
  } catch (err) {
    console.error('[web-backend] invoke error', cmd, err);
    return `(web-backend error) ${err.message}`;
  }
}

// Main endpoint the web frontend can call
app.post('/api/invoke', async (req, res) => {
  const { cmd, args } = req.body || {};
  const result = await handleInvoke(cmd, args);
  res.json(result);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: 'web-backend', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-backend] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[web-backend] Serving static from: ${distPath}`);
  console.log(`[web-backend] POST /api/invoke for Tauri-style commands`);
  console.log(`[web-backend] Example: curl -X POST http://localhost:${PORT}/api/invoke -H "Content-Type: application/json" -d '{"cmd":"get_setting","args":{"key":"activeEndpointId"}}'`);
});

// Optional: also support direct GET for simple health from browser
console.log('Web backend ready. Point your web-mode frontend at this host if you extend the invoke layer.');
