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
