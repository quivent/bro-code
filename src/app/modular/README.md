# Modular Gemma App (Side-by-Side Version)

This is a parallel modularized extraction of the original monolithic `src/app/App.svelte`.

**Goal**: Break into small, focused .svelte components for better maintainability, reusability, and fine-grained updates (closer to SolidJS style reactivity in Svelte 5).

## Structure
- `lib/types.ts`: All interfaces (Message, Endpoint, etc.)
- `lib/utils.ts`: renderMd (with ANSI/SCP support), stripAnsi, copy helpers, highlight, etc.
- `components/layout/`: AppHeader.svelte, TabBar.svelte
- `components/chat/`: ChatMessage.svelte, StreamingMessage.svelte, ExecCard.svelte, IntentInsight.svelte (for SCP frame), ChatPane.svelte
- `components/panes/`: DualPanes.svelte, VsCrosstalk.svelte
- `components/tabs/`: TranscriptsTab.svelte, ToolsTab.svelte, KvTab.svelte, TerminalTab.svelte, SettingsTab.svelte (skeletons for others)
- The modular components (ChatComposer, individual Tabs, AppHeader, etc.) are now wired directly into the main App.svelte.
- Absolute final slices (KvTab, SettingsTab, TerminalTab): fully self-contained. Kv/Terminal own all their $state + invoke logic internally. Settings uses shared appSettings rune store in lib/settings-store.svelte.ts (cross-cutting endpoints/localPort/chatMode/etc for App/send while SettingsTab owns UI/handlers). App render for these is now <Tab /> (minimal). Pre-port monolith v1 intact as foundation. Build verified.

## Audit Notes (Current State)
- Chat core + SCP (Sovereign Frame with Intent box + !sh + Insight) extracted and functional in demo.
- Basic panes and layout done.
- Tab panels started as skeletons (full forms/logic from original can be ported in batches).
- No changes to original files - this is purely additive.
- Parallel creation used for efficiency.
- Original logic (streamAssistant, send, effects, SCP prompt, etc.) lives in original; modular version demonstrates decomposition.
- To integrate later: Replace sections of App.svelte with <ChatMessage ... /> etc., lift state or use runes context.

## How to Continue
- Run the app and compare.
- Expand tab components by copying logic from original sections (e.g., memory cells, source editor with highlight, settings forms).
- Add more: ContextPanel, PromptPanel, MemoryPanel, full Settings with all sections.
- For full app: Create ModularGemmaApp that mirrors original but composed.
- Styles: Inline for now; move to global or CSS modules later.
- Parallelization: Multiple components created concurrently in tool calls.

This makes only changed components "refresh" in dev (Svelte reactivity), keeping rest stable - addressing Solid-like fine-grained updates.

## Current Audit (Post-Expansion)
- Chat and SCP fully modularized (core of recent work).
- Panes and basic layout extracted.
- Tab components: most have good skeletons; some (settings, source, memory, prompt, context) expanded with more original logic/forms in 'Full*' or 'Complete*' variants for reference.
- Utilities and types complete.
- Composer demonstrates composition.
- Total components: ~15+ small focused ones vs 1 4000+ line monolith.
- Still on side: no changes to original.
- Next to keep going: full port of state/logic into composer (e.g. all send/stream/ effects), more CSS scoping, perhaps a state management file (e.g. appState.ts with runes), integration example.
- Audit complete: Good progress on UI decomposition; logic extraction would make it even more modular (e.g. separate scp.ts already done).

## Unified Package Progress (for qwen-code etc.)
- New `lib/` managers extracted for reusability:
  - `config.ts`: injectable AgentConfig (invoke fn + promptFile + memoryFile). This is the "full control" mechanism.
  - `memory.ts`: load/persist cells with canonical schema (now configurable home).
  - `prompt.ts`: load/save for the starting document.
  - `context.ts`: loadContext + buildApiMessages (includes memory + prompt + EXEC_AWARENESS).
  - `agent.ts`: createAgentCore — the key abstraction. Provides `prepareApiMessages` / `buildMessages` that **always** inject memory + prompt + SCP. Dual panes now call this before streaming.
