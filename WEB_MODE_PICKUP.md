# Web Mode / Remote Server Frontend Pickup Instructions

This document is for anyone picking up the work on running the Vite + Svelte frontend as a standalone web app, ideally co-located on the same server/machine as the Gemma (or other) inference server.

## Background & Goal
- The desktop Tauri app works great locally.
- Recent changes (June 2026) decouple the "Vite portion" so you can run `npm run dev` or a production build (`npm run build`) directly on the remote server where the model is served.
- Benefits: fast iteration on UI without Tauri rebuilds, browser access from anywhere on the LAN, low-latency direct HTTP to the model server (same host), easy testing of the full frontend experience.

Core chat, settings, memory, prompt, transcripts, and basic context now work fully in pure browser/web mode using a rich `createWebInvoke()` fallback (localStorage + virtual FS).

## Quick Start on the Server (the "other side")
1. Get the code onto the target machine (the one already running the Gemma inference server, e.g. on port 8091):
   - rsync, scp, git clone, or tarball the bro-code (and/or gemma-code) directory.
   - Example: `rsync -avz --exclude node_modules /local/path/to/bro-code user@server:/opt/`

2. On the server:
   ```bash
   cd /path/to/bro-code
   npm install   # or pnpm / bun if you prefer
   ```

3. Run the web frontend:
   - For rapid development (HMR etc.):
     ```bash
     npm run dev -- --host 0.0.0.0 -p 5173
     ```
   - For "production" web app (static files):
     ```bash
     npm run build
     npx serve dist -p 8080   # or use nginx, caddy, etc.
     ```

4. Access from browser (any machine on the network):
   - `http://<server-ip-or-hostname>:5173` (dev) or `:8080` (built)

5. Configure in the app (Settings tab):
   - Use the **Test** button.
   - Ensure the active endpoint points to the local inference server on *that machine*, e.g.:
     - `http://127.0.0.1:8091/v1/chat/completions`
     - Or whatever URL you already use inside the desktop app for the same server.
   - All other settings (temperature, max tokens, maxHistoryTurns, maxToolHistory, appearance, etc.) persist across reloads via browser storage.

6. What works out of the box in web mode:
   - Full chat (solo + the modes you have wired: dual/vs/supervision).
   - Memory editing + persistence.
   - Prompt editing + persistence.
   - Context tab (manual paths and "show on chat" / feed work via virtual storage; dir listings are simulated).
   - Transcripts (auto-save on sends, list/view/load into chat).
   - Settings (endpoints list, health test, all the agent prefs).
   - Exec approval UI (the "Say something back", always-this-session, rejected cmds guard, etc.) — the actual shell execution is mocked for safety.

## Current Limitations (web mode only)
- `run_shell` / real `!sh` tool execution is demo-only (returns a message + console warning). The UI flow is fully exercised for testing.
- Real directory scanning for context uses a demo response (the code that does `run_shell + find`).
- No native filesystem drag-drop (the Tauri plugin is guarded; use the manual "Add path" controls).
- Paths like `~/bro` are virtualized into browser localStorage (per-origin). This is actually convenient for isolated testing sessions.
- No Tauri-specific native dialogs/plugins.

Desktop Tauri experience is 100% unchanged and still uses the real native invoke.

## Where the Code Changes Live (entry points)
- `src/app/modular/lib/config.ts` → `createWebInvoke()` (the heart — localStorage + virtual FS implementation + comments with pickup notes).
- `src/app/App.svelte` → `invoke()` wrapper + `isTauri` detection + console banner + web mode guidance.
- `src/app/modular/lib/settings-store.svelte.ts` → settings persistence fallback.
- Same files mirrored in the gemma-code tree (keep in sync for "both ways").
- Modular README.md and this file contain the full instructions.

Also see the big "Web / Remote Server Frontend Mode" section that was added to `src/app/modular/README.md`.

## Next Steps / Where to Continue (Recommended Pickup Work)
1. **Add a small companion backend** (highest value for full parity):
   - Create `web-backend/server.js` (or `server/index.js`).
   - Use Express (or Fastify/Bun if preferred).
   - POST `/api/invoke` that accepts `{ cmd, args }` and dispatches to real implementations:
     - `read_file` / `write_file` → Node `fs`
     - `run_shell` → `child_process.exec` (add allowlist/safety for production use — e.g. only certain commands or prefix with `gemma` binary checks)
     - `get_setting` / `set_setting` → simple JSON file or SQLite in `~/bro/settings.json` or similar.
   - Serve the static Vite `dist/` from the same server for convenience.
   - In web mode, have the frontend `fetch` this endpoint when a `webBackendUrl` (env var or setting) is configured.
   - Example skeleton is provided in `web-backend/server.js` (created alongside this doc).
   - This gives real tools + server-side FS/transcripts/memory that are shared across browsers/users on the LAN.

2. **UI polish for web mode**:
   - Add a visible non-intrusive banner/pill in the header (e.g. in `App.svelte` monolithic header or the modular `AppHeader.svelte`) when `!isTauri`: "🌐 Web mode • browser storage • tools simulated".
   - Enhance ContextTab to support browser `<input type="file" webkitdirectory>` for uploading real files into the virtual FS when in web mode.
   - Make the web invoke also support an optional `webShellEndpoint` for the backend above.

3. **Testing & parity**:
   - Test full flows on the remote: long context + sliding prune, exec approval with feedback, dual/vs/supervision panes (if enabled), transcripts load/save, memory cells, etc.
   - Verify against both bro-code and gemma-code frontends.
   - Consider adding a `VITE_WEB_MODE=true` or auto-detection via env.

4. **Deployment notes**:
   - For production web: `npm run build`, then serve `dist/` + the backend on the same port or via reverse proxy.
   - CORS: If the backend and frontend are on the same origin (recommended), no issue. Inference endpoint must be reachable (usually same-host localhost or internal IP).
   - Persistence on server: Once the backend is in place, transcripts/memory/context live on the actual `~/bro` (or configured home) on disk.
   - Security: Be careful exposing `run_shell` on a public server — use auth, allowlists, or run in a container with limited privileges.

## How to Verify Web Mode Locally First
```bash
npm run dev
# Open http://localhost:5173
# Check console for the web mode log
# Settings should persist on reload (localStorage)
# Try memory/prompt/context/transcripts
```

Then move to the remote server as described above.

This work was done to directly address "build out the Vite portion into a web app and test it from there" while co-locating with the Gemma server.

If you (or the other side) have questions, start by reading this file + the README section + the `createWebInvoke` implementation.

Happy shipping! 🚀
