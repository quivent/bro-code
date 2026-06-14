<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.05; margin: 0 0 10px 0; padding: 12px 14px; background: #0d1117; color: #d4d4d8; border-radius: 6px; display: inline-block; border: 1px solid #242a33; white-space: pre;">
<span style="color:rgb(63,182,178)">██████  ██████   ██████ </span><br>
<span style="color:rgb(113,148,212)">██   ██ ██   ██ ██    ██</span><br>
<span style="color:rgb(163,113,247)">██████  ██████  ██    ██</span><br>
<span style="color:rgb(202,124,154)">██   ██ ██   ██ ██    ██</span><br>
<span style="color:rgb(240,136,62)">██████  ██   ██  ██████ </span>
</pre>

```ansi
[38;2;63;182;178m██████  ██████   ██████ [0m
[38;2;113;148;212m██   ██ ██   ██ ██    ██[0m
[38;2;163;113;247m██████  ██████  ██    ██[0m
[38;2;202;124;154m██   ██ ██   ██ ██    ██[0m
[38;2;240;136;62m██████  ██   ██  ██████ [0m
```

**bro** — local model · type to begin

A beautiful, modular, self-forging LLM desktop (and web) companion. Chat with your local models, forge tools on the fly with `!sh`, keep rich memory + prompt + context, run in solo/dual/vs/supervision modes, and deploy the pure Vite frontend anywhere.

> Built with Svelte 5, Tauri, and a whole lot of love for local AI. The signature gradient runs teal (#3fb6b2) → purple (#a371f7) → orange (#f0883e) across the ASCII logo above (HTML logo above always shows it; ANSI block below for `cat README.md` in truecolor terminals). Dark theme as deep as the night.

## Palette & Vibe

- **Backgrounds**: `#0d1117` (primary), `#161b22`, `#1c2128`, `#242a33` (elevated)
- **Text**: `#d4d4d8` (main), `#a1a1aa` (secondary), `#555568` (muted/dim)
- **Accents** (the signature gradient): `#3fb6b2` (teal) → `#a371f7` (purple) → `#f0883e` (orange)
- **Other**: lavender `#a78bfa`, hotpink `#f472b6`, green `#34d399`, warn `#fbbf24`, red `#f87171`

Everything feels hand-crafted, terminal-adjacent, yet warm and alive. ASCII logos. Monospace for the serious bits. Soft lavender glows on active states.

## Features

- **Chat that actually works** — streaming, thinking blocks (for models that emit `<think>`), markdown with syntax highlighting, copy, stats (tokens, time, tok/s)
- **Self-forging tools** — `!sh` commands with human-in-the-loop approval, "always this session", feedback. Agent can call tools, you decide.
- **Memory & Prompt** — editable cells + full prompt.md. Auto-reload, tags, search.
- **Context** — mark files/dirs to feed into every prompt. Recursive. Shown context preview. "Feed" button to pull fresh disk content.
- **Multi-mind modes** (under the chat bar):
  - **Solo** — classic
  - **Dual** — two agents side-by-side (different endpoints/models)
  - **VS (crosstalk)** — they talk to each other
  - **Supervision** — one agent does the work, a supervisor watches and comments
- **Transcripts** — auto-saved with nice English titles. Load, browse, continue.
- **Terminal tab** — real shell (when running as desktop or with the companion backend)
- **KV, Source, etc.** — power tools for debugging and introspection
- **Pure web mode** — run `npm run web:dev`, serve via Caddy/Nginx on your inference box. Browser localStorage + optional companion backend (`web-backend/server.js`) for real FS + guarded shell. No Tauri rebuilds needed.
- **Endpoints on the fly** — full Settings UI. Add/edit/reorder/test endpoints (local or remote OpenAI-compatible). Auto-discovers model ID from `/v1/models`. Per-user auth support in the web backend.

## Quick Start (Desktop)

```bash
git clone https://github.com/quivent/bro-code
cd bro-code
npm install
npm run tauri:dev
```

Or build:

```bash
npm run tauri:build
```

Edit `src/app/config.ts` (or just use the Settings tab at runtime) to point at your model server.

## Web Mode (the whole point of the last few months)

Run the frontend visible on your network (or behind Caddy at `bro.gemma.training`):

```bash
npm run web:dev          # or WEB_DEV=1 npm run dev -- --host 0.0.0.0 -p 5173
```

Serve the companion backend (gives real `read_file`/`write_file`/`run_shell` + settings on the server machine):

```bash
node web-backend/server.js
# or npm run web:backend
```

Point Caddy (or whatever) at it. See `WEB_MODE_PICKUP.md` and the comments in `web-backend/server.js` for the exact Caddyfile + deployment notes.

In the app (Settings → Endpoints) point at your inference server, e.g.:

```
https://oracle.gemma.training/v1/chat/completions
```

or the local one on the same box.

The web backend now supports proper user-based auth (JWT + `~/bro/users.json`). See the header of `web-backend/server.js` for the one-liner to create users.

## Architecture (beautifully over-engineered in the best way)

- Monolithic host (`App.svelte`) still drives the main chat loop + a bunch of legacy tabs for speed of iteration.
- Heavy modular extraction under `src/app/modular/` (lib/, components/chat/, panes/, tabs/) so the good parts can be dropped into gemma-code, qwen-code, etc.
- `bro-shared` package for the bits that truly deserve to be shared (DualPanes, state machines, etc.).
- Web mode is a first-class citizen: `createWebInvoke()` gives you localStorage + virtual FS today; wiring to the real Express companion is one small fetch away.
- Everything that touches the model goes through a clean `createAgentCore` that knows about memory, prompt, context, SCP/exec awareness, and the current endpoint list.

## The Style

Dark. Monospace where it counts. Gradient text on the logo (the HTML logo at the top always renders the teal → purple → orange gradient for everyone; the ```ansi block carries real ESC truecolor codes for `cat` in supported terminals). Soft lavender glows. Buttons that feel like they were drawn by someone who still loves terminals. Context that slides. Tools that ask permission like a polite but slightly unhinged friend.

If it feels good to look at while you're coaxing a 30B model into writing better code than you, we did it right.

## Status & Roadmap (very honest)

Working today:
- Full chat + streaming + exec approval + multi-mode panes
- Memory, prompt, transcripts, context feeding
- Dynamic endpoints + auto model discovery
- Web mode + companion backend with auth + per-user homes
- Mobile-responsive (we've been living in the mobile CSS for weeks)

Still rough / developer-only:
- Some of the deeper dual/vs/supervision wiring lives in the modular composer but isn't 100% wired into the main monolithic yet
- The "suggestive prompts" area below the input is still mostly the feed buttons (room for AI-suggested next turns)
- KV tab, full terminal, source view are powerful but very internal

We ship what feels alive first.

## Contributing / Hacking

The codebase is deliberately a little messy in the host because we value speed of exploration over purity. The modular bits are the future.

- `npm run dev` (or `WEB_DEV=1 npm run dev -- --host 0.0.0.0 -p 5173` for web mode)
- `npm run web:backend` for the FS/shell companion
- Edit `src/app/config.ts` or just live in the Settings tab
- The real magic lives in `modular/lib/agent.ts`, `context.ts`, `scp.ts`, and the chat components.

If you want to port the good parts to your own model, start in `packages/shared` and `modular/`.

## License

MIT (or whatever the original gemma-code license was — we're standing on the shoulders of some very good giants).

---

Made with too much coffee and the belief that local models deserve a UI that doesn't feel like an afterthought.

Type to begin.