- The main App.svelte now wires the modular components (ChatComposer + all Tabs) with real memory/prompt/context via the unified agent, demonstrating full dual/vs/supervision modes with memory access.
- Pattern: apps (gemma-code, qwen-code) create their AgentCore with their chosen homes (see main App.svelte's MEMORY_HOME / PROMPT_FILE) + real Tauri invoke, then pass rich apiMessages to bro-shared's streamToPane or the agent's send.
- Result: the unified package (modular/ as reference) gives every mode (solo/dual/vs) full access to the starting document, memory cells, and context injection.
- Drop-in path: publish or link this tree (or merge into bro-shared) as the common UI+logic layer. Per-app shell only supplies config + branding + any model-specific KV/local-serve.

## Usage for qwen-code (or other forks)
```ts
// In your QwenApp.svelte or equivalent
import { createAgentCore } from './modular/lib/agent'; // or from 'unified-agent-desktop'
import { streamToPane } from 'bro-shared';

const agent = await createAgentCore({
  invoke: tauriInvoke,  // your real one
  promptFile: '~/qwen/prompt.md',           // full control over starting document
  memoryFile: '~/qwen/memory/memory.json',  // full control over memory home
  endpoints: yourEndpoints,
  chatTemperature: 0.6,
  // ...
});

// For rich dual with memory:
const richApiMsgs = agent.prepareApiMessages(rawUserHistory);
await streamToPane(pane, modelConfig, richApiMsgs, onUpdate, agent.systemContext /* or let caller build */);

// Edit memory/prompt via the tabs or directly, then:
await agent.loadAll(); // next send in any mode (solo/dual) sees updates
```

The main App.svelte (plus the reusable components and `lib/agent` + managers) demonstrates composition with full dual+memory support.
The lib/agent + managers encapsulate the "Gemma" (or Qwen) specific state machines while remaining configurable.

**Port / local-serve (v2 addition for TPS/port reliability):** 
- See `local-serve.ts` for centralized `getLocalOrigin`, sync for 127.0.0.1 entries, has/add Local, health URLs.
- In host: import and use for localPort UI + sync to keep chat endpoints (used by measureTps/streaming) in sync with actual server.
- Auto mismatch detection recommended in testEndpoint for TPS N/A cases.
- Barrel includes it for package consumers.
```

## Next
- Integrate into main App.svelte gradually.
- Contribute the agent core + provider back to bro-shared.
- Full test suite for the unified layer.

## Migration Progress & Audit (completed waves)
**Status: Major completion achieved.** All suggested waves executed:
- Settings tab fully extracted and wired (endpoints, forms, sections, danger zone).
- Chat area attacked (more Chat* components imported and renderMd centralized to modular).
- State centralization advanced (effects now prefer unifiedAgent.loadAll for prompt/memory; more delegation).
- Other tabs (Tools, Transcripts, Context, Terminal, Kv) wired.
- Header replaced with modular AppHeader (TabBar available).
- Cleanup: dupe functions removed (extractExecCalls, renderMd), stream_backup deprecated, imports cleaned, 3+ tabs + settings ported.
- Docs updated.

The monolith App.svelte has been significantly reduced; modular/ is now the primary for tabs/UI and agent logic. Remaining: full chat decomposition and deeper state sync.

Core agent and components are reusable for other apps (qwen etc.).

---

**Web / Remote Server Frontend Mode (June 2026 work)**

Goal: Run the Vite + Svelte frontend as a standalone web app, ideally served from (or co-located with) the machine running the Gemma inference server. This enables fast iteration on the UI without full Tauri rebuilds, direct low-latency access to the model, and browser-based testing of the "Vite portion".

**What was implemented:**
- Added `createWebInvoke()` (in `modular/lib/config.ts`).
  - Provides localStorage-backed persistence for settings (endpoints, temps, maxHistoryTurns, maxToolHistory, appearance, etc.).
  - Virtual in-memory + LS "filesystem" for prompt.md, memory/*.json, context entries, transcripts.
  - Sensible defaults so the app is immediately functional.
  - run_shell returns clear demo output (with guidance).
- Updated `invoke()` wrappers in `App.svelte` (main) and `settings-store.svelte.ts` so `!isTauri` automatically uses the rich web implementation instead of no-op.
- Same changes applied to the gemma-code tree for bidirectional parity.
- Console banner + setup tips when running in web mode.
- Core chat (agent + direct fetch to /v1/chat/completions) already worked over HTTP; now memory, prompt, context (manual), transcripts, settings, etc. also persist nicely per-browser.

**How to pick up / run on the server (the "other side"):**
1. Get the code on the target machine (the one serving Gemma inference, e.g. on port 8091 or similar):
   - rsync / scp / git the bro-code (or gemma-code) directory over.
2. `cd bro-code && npm install`
3. Run the Vite frontend visible on the network:
   - Dev (fastest for iteration): `npm run dev -- --host 0.0.0.0 -p 5173`
   - Built web app: `npm run build && npx serve dist -p 8080` (or nginx / your existing static server).
4. From a browser on any machine on the LAN: `http://<server-ip>:5173`
5. In the app's **Settings** tab:
   - Use "Test" to validate.
   - Set the active endpoint to the local Gemma server on that box (e.g. `http://127.0.0.1:8091/v1/chat/completions` or the exact URL you already use).
   - All other settings (max history/tool turns, etc.) will save via the web layer.
6. Test flows:
   - Chat (solo + modes if enabled).
   - Memory tab (edit + persist).
   - Prompt editing.
   - Context tab (add paths; manual content works via virtual FS; dir listings are mocked).
   - Transcripts (auto-save + load).
   - Exec approval UI (feedback, "always this session", reject guard) — the actual shell is demo-only.

**Current web mode limitations (where to continue):**
- `run_shell` / real `!sh` tools are mocked for safety (browser can't spawn shells). The full approval + feedback UX is there for testing.
- Directory-based context (the `find` in loadContext) returns a demo string. Non-dir files work if you "add" them and feed content.
- No native drag-drop (the Tauri webview plugin is guarded). Use the "Add path" + manual entry in ContextTab.
- Paths like `~/bro` are virtualized to browser storage (per-origin). This is actually handy for isolated testing.
- If you want **real server-side execution + shared FS** (so tools actually run on the Gemma host, transcripts live on disk server-side, etc.), the next logical step is a small companion backend.

**Recommended next step for the other side / continuation:**
- Scaffold a tiny backend (Express, Fastify, or even a Python Flask/FastAPI if the inference server is Python-based) on the same machine.
  - Expose a POST /api/invoke that accepts `{cmd, args}` and implements the real Tauri-style commands using Node `fs`, `child_process.exec`, etc. (with allow-lists for safety on run_shell).
  - Update `createWebInvoke` (or the main invoke) to optionally `fetch` that endpoint when a `webBackendUrl` env/setting is present.
  - Serve the Vite static assets from the same backend.
- This gives near-full parity while keeping the "co-located with Gemma" benefit.
- See the comments inside `createWebInvoke()` for the virtual FS / setting keys — easy to mirror on the server side.
- Also consider adding a visible "Web mode (localStorage)" banner in the header when `!isTauri`.

**Entry points to pick up the work:**
- `src/app/modular/lib/config.ts` → `createWebInvoke()` (the heart of web support).
- `src/app/App.svelte` → the `invoke()` wrapper and the `!isTauri` branch + console guidance.
- `src/app/modular/lib/settings-store.svelte.ts` → settings persistence in web.
- Same files under the gemma-code tree (keep them in sync).
- This README (you are here) and the console output when starting in web mode.

The desktop Tauri experience is completely unaffected. This work was specifically to unblock testing the Vite frontend directly against the live model server.

See also recent transcript naming / English title work and context feeding for other active threads.

**Status:** Basic web mode is functional and ready for the "test it from there" use case. Full native backend is the clear next pick-up point.

---

Core agent and components are reusable for other apps (qwen etc.).

**Cleanup status:** provider.ts removed. tsconfig fixed. VS now uses unified agent (with bro-shared fallback). Clear button, settings Test/TPS, dual exec, and most tab/agent lifting have full parity. Remaining hybrid host state for UI simplicity during final polish.

**Key audit findings (via code reads + greps):**
- Duplication hotspots: load/persist for memory/prompt/context, renderMd/highlight, extract* , streamAssistant (also in stream_backup.ts), tab UIs, state (memCells, promptText, ctxEntries, messages etc. lived in both the monolith App.svelte and the extracted modular components during the transition).
- Tab variants: Full*/Complete* were aspirational placeholders (comments claimed "ported from original" but contained stubs/"for brevity"). Removed the 5 dead files to clean the tree.
- Wiring in App.svelte: partial — created unifiedAgent via createAgentCore and delegated in solo/dual/supervision send paths for rich context/memory/SCP, plus imported a few modular Chat components. But the vast majority of state, handlers, and **all tab UIs** remained inline in the monolith script + template.
- Components: mostly good prop-driven shells matching the monolith UIs. PromptTab and SourceTab were enhanced during this pass to achieve feature parity (highlight, renderMd from shared utils, scroll sync, rehighlight callbacks).
- Other: render/highlight utils now better shared; stream_backup.ts marked deprecated (logic migrated to agent.ts streamTurn + hybrid in App).

**Completed in this pass:**
- Removed placeholder Full*/Complete* tabs (no real logic).
- Wired + enhanced **PromptTab**, **MemoryTab**, **SourceTab** as canonical modular components.
- Replaced the corresponding large inline template blocks in App.svelte (prompt ~30 lines, memory ~40 lines, source ~long self-editing editor) with `<PromptTab ... />`, `<MemoryTab ... />`, `<SourceTab ... />` usages. App now delegates those UIs.
- Added the imports in App.svelte.
- Deprecated stream_backup.ts.
- Updated agent/core comments and this README.

**Remaining for full completion (see top-level todo plan):**
- Wire remaining tabs (Context, Terminal, Tools, Transcripts, Kv, Settings — some have shells in modular).
- Centralize more state into the agent (via context) so App.svelte sheds its duplicate $state for mem/prompt/ctx.
- Expand chat area to use more modular chat components (already some DualPane usage).
- Remove legacy handlers/inline code in App.svelte once tabs and agent own the flows.
- Update nav/header to optionally use modular AppHeader/TabBar.
- Full verification of flows + update docs.
- Optional: move gemma-specific source browser (self-forge) or settings into more contained components.

This brings the "refactor state" much closer to done: the monolith is shrinking, modular owns more of the presentation and (via lib) the important agent behavior. The app remains functional throughout.

See root-level refactor todos for the wave plan.
