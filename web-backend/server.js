#!/usr/bin/env node
/**
 * Companion backend for the bro-code Vite frontend in pure web / remote mode.
 *
 * Provides the Tauri-style `invoke` surface (read_file, write_file, run_shell,
 * get/set_setting) over HTTP so the browser frontend can have real server-side
 * FS and (guarded) shell execution when co-located with the Gemma inference server.
 *
 * Current recommended usage (dev mode with domain + SSL):
 *   npm run web:backend
 *   # (or) WEB_DEV=1 npm run dev   +   node web-backend/server.js
 *
 * Caddy (or nginx) fronts https://bro.gemma.training:
 *   - /api/*   -> this backend (port 3456)
 *   - everything else -> Vite dev server (port 5173, with HMR over wss)
 *
 * Later: update createWebInvoke() in src/app/modular/lib/config.ts to
 * optionally fetch(`${webBackendUrl}/api/invoke`, {method:'POST', body: JSON...})
 * when a web backend is configured (instead of pure localStorage).
 *
 * Security / Auth:
 * - POST /api/login {username, password} -> {token, user} (users from ~/bro/users.json with bcrypt hashes)
 * - All /api/invoke calls require Authorization: Bearer <token>
 * - See /api/me for current user.
 * - This fits the simple/direct/JSON-file style of the rest of the backend (no DB, no sessions).
 * - Strongly recommended before any public/Caddy exposure. Per-user scoping (different homes) can be added in resolveHome.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-bro-secret-in-production';
const USERS_PATH = () => resolveHome('~/bro/users.json');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Simple CORS for dev / same-LAN browser access (tighten for production).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Public login for user-based auth (fits the simple JSON + direct style of the rest of the backend).
// POST { username, password } -> { token, user }
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash || '')) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = jwt.sign(
    { sub: username, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  console.log(`[web-backend] login success for ${username}`);
  res.json({ token, user: username });
});

// Optional: serve the built static app (only when SERVE_STATIC=1 and dist exists).
// In the normal "dev mode + Caddy" flow we let Vite handle the frontend (with HMR)
// and this process is *just* the /api backend.
const serveStatic = process.env.SERVE_STATIC === '1' || process.env.SERVE_STATIC === 'true';
if (serveStatic) {
  const distPath = path.join(__dirname, '..', 'dist', 'app');
  // Only mount if the dir actually exists (avoid noisy errors in pure dev).
  try {
    await fs.access(distPath);
    app.use(express.static(distPath));
    console.log('[web-backend] Serving static from', distPath);
  } catch {
    console.log('[web-backend] SERVE_STATIC requested but no dist/app found (ok for dev)');
  }
}

// User-based auth middleware (recommended for public exposure).
// Expects Authorization: Bearer <jwt-from-/api/login>
// Protects /api/invoke (and optionally others). Health stays public for probes.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization: Bearer <token> required' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload.sub || 'unknown';
    console.log(`[web-backend] authenticated as ${req.user}`);
    next();
  } catch (e) {
    console.warn('[web-backend] auth failed:', e.message);
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

// Simple home dir resolution (matches config.homeDir style)
// Now user-aware for per-user isolation (e.g. ~/bro -> ~/.bro-users/<user>/bro )
function resolveHome(p, user = null) {
  if (!p) return p;
  if (p.startsWith('~/')) {
    let base = process.env.HOME || process.env.USERPROFILE || '/tmp';
    if (user) {
      base = path.join(base, '.bro-users', user);
    }
    return path.join(base, p.slice(2));
  }
  return p;
}

function getUsersPath() {
  return resolveHome('~/bro/users.json');
}

async function loadUsers() {
  try {
    const raw = await fs.readFile(getUsersPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  const p = getUsersPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(users, null, 2), 'utf8');
}

// The core invoke dispatcher — mirrors what Tauri does
async function handleInvoke(cmd, args = {}, user = null) {
  try {
    switch (cmd) {
      case 'read_file': {
        const p = resolveHome(args.path, user);
        const content = await fs.readFile(p, 'utf8');
        return content;
      }

      case 'write_file': {
        const p = resolveHome(args.path, user);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, args.content || '', 'utf8');
        return;
      }

      case 'run_shell': {
        const cmdStr = args.cmd || '';
        console.log(`[web-backend][user:${user || 'anon'}] run_shell:`, cmdStr);

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
        // Example: read from a settings file (now per-user if authed)
        const settingsPath = resolveHome('~/bro/web-settings.json', user);
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
        const settingsPath = resolveHome('~/bro/web-settings.json', user);
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

// Main endpoint the web frontend can call (protected)
app.post('/api/invoke', requireAuth, async (req, res) => {
  const { cmd, args } = req.body || {};
  const result = await handleInvoke(cmd, args, req.user);
  res.json(result);
});

// Simple whoami (for frontend to confirm valid session / user)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Health check (left public for easy probes / liveness)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: 'web-backend', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[web-backend] Listening on http://0.0.0.0:${PORT}`);
  if (serveStatic) {
    const distPath = path.join(__dirname, '..', 'dist', 'app');
    console.log(`[web-backend] (static mode) would serve from: ${distPath}`);
  } else {
    console.log(`[web-backend] API-only mode (Caddy routes /api/* here; Vite dev handles the UI)`);
  }
  console.log(`[web-backend] POST /api/invoke for Tauri-style commands (requires auth)`);
  console.log(`[web-backend] Login first: curl -X POST http://localhost:${PORT}/api/login -H "Content-Type: application/json" -d '{"username":"bro","password":"secret"}'`);
  console.log(`[web-backend] Example authed: curl -X POST http://localhost:${PORT}/api/invoke -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"cmd":"get_setting","args":{"key":"activeEndpointId"}}'`);
});

console.log('[web-backend] Ready. For full web dev: use Caddy in front of Vite (5173) + this API (3456).');
console.log('[web-backend] Auth: create ~/bro/users.json e.g. [{"username":"bro","passwordHash": bcrypt hash}] then POST /api/login to get token.');
console.log('[web-backend] To hash a password (one-off): node -e \'import("bcryptjs").then(b=>console.log(b.hashSync("yourpass",10)))\'');
