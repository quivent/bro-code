<script lang="ts">
  import { marked, Renderer } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from 'highlight.js';

  // marked v17 ignores the `highlight` option — use a custom renderer instead
  const renderer = new Renderer();
  renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
    const cls = lang ? ` class="hljs language-${lang}"` : ' class="hljs"';
    return `<pre><code${cls}>${highlighted}</code></pre>`;
  };
  marked.setOptions({ renderer });

  import { config } from './config';
  import { DualPane } from 'bro-shared/components';
  import { createInitialDualState, streamToPane, startCrosstalk, type DualChatState } from 'bro-shared';

  // Full modular integration for dynamic endpoints, Settings tab, unified agent (memory/prompt/SCP), etc.
  // The modular/ layer (extracted for reuse across bro/gemma/qwen variants) provides the rich endpoint management.
  import {
    createAgentCore,
    setAgentContext,
    loadMemory as libLoadMemory,
    persistMemory as libPersistMemory,
    addMemCell as libAddMemCell,
    loadPrompt as libLoadPrompt,
    savePrompt as libSavePrompt,
    loadContext as libLoadContext,
    buildApiMessages as libBuildApiMessages,
    pruneHistoryForContext,
    getLocalOrigin,
    getLocalChatURL,
    hasLocalEndpoint as libHasLocal,
    createLocalEndpoint,
    syncLocalEndpointPorts as libSyncLocalPorts,
    LOCAL_MODEL as LIB_LOCAL_MODEL,
    getLocalModelsURL,
    getLocalCacheStatsURL,
    getLocalCacheResetURL,
    isDestructiveCmd,
    extractExecCalls,
  } from './modular/lib';
  import {
    settings as appSettings,
    loadSettings as loadAppSettings,
    clearSettingsState,
    checkActiveHealth,
    cleanBadEndpoints,
    saveAppearance,
    saveAgentSettings,
    savePanesSettings,
    saveAdvancedSettings,
    // Handlers for full SettingsTab functionality (endpoints CRUD, test, local, etc.)
    refreshAllHealth,
    onAddEndpointClick,
    testEndpoint,
    startEdit,
    deleteEndpoint,
    setActive,
    moveEndpoint,
    cancelEdit,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleEndpointFormSubmit,
    addLocalEndpoint,
    syncLocalEndpointPorts,
    saveLocalPortAndSync,
    // Pure URL helpers (reused for probe so /models never gets dup /v1 from crude replace)
    getHealthUrl,
    resolveModelForEndpoint,
  } from './modular/lib/settings-store.svelte.ts';
  import SettingsTab from './modular/components/Tabs/SettingsTab.svelte';
  import MemoryTab from './modular/components/Tabs/MemoryTab.svelte';
  import PromptTab from './modular/components/Tabs/PromptTab.svelte';
  import SourceTab from './modular/components/Tabs/SourceTab.svelte';
  import ContextTab from './modular/components/Tabs/ContextTab.svelte';
  import TerminalTab from './modular/components/Tabs/TerminalTab.svelte';
  import KvTab from './modular/components/Tabs/KvTab.svelte';
  import ToolsTab from './modular/components/Tabs/ToolsTab.svelte';
  import TranscriptsTab from './modular/components/Tabs/TranscriptsTab.svelte';
  import ChatComposer from './modular/components/Chat/ChatComposer.svelte';
  import AppHeader from './modular/components/layout/AppHeader.svelte';
  import TabBar from './modular/components/shared/TabBar.svelte';

  // Static imports for Tauri APIs (avoids Vite dev dynamic import() bare-specifier resolution errors
  // like "Module name '@tauri-apps/api/webview' does not resolve to a valid URL" that were logged
  // from the previous constructed+@vite-ignore attempts inside Svelte script effects).
  // These packages are always resolvable from node_modules at dev/build time (rewritten by Vite to
  // served URLs); the fns are only *called* under isTauri guard. Safe and eliminates the warning.
  import { invoke as tauriInvoke } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { createWebInvoke } from './modular/lib/config';

  const ENDPOINT = config.endpoint; // legacy fallback
  const MODEL = config.model;       // legacy fallback
  const ENDPOINTS = config.endpoints || []; // still used for the dual demo toggle

  // NOTE: Primary inference endpoint is now driven by the Settings tab (dynamic + persisted).
  // See activeEndpoint / currentEndpoint derived below and the SettingsTab render.

  // Tauri invoke (falls back to capable web/browser implementation)
  const isTauri = '__TAURI_INTERNALS__' in (typeof window !== 'undefined' ? window : {});
  const webInvoke = createWebInvoke();

  async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (isTauri) {
      return tauriInvoke(cmd, args);
    }
    // Rich web fallback: localStorage + virtual FS for prompt/memory/context/transcripts/settings.
    // This makes the pure Vite web app fully testable when served from (or pointed at)
    // the same machine as the Gemma inference server.
    return webInvoke(cmd, args);
  }

  // Debug marker to prove this exact source is running (bypasses any caching doubts).
  // Guarded so HMR doesn't spam the log on every hot update.
  if (typeof window !== 'undefined' && !(window as any).__bro_v1_logged) {
    (window as any).__bro_v1_logged = true;
    console.log('%c[bro-code v1] loaded at ' + new Date().toISOString(), 'color:#f0883e;font-weight:bold');
    if (!isTauri) {
      console.log('%c[bro-code] Running in WEB / browser mode (using localStorage virtual FS). Perfect for testing the Vite frontend co-located with your Gemma server.', 'color:#3fb6b2');
      console.log('%c[bro-code] Serve with: npm run dev -- --host 0.0.0.0   or   npm run build + npx serve dist', 'color:#888');
    }
  }

  // Proactively clean any bad/dev endpoints (e.g. pointing at :5314 Vite server causing completions 404s)
  cleanBadEndpoints();

  // Dynamic endpoint + agent setup (Settings tab drives this)
  let unifiedAgent: any = $state(null);
  const agentCtx = setAgentContext();

  // Settings sub-section (enables the other four tabs next to Endpoints in Settings)
  let settingsSection = $state<'endpoints' | 'appearance' | 'agent' | 'panes' | 'advanced'>('endpoints');

  const PROMPT_FILE = `${config.homeDir}/prompt.md`;
  const MEMORY_HOME = `${config.homeDir}/memory`;
  const MEMORY_FILE = `${MEMORY_HOME}/memory.json`;

  async function initUnifiedAgent() {
    cleanBadEndpoints();
    const currentCtxEntries = ctxEntries || [
      { kind: 'prompt', path: PROMPT_FILE },
      { kind: 'memory', path: MEMORY_FILE },
    ];
    const agent = await createAgentCore({
      invoke,
      promptFile: PROMPT_FILE,
      memoryFile: MEMORY_FILE,
      endpoints: appSettings.endpoints,
      activeEndpointId: appSettings.activeEndpointId,
      chatTemperature: appSettings.chatTemperature,
      chatMaxTokens: appSettings.chatMaxTokens,
      autoFallback: appSettings.autoFallback,
      ctxEntries: currentCtxEntries,
    });
    unifiedAgent = agent;
    agentCtx.agent = agent;
    return agent;
  }

  async function loadSettings() {
    try {
      await loadAppSettings();

      // Kick off unified agent so chat benefits from dynamic endpoints + memory/prompt
      void initUnifiedAgent();

      applyAppearance();
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  }

  function applyAppearance() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-density', appSettings.uiDensity);
    root.setAttribute('data-font-size', appSettings.chatFontSize);
    root.setAttribute('data-accent', appSettings.accentColor);
  }

  async function clearAllData() {
    // placeholder - can expand to match gemma
    await clearSettingsState();
  }

  // ── State ──
  type Tab = 'chat' | 'prompt' | 'memory' | 'tools' | 'transcripts' | 'terminal' | 'context' | 'kv' | 'source' | 'settings';
  let activeTab: Tab = $state('chat');

  // Mobile detection for simplified tab UI
  let isMobile = $state(false);
  $effect(() => {
    const checkMobile = () => { isMobile = window.innerWidth < 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  // Persist active tab across refreshes (Cmd+R / location.reload)
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('bro:activeTab') as Tab | null;
    const validTabs: Tab[] = ['chat', 'prompt', 'memory', 'tools', 'transcripts', 'terminal', 'context', 'kv', 'source', 'settings'];
    if (saved && validTabs.includes(saved)) {
      activeTab = saved;
    }
  }

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bro:activeTab', activeTab);
    }
  });

  // Keep legacy dual rendering flag in sync with the canonical chatMode (so clicking Dual in the bar under chat actually switches the panes UI)
  $effect(() => {
    if (appSettings.chatMode === 'dual') {
      dualMode = true;
    } else if (appSettings.chatMode === 'solo') {
      dualMode = false;
    }
  });

  // Supporting state for modular context / agent init (minimal for integration)
  let ctxEntries: Array<{ kind: 'prompt' | 'memory' | 'file' | 'dir'; path: string; showInChat?: boolean }> = $state([
    { kind: 'prompt', path: PROMPT_FILE },
    { kind: 'memory', path: MEMORY_FILE },
  ]);
  let shownCtx = $derived(ctxEntries.filter(e => e.showInChat));
  let systemContext = $state('');
  let ctxLoadStatus = $state('');
  let ctxAddPath = $state('');
  let ctxDragIdx: number | null = $state(null);
  let ctxInited = false;

  // Dynamic active endpoint from the Settings tab / store (this is what makes "set the inference endpoint" via UI work)
  let activeEndpoint = $derived(
    appSettings.activeEndpointId 
      ? appSettings.endpoints.find(e => e.id === appSettings.activeEndpointId) 
      : (appSettings.endpoints[0] || null)
  );
  let currentEndpoint = $derived(activeEndpoint?.url || ENDPOINT);
  let currentModel = $derived(activeEndpoint?.model || MODEL);

  // Dedup for probe to avoid race/double pings on init or rapid settings updates
  let lastProbedEndpoint = $state('');

  // Context window tracking + usage bar (imported from gemma-code's chat UI)
  // ctxWindow = server's max_model_len (probed from /v1/models on the active endpoint)
  // ctxUsedTokens ~ chars/4 estimate of what will *actually* be sent next (after client-side sliding/prune per maxHistoryTurns).
  // This gives you visibility and control over the context Gemma receives.
  let ctxWindow = $state<number | null>(null);

  let ctxUsedTokens = $derived.by(() => {
    let hist = messages.map(m => ({ role: m.role, content: m.content, thinking: m.thinking, exec: m.exec }));
    const maxT = appSettings.maxHistoryTurns || 0;
    const maxTools = appSettings.maxToolHistory || 0;
    if (maxT > 0 || maxTools > 0) {
      hist = pruneHistoryForContext(hist, maxT, maxTools);
    }
    // Include the injected base (systemContext = prompt + memory + marked ctx files + exec awareness)
    // + pruned chat turns + tool outputs (for retained !sh awareness) + live streaming response.
    // This makes the bar show the *actual* approx tokens for the next request (chars/4 estimate).
    let chars = (systemContext || '').length;
    chars += hist.reduce((a, m) => a + ((m.content || '').length), 0);
    chars += hist.reduce((a, m) => a + ((m.exec?.output || '').length), 0);
    chars += ((currentResponse || '').length);
    return Math.ceil(chars / 4);
  });
  let ctxPct = $derived(ctxWindow ? Math.min(100, (ctxUsedTokens / ctxWindow) * 100) : 0);

  async function probeCtxWindow() {
    const ep = activeEndpoint;
    if (!ep?.url) return;
    try {
      // Use the exact same clean builder as Settings health/test (normalizes, collapses dup /v1, always produces .../models)
      // This eliminates the previous fragile replace that produced /v1/v1/models (causing the 404 "models" errors).
      const url = getHealthUrl(ep.url);
      if (!url) return;
      const res = await fetch(url, {
        method: 'GET',
        signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(6000) : undefined
      });
      if (!res.ok) return;
      const j = await res.json();
      const first = Array.isArray(j?.data) ? j.data[0] : j;
      // Common fields across servers (ollama, vllm, mlx, etc.)
      const win = first?.max_model_len || first?.context_window || first?.max_tokens || first?.context_length;
      if (typeof win === 'number' && win > 0 && win < 2000000) {
        ctxWindow = win;
      }

      // Also force model name inference (re-uses the shared resolver for consistency with chat path + auto-on-add).
      // This ensures ctxWindow probe (which fires on active endpoint change) also populates the model ID.
      if (ep) {
        void resolveModelForEndpoint(ep).then((resolved) => {
          if (resolved) {
            // ensure the endpoints array mutation is seen for reactivity (list + derived currentModel)
            appSettings.endpoints = [...appSettings.endpoints];
          }
        });
      }
    } catch (e) {
      // silent; user can use explicit Test in Settings which also hits /models
    }
  }

  // Re-probe context window when the active inference endpoint changes.
  // Guard with lastProbed to prevent duplicate pings/race during init or multiple derived updates.
  $effect(() => {
    const ep = currentEndpoint;
    if (ep && ep !== lastProbedEndpoint) {
      lastProbedEndpoint = ep;
      // small delay to let health settle
      setTimeout(() => { void probeCtxWindow(); }, 300);
    }
  });

  // ── Context management (wired for ContextTab + agent injection)
  // Delegates to modular/lib/context.ts (loadContext builds system prompt from prompt + memory + files/dirs)
  // and refreshes the unified agent so chat gets the injected context.
  async function loadContext() {
    try {
      const res = await libLoadContext({
        invoke,
        promptFile: PROMPT_FILE,
        memoryFile: MEMORY_FILE,
        ctxEntries,
        includeExecAwareness: true,
      } as any);
      systemContext = res.systemContext;
      ctxEntries = res.ctxEntries;
      ctxLoadStatus = `loaded ${ctxEntries.length} entries`;
      if (unifiedAgent) void initUnifiedAgent(); // refresh agent with latest ctx
    } catch (e: any) {
      ctxLoadStatus = `error: ${e}`;
    }
  }

  function clearContext() {
    systemContext = '';
    ctxLoadStatus = 'context cleared — nothing injected';
  }

  function addCtxPath(p: string) {
    const t = p.trim();
    if (!t || ctxEntries.some(e => e.path === t)) return;
    const kind: any = /\.[A-Za-z0-9]{1,8}$/.test(t) ? 'file' : 'dir';
    ctxEntries = [...ctxEntries, { kind, path: t, showInChat: false }];
    saveCtxSettings();
  }

  async function pickCtxFile(directory: boolean) {
    if (!isTauri) {
      ctxLoadStatus = 'file picker requires the desktop app';
      return;
    }
    try {
      const sel = await openDialog({ multiple: true, directory });
      const picks = Array.isArray(sel) ? sel : sel ? [sel] : [];
      for (const p of picks) {
        const t = (p as string).trim();
        if (!t || ctxEntries.some(e => e.path === t)) continue;
        ctxEntries = [...ctxEntries, { kind: directory ? 'dir' : 'file', path: t, showInChat: false }];
      }
      if (picks.length) saveCtxSettings();
    } catch (e: any) { ctxLoadStatus = `picker error: ${e}`; }
  }

  function removeCtxEntry(i: number) {
    ctxEntries = ctxEntries.filter((_, idx) => idx !== i);
    saveCtxSettings();
  }

  function ctxDrop(target: number) {
    if (ctxDragIdx === null || ctxDragIdx === target) { ctxDragIdx = null; return; }
    const list = [...ctxEntries];
    const [moved] = list.splice(ctxDragIdx, 1);
    list.splice(target, 0, moved);
    ctxEntries = list;
    ctxDragIdx = null;
    saveCtxSettings();
  }

  function toggleShowInChat(i: number) {
    const list = [...ctxEntries];
    list[i] = { ...list[i], showInChat: !list[i].showInChat };
    ctxEntries = list;
    saveCtxSettings();
  }

  async function feedMarkedContext() {
    await loadContext();
    // Marked ones (with showInChat) will render in the .shown-ctx section in the chat area above messages.
    // They are also preferentially retained in the sliding context (maxToolHistory in settings).
    // The actual system injection happens automatically on send via the agent.
    ctxLoadStatus = 'Marked context fed (visible above + in next prompt to Gemma)';
    setTimeout(() => { ctxLoadStatus = ''; }, 2200);
  }

  function refreshContext() {
    loadContext();
  }

  function clearShown() {
    ctxEntries = ctxEntries.map(e => ({...e, showInChat: false}));
    saveCtxSettings();
  }

  async function saveCtxSettings() {
    await invoke('set_setting', { key: 'ctxEntries', value: JSON.stringify(ctxEntries) }).catch(() => {});
  }

  async function loadCtxSettings() {
    try {
      const raw = await invoke('get_setting', { key: 'ctxEntries' });
      if (raw) {
        ctxEntries = JSON.parse(raw as string).map((e: any) => ({
          ...e,
          showInChat: e.showInChat ?? false
        }));
      }
    } catch {}
    loadContext();
    void initUnifiedAgent();
  }

  // Tauri drag-drop support for context tab (files/folders dropped from Finder)
  $effect(() => {
    if (!isTauri || ctxInited) return;
    ctxInited = true;
    loadCtxSettings();
    try {
      getCurrentWebview().onDragDropEvent((event: any) => {
        if (event.payload.type === 'drop' && activeTab === 'context') {
          for (const p of (event.payload.paths || [])) addCtxPath(p);
        }
      }).catch(() => {});
    } catch (e) {
      // Non-fatal (e.g. if webview plugin not fully available); drag from Finder just won't auto-add.
    }
  });

  // Kick off settings load (populates endpoints from DB + store; enables the Settings tab)
  loadSettings();

  // Bootstrap context (loads persisted ctxEntries from settings and populates systemContext + agent)
  loadCtxSettings();

  // Chat state
  interface Message { role: 'user' | 'assistant'; content: string; thinking?: string; exec?: { cmd: string; output: string; approved: boolean }; }
  let messages: Message[] = $state([]);
  let inputText = $state('');
  let streaming = $state(false);
  let currentResponse = $state('');
  let currentThinking = $state('');
  let elapsed = $state(0);
  let tokenCount = $state(0);
  let error = $state('');
  let chatContainer: HTMLElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let history: string[] = $state([]);
  let histIdx = $state(0);
  let histBuf = $state('');
  let startTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Prompt state
  let promptText = $state('');
  let promptDirty = $state(false);
  let promptStatus = $state('');
  let promptHighlightEl: HTMLPreElement | undefined = $state();

  // Memory state
  let memoryJson = $state('');
  let memRaw: Record<string, any> = $state({});
  let memCells: Array<{key: string; value: string; tags?: string[]; pinned?: boolean; anchored?: boolean}> = $state([]);
  let memStatus = $state('');
  let memLoaded = $state(false);
  let editingKey: string | null = $state(null);
  let editKey = $state('');
  let editValue = $state('');
  let editTags = $state('');
  let newCellKey = $state('');

  // Terminal state
  let termInput = $state('');
  let termOutput: string[] = $state([]);
  let termRunning = $state(false);
  let termContainer: HTMLElement | undefined = $state();

  // Dual support using shared
  let dualState: DualChatState = $state(createInitialDualState());
  let dualMode = $state(false); // toggle for demo
  let leftContainer: HTMLElement | undefined = $state();
  let rightContainer: HTMLElement | undefined = $state();

  // Minimal addition for chat + terminal split mode
  let chatTermSplit = $state(false);

  // ── Execute organ / !sh approval (SCP tool use + human-in-the-loop)
  // The full UI (Run / Always this session / Deny / "Say something back" + feedback textarea)
  // and per-command always/reject tracking are preserved for the human.
  // However, the agent no longer mutates its internal history with the "[model requested...]"
  // placeholder or long "User feedback: Do not..." meta turns. Those were making the model
  // see noisy/non-SCP output as its own previous responses, causing it to become much worse
  // at emitting clean Intent + !sh compared to gemma-code.
  // Model now sees original outputs + "Command results: ..." style feedback (matching EXEC_AWARENESS).
  // "Always this session" and feedback are still fully functional on the UI side.
  let pendingExec = $state<{ cmd: string } | null>(null);
  let execResolver: ((result: {approved: boolean, feedback?: string}) => void) | null = null;
  let alwaysAllowedCmds = $state<Set<string>>(new Set());

  let showFeedbackInput = $state(false);
  let feedbackInput = $state('');

  function requestApproval(cmd: string): Promise<{approved: boolean, feedback?: string}> {
    if (alwaysAllowedCmds.has(cmd)) return Promise.resolve({approved: true});
    return new Promise((resolve) => {
      pendingExec = { cmd };
      execResolver = resolve;
    });
  }

  function answerExec(ok: boolean, always = false, feedback?: string) {
    const cmd = pendingExec?.cmd;
    if (always && ok && cmd) alwaysAllowedCmds.add(cmd);
    const r = execResolver;
    pendingExec = null;
    execResolver = null;
    showFeedbackInput = false;
    feedbackInput = '';
    r?.({approved: ok, feedback});
  }

  function startFeedback() {
    showFeedbackInput = true;
    feedbackInput = `Do not do things like 'ls ~' which hangs forever. `;
  }

  function cancelFeedback() {
    showFeedbackInput = false;
    feedbackInput = '';
  }

  function submitFeedbackDeny() {
    const fb = feedbackInput.trim();
    answerExec(false, false, fb);
  }

  // ── Helpers ──
  function renderMd(md: string): string {
    return DOMPurify.sanitize(marked.parse(md) as string);
  }

  function highlightMdSource(src: string): string {
    if (!src) return '';
    return src.split('\n').map(line => {
      // Headers — escape first, then wrap
      if (/^#{1,6}\s/.test(line)) return `<span class="hl-heading">${esc(line)}</span>`;
      // Blockquote — escape first, then wrap
      if (/^>\s/.test(line)) return `<span class="hl-quote">${esc(line)}</span>`;
      // For other lines: escape first, then apply inline highlights
      let out = esc(line);
      // Bold (escaped ** is still **)
      out = out.replace(/\*\*(.+?)\*\*/g, '<span class="hl-bold">**$1**</span>');
      // Inline code (escaped ` is still `)
      out = out.replace(/`([^`]+)`/g, '<span class="hl-code">`$1`</span>');
      // List items
      if (/^\s*[-*]\s/.test(line)) return `<span class="hl-list">${out}</span>`;
      return out;
    }).join('\n');
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function scrollToBottom(el: HTMLElement | undefined) {
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight; });
  }

  // ── Chat ──
  // Updated to use the modular agent's send (the same way gemma-code does)
  // so that full SCP / !sh / exec approval / multi-round + rich memory/prompt/context is active.
  async function send() {
    const text = inputText.trim();
    if (!text || streaming) return;
    if (!history.length || history[history.length - 1] !== text) history = [...history, text].slice(-50);
    histIdx = history.length;
    inputText = '';
    error = '';

    messages = [...messages, { role: 'user', content: text }];
    scrollToBottom(chatContainer);
    streaming = true;
    currentResponse = '';
    currentThinking = '';
    tokenCount = 0;
    startTime = performance.now();
    elapsed = 0;
    timer = setInterval(() => { elapsed = (performance.now() - startTime) / 1000; }, 100);

    try {
      const uAgent = unifiedAgent || await initUnifiedAgent();

      // Client-side context sliding / pruning.
      // Gives explicit control over how much history is submitted in the request to the model.
      // Complements the server's max_model_len sliding (if any). Prevents runaway context size
      // from long sessions or repeated !sh + feedback loops.
      let historyForModel = messages.map(m => ({ role: m.role, content: m.content, thinking: m.thinking, exec: m.exec }));
      const maxTurns = appSettings.maxHistoryTurns || 0;
      const maxTools = appSettings.maxToolHistory || 0;
      if (maxTurns > 0 || maxTools > 0) {
        historyForModel = pruneHistoryForContext(historyForModel, maxTurns, maxTools);
      }

      const result = await uAgent.send(text, {
        onUpdate: (partial: any) => {
          currentResponse = partial.response || '';
          currentThinking = partial.thinking || '';
          tokenCount = partial.tokens || 0;
          scrollToBottom(chatContainer);
        },
        onExecApproval: (cmd: string) => requestApproval(cmd),
        // Pass (possibly pruned) history so the agent owns the full loop...
        history: historyForModel,
        // Always pass the live endpoints from the settings store. This ensures the agent's
        // send/streamTurn uses the current (cleaned + normalized) active endpoint URL for the
        // completions POST, even if the agent was created earlier. Prevents stale .url values
        // from causing the last "404 (completions)" fetches against wrong hosts/paths.
        extraConfig: {
          endpoints: appSettings.endpoints,
          activeEndpointId: appSettings.activeEndpointId
        }
      });

      // If the agent returns a rich history (with exec turns etc.), adopt it.
      // The agent now keeps the model's original SCP-formatted outputs (with !sh lines) in its
      // internal history for prompt building. This restores the model's ability to reliably use
      // the !sh format the way it did in gemma-code.
      // For UI we still get clean exec cards. The old "[model requested: !sh ...]" placeholder
      // rewrite was moved out of the agent's currentHistory (it was polluting the model's context
      // on follow-up turns and after feedback).
      if (result && (result as any).history) {
        messages = (result as any).history.map((h: any) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
          thinking: h.thinking,
          exec: h.exec
        }));
      } else if (result && (result as any).reply) {
        messages = [...messages, { role: 'assistant', content: (result as any).reply }];
      }

      // (Removed the previous aggressive safety-net append + some dupe logic that could
      // introduce extra assistant turns. The agent now returns a clean history.)

      saveTranscript();
    } catch (e: any) {
      error = e.message || 'Connection failed';
    } finally {
      if (timer) clearInterval(timer);
      elapsed = (performance.now() - startTime) / 1000;
      streaming = false;
      currentResponse = '';
      currentThinking = '';
      scrollToBottom(chatContainer);
      inputEl?.focus();
    }
  }

  function chatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'ArrowUp' && !inputText && history.length) {
      if (histIdx === history.length) histBuf = inputText;
      if (histIdx > 0) { histIdx--; inputText = history[histIdx]; }
    } else if (e.key === 'ArrowDown' && history.length) {
      if (histIdx < history.length - 1) { histIdx++; inputText = history[histIdx]; }
      else if (histIdx === history.length - 1) { histIdx = history.length; inputText = histBuf; }
    }
  }

  // ── Prompt ──
  async function loadPrompt() {
    try {
      if (isTauri) {
        promptText = await invoke('read_file', { path: `${config.homeDir}/prompt.md` }) || '';
      } else {
        promptText = '(prompt editing requires Tauri)';
      }
      promptDirty = false;
      promptStatus = '';
    } catch (e: any) { promptStatus = `error: ${e}`; }
  }

  async function savePrompt() {
    try {
      await invoke('write_file', { path: `${config.homeDir}/prompt.md`, content: promptText });
      promptDirty = false;
      promptStatus = 'saved';
      setTimeout(() => { promptStatus = ''; }, 2000);
    } catch (e: any) { promptStatus = `error: ${e}`; }
  }

  // ── Memory ──
  async function loadMemory() {
    try {
      if (isTauri) {
        memoryJson = await invoke('read_file', { path: `${config.homeDir}/memory.json` }) || '{}';
      } else {
        memoryJson = '{}';
      }
      const parsed = JSON.parse(memoryJson);
      memRaw = parsed;
      memCells = Object.entries(parsed).map(([key, val]: [string, any]) => {
        const tags: string[] = val.tags || [];
        return {
          key,
          value: typeof val.value === 'string' ? val.value : JSON.stringify(val.value ?? ''),
          tags,
          pinned: val.pinned || tags.includes('pin'),
          anchored: val.anchored || tags.includes('anchor'),
        };
      });
      memStatus = '';
      memLoaded = true;
    } catch (e: any) {
      memCells = [];
      memStatus = `error: ${e}`;
      memLoaded = true;
    }
  }

  function startEditCell(cell: {key: string; value: string; tags?: string[]}) {
    editingKey = cell.key;
    editKey = cell.key;
    const raw = memRaw[cell.key] || {};
    editValue = typeof raw.value === 'string' ? raw.value : cell.value || '';
    editTags = (raw.tags || cell.tags || []).join(', ');
  }

  async function persistMemory() {
    if (!isTauri) { memStatus = 'editing requires Tauri'; return; }
    try {
      await libPersistMemory({ invoke, memoryFile: MEMORY_FILE }, memRaw);
      await loadMemory();
      memStatus = 'saved';
      setTimeout(() => { memStatus = ''; }, 2000);
      if (unifiedAgent && unifiedAgent.loadAll) await unifiedAgent.loadAll(ctxEntries);
    } catch (e: any) { memStatus = `error: ${e}`; }
  }

  async function saveMemCell() {
    if (!editingKey) return;
    const newKey = editKey.trim().replace(/\s+/g, '_') || editingKey;
    if (newKey !== editingKey && memRaw[newKey]) { memStatus = 'key exists'; return; }
    const prev = memRaw[editingKey] || {};
    const cell = {
      key: newKey,
      value: editValue,
      tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
      updated: new Date().toISOString(),
      reads: typeof prev.reads === 'number' ? prev.reads : 0,
      writes: (typeof prev.writes === 'number' ? prev.writes : 0) + 1,
    };
    memRaw = { ...memRaw, [newKey]: cell };
    if (newKey !== editingKey) delete memRaw[editingKey];
    await persistMemory();
    editingKey = null;
  }

  async function addMemCell() {
    const key = newCellKey.trim().replace(/\s+/g, '_');
    if (!key) return;
    if (memRaw[key]) { memStatus = 'key exists'; return; }
    memRaw = libAddMemCell(memRaw, key);
    await persistMemory();
    newCellKey = '';
    startEditCell({ key, value: '', tags: [] });
  }

  function cancelEditCell() {
    editingKey = null;
    editKey = '';
    editValue = '';
    editTags = '';
  }

  // ── Terminal ──
  async function runCommand() {
    let raw = termInput.trim();
    if (!raw || termRunning) return;

    // Support !sh / shell prefix from Gemma's tool outputs (the primitive !sh tool)
    // Accepts:
    //   !sh
    //   ls -la ~
    // or
    //   !sh ls -la ~
    // or
    //   shell
    //   command here
    // We extract the actual command to run.
    let toExecute = raw;
    const prefixMatch = raw.match(/^(?:!?\s*sh|shell)\s*\n?(.*)$/is);
    if (prefixMatch) {
      toExecute = (prefixMatch[1] || '').trim();
      if (!toExecute) {
        // prefix only on first line, rest of block is the command
        toExecute = raw.replace(/^(?:!?\s*sh|shell)\s*\n?/is, '').trim();
      }
    }

    termInput = '';
    termOutput = [...termOutput, `$ ${toExecute || raw}`];
    termRunning = true;
    scrollToBottom(termContainer);
    try {
      let result: string;
      if (isTauri) {
        result = await invoke('run_shell', { cmd: toExecute || raw }) || '';
      } else {
        result = '(shell requires Tauri)';
      }
      termOutput = [...termOutput, ...result.split('\n')];
    } catch (e: any) {
      termOutput = [...termOutput, `error: ${e}`];
    }
    termRunning = false;
    scrollToBottom(termContainer);
  }

  function termKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); runCommand(); }
  }

  // ── Tools ──
  interface Tool { name: string; description: string; language: string; file: string; calls: number; successes: number; failures: number; last_error?: string; }
  let tools: Tool[] = $state([]);
  let toolsStatus = $state('');
  let selectedTool: Tool | null = $state(null);
  let toolSource = $state('');

  async function loadTools() {
    try {
      const raw = await invoke('read_file', { path: `${config.homeDir}/tools/manifest.json` }) || '{}';
      const parsed = JSON.parse(raw);
      tools = Object.values(parsed) as Tool[];
      toolsStatus = '';
    } catch (e: any) { toolsStatus = `error: ${e}`; tools = []; }
  }

  async function viewToolSource(tool: Tool) {
    selectedTool = tool;
    try {
      toolSource = await invoke('read_file', { path: tool.file }) || '';
    } catch (e: any) { toolSource = `// error loading: ${e}`; }
  }

  // ── Transcripts ──
  interface TranscriptEntry { name: string; path: string; date: string; }
  let transcripts: TranscriptEntry[] = $state([]);
  let transcriptsStatus = $state('');
  let viewingTranscript: string | null = $state(null);
  let transcriptContent: Array<{role: string; content: string; ts?: string}> = $state([]);

  // Auto-save transcript after each assistant reply
  // Current session identifier for continuation (not used in filename anymore).
  let sessionId = Date.now().toString(36);

  // The human English title for the *current active* transcript file.
  // When non-null, saves go to `${title}.json` (nice name, no dates/sids).
  // Set when loading a transcript, or auto-generated on first save of a fresh chat.
  let currentTranscriptTitle: string | null = $state(null);

  function generateTranscriptTitle(raw: any): string {
    if (!raw) return 'Untitled Conversation';

    let msgs: any[] = [];
    if (Array.isArray(raw)) {
      msgs = raw;
    } else if (raw.turns) {
      msgs = raw.turns.map((t: any) => ({
        role: t.human ? 'user' : (t.speaker === 'Josh' ? 'user' : 'assistant'),
        content: t.text || ''
      }));
    } else if (raw.text) {
      return 'Synthesis';
    } else if (raw.topic) {
      return raw.topic.length > 60 ? raw.topic.slice(0, 57) + '…' : raw.topic;
    } else {
      return 'Transcript';
    }

    // Find first real user message for context
    const firstUser = msgs.find((m: any) => m.role === 'user' && m.content && m.content.trim().length > 2);
    let base = firstUser?.content || msgs[0]?.content || 'Conversation';

    base = String(base).replace(/\s+/g, ' ').trim();

    // Use first "thought" / sentence
    let title = base.split(/[.!?\n]/)[0].trim();
    if (title.length < 6) title = base.slice(0, 70).trim();
    if (title.length > 65) title = title.slice(0, 62) + '…';

    // Light title casing
    title = title.replace(/\b\w/g, (c: string) => c.toUpperCase());

    // Context-based overrides for known deep threads
    const lower = (JSON.stringify(raw) + base).toLowerCase();
    if (lower.includes('origin') || lower.includes('initial') && msgs.length < 6) return 'Origin';
    if (lower.includes('synthesis') || lower.includes('core positions') || lower.includes('kv cache') && lower.includes('continuity')) return 'The Synthesis';
    if (lower.includes('dialogue') || (msgs.length > 10 && lower.includes('back and forth'))) return 'Dialogue';
    if (lower.includes('live') && lower.includes('synthesis')) return 'Live Synthesis';
    if (lower.includes('journey')) return 'The Journey';

    return title || 'Untitled Session';
  }

  async function saveTranscript() {
    if (!isTauri || messages.length < 2) return;
    await invoke('run_shell', { cmd: `mkdir -p ${config.homeDir}/transcripts` }).catch(() => {});

    // New English-only naming schema (no dates, no sids in the filename):
    //   The file is named after a human-readable English title generated from the conversation context
    //   (first user message, or topic for synthesis, with special overrides like "Origin", "The Synthesis", "The Journey").
    //   Example: "Origin.json", "The Journey.json", "Restoring Gemma Code.json"
    //
    // currentTranscriptTitle is set either:
    //   - When you load an existing transcript into chat (continue editing that named thread)
    //   - Or auto-generated from the first message on a fresh chat
    //
    // This replaces all previous date_ + hex naming. Regressive migration happens on loadTranscripts.
    if (!currentTranscriptTitle) {
      currentTranscriptTitle = generateTranscriptTitle(messages);
    }

    // Sanitize for filesystem while keeping it readable (spaces are fine on macOS)
    let safe = currentTranscriptTitle.replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safe) safe = 'Untitled Transcript';
    const path = `${config.homeDir}/transcripts/${safe}.json`;

    const data = JSON.stringify(messages.map(m => ({ ...m, ts: new Date().toISOString() })), null, 2);
    await invoke('write_file', { path, content: data }).catch(() => {});
  }

  async function loadTranscripts() {
    const dir = `${config.homeDir}/transcripts`;

    // Regressive application of the *English naming schema* (user preference: no dates/data).
    // Any file whose current name looks "data-like" (starts with YYYY-MM-DD_, is a bare short sid,
    // or is/was a special like synthesis/origin/dialogue/LIVE-*) gets renamed on disk to a nice
    // English title generated from its actual content/context (first user message, topic, or
    // special detection like "Origin", "The Synthesis", "The Journey").
    //
    // Examples of resulting names:
    //   "Origin.json", "The Synthesis.json", "Dialogue.json",
    //   "Restoring Gemma Code.json", "Whats the Mission.json", "The Journey.json"
    //
    // This is applied automatically on load/reload so all historical transcripts (including
    // the ones from the previous date-based migration) get cleaned up.
    // Safe and idempotent — once a file has a nice English name it is left alone.
    try {
      const listRaw = await invoke('run_shell', { cmd: `ls -1 ${dir}/*.json 2>/dev/null || true` }) || '';
      let allFiles = listRaw.trim().split('\n').filter((l: string) => l && l.endsWith('.json'));

      for (const oldPath of allFiles) {
        const bn = oldPath.split('/').pop() || '';
        const currentName = bn.replace(/\.json$/, '');

        // Detect "needs English name" — old date_ style, bare hex sid, or known specials
        const needsRename =
          /^\d{4}-\d{2}-\d{2}/.test(currentName) ||
          /^[a-z0-9]{6,12}$/i.test(currentName) ||
          /synthesis|origin|dialogue|LIVE/i.test(currentName) ||
          currentName.length < 5;

        if (!needsRename) continue;

        // Read content to generate context-based title
        let rawContent: any = [];
        try {
          const contentStr = await invoke('read_file', { path: oldPath }) || '[]';
          rawContent = JSON.parse(contentStr);
        } catch {}

        let niceTitle = generateTranscriptTitle(rawContent);

        // Extra hard overrides for the known special files based on their historical context
        const lowerBn = currentName.toLowerCase();
        if (lowerBn.includes('origin')) niceTitle = 'Origin';
        else if (lowerBn.includes('synthesis') && !lowerBn.includes('live')) niceTitle = 'The Synthesis';
        else if (lowerBn.includes('dialogue')) niceTitle = 'Dialogue';
        else if (lowerBn.includes('live-synthesis')) niceTitle = 'Live Synthesis';
        else if (lowerBn.includes('live-session')) niceTitle = 'Live Session';

        // Sanitize for filename (spaces ok, strip bad chars)
        let safe = niceTitle.replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!safe) safe = 'Transcript ' + Date.now().toString(36).slice(-4);

        const newPath = `${dir}/${safe}.json`;

        if (newPath !== oldPath) {
          // Avoid overwrite if a file with that nice name already exists
          const exists = await invoke('run_shell', { cmd: `test -f "${newPath}" && echo yes || echo no` }).catch(() => 'no');
          let finalPath = newPath;
          if (exists.trim() === 'yes') {
            finalPath = `${dir}/${safe} (${Date.now().toString(36).slice(-4)}).json`;
          }
          await invoke('run_shell', { cmd: `mv "${oldPath}" "${finalPath}" 2>/dev/null || true` }).catch(() => {});
        }
      }
    } catch (e) {
      // non-fatal
    }

    // Fresh list after possible renames. Name is now the English title.
    try {
      const raw = await invoke('run_shell', { cmd: `ls -t ${dir}/*.json 2>/dev/null | head -40` }) || '';
      transcripts = raw.trim().split('\n').filter((l: string) => l).map((path: string) => {
        const bn = path.split('/').pop() || '';
        const name = bn.replace(/\.json$/, '');
        // No more date in the primary schema; keep a lightweight one for sorting/display if present in old metadata
        const date = ''; // intentionally no data-based display per user request
        return { name, path, date, sessionId: name }; // use the title as the identifier too
      });
      transcriptsStatus = '';
    } catch (e: any) { transcriptsStatus = `error: ${e}`; }
  }

  async function viewTranscript(t: TranscriptEntry) {
    try {
      const raw = await invoke('read_file', { path: t.path }) || '[]';
      const parsed = JSON.parse(raw);
      // Handle all formats:
      // 1. Array format: [{role, content, ts?}]
      // 2. Object with turns: {turns: [{speaker, text, human, ...}]}
      // 3. Synthesis format: {speaker, text, turn_count, ...} (flat summary)
      if (Array.isArray(parsed)) {
        transcriptContent = parsed;
      } else if (parsed.turns) {
        transcriptContent = parsed.turns.map((turn: any) => ({
          role: turn.human ? 'user' : (turn.speaker === 'Josh' ? 'user' : 'assistant'),
          content: turn.text || '',
        }));
      } else if (parsed.text) {
        // Synthesis / summary format — single text block
        transcriptContent = [{
          role: 'assistant',
          content: parsed.text,
        }];
      } else {
        transcriptContent = [];
      }
      viewingTranscript = t.name;
    } catch (e: any) { transcriptsStatus = `error: ${e}`; }
  }

  function loadTranscriptIntoChat(t: TranscriptEntry) {
    // Load the transcript into the active chat
    const filtered = transcriptContent.filter(m => m.role === 'user' || m.role === 'assistant');
    messages = filtered.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // With the English naming schema, the "name" *is* the nice title of the transcript file.
    // Set it as the current one so that subsequent saves continue updating this exact
    // human-named file (e.g. further turns on "The Journey").
    currentTranscriptTitle = t.name || null;

    // Keep a sessionId for any legacy internal uses (we can phase it out).
    sessionId = t.sessionId || t.name || Date.now().toString(36);

    activeTab = 'chat';
  }

  // Tab switching triggers data load
  $effect(() => {
    if (activeTab === 'prompt' && !promptText) loadPrompt();
    if (activeTab === 'memory' && !memLoaded) loadMemory();
    if (activeTab === 'tools' && !tools.length) loadTools();
    if (activeTab === 'transcripts' && !transcripts.length) loadTranscripts();
  });

  $effect(() => { inputEl?.focus(); });

  // Ctrl+R refresh
  function globalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      location.reload();
    }
  }
</script>

<svelte:window onkeydown={globalKeydown} />

<div class="app">
  <header>
    <span class="title">{config.name}</span>
    {#if !isTauri}
      <span class="web-mode-banner" title="Running as pure web app (Vite frontend). Persistence uses browser localStorage + virtual FS. Tools are simulated. See WEB_MODE_PICKUP.md for server co-location instructions and backend stub.">
        🌐 Web mode
      </span>
    {/if}
    <nav>
      {#if !isMobile}
        <button class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}>Chat</button>
        <button class:active={activeTab === 'prompt'} onclick={() => activeTab = 'prompt'}>Prompt</button>
        <button class:active={activeTab === 'memory'} onclick={() => activeTab = 'memory'}>Memory</button>
        <button class:active={activeTab === 'tools'} onclick={() => activeTab = 'tools'}>Tools</button>
        <button class:active={activeTab === 'transcripts'} onclick={() => activeTab = 'transcripts'}>Transcripts</button>
        <button class:active={activeTab === 'terminal'} onclick={() => activeTab = 'terminal'}>Terminal</button>
        <button class:active={activeTab === 'context'} onclick={() => activeTab = 'context'}>Context</button>
        <button class:active={activeTab === 'kv'} onclick={() => activeTab = 'kv'}>KV</button>
        <button class:active={activeTab === 'source'} onclick={() => activeTab = 'source'}>Source</button>
        <button class:active={activeTab === 'settings'} onclick={() => activeTab = 'settings'}>Settings</button>
        {#if activeTab === 'chat'}
          <button onclick={() => chatTermSplit = !chatTermSplit}>{chatTermSplit ? 'Chat only' : 'Chat+term'}</button>
        {/if}
      {:else}
        <!-- Mobile simplified main tabs: only Chat (which covers Prompt/Memory/Tools underneath) and Settings -->
        <button 
          class:active={['chat','prompt','memory','tools'].includes(activeTab)} 
          onclick={() => activeTab = 'chat'}>
          Chat
        </button>
        {#if activeTab !== 'settings'}
          <button 
            class:active={activeTab === 'settings'} 
            onclick={() => activeTab = 'settings'}>
            Settings
          </button>
        {/if}
        {#if activeTab === 'chat'}
          <button onclick={() => chatTermSplit = !chatTermSplit}>{chatTermSplit ? 'Chat only' : 'Chat+term'}</button>
        {/if}
      {/if}
    </nav>
    <span class="meta">
      {#if streaming}
        <span class="streaming">● {tokenCount} tok · {elapsed.toFixed(1)}s</span>
      {:else}
        {messages.length}m
      {/if}
    </span>
  </header>

  <!-- Mobile chat sub-tabs: Prompt, Memory, Tools underneath Chat for mobile -->
  {#if isMobile && ['chat','prompt','memory','tools'].includes(activeTab)}
    <div class="mobile-chat-subnav">
      <button class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}>Chat</button>
      <button class:active={activeTab === 'prompt'} onclick={() => activeTab = 'prompt'}>Prompt</button>
      <button class:active={activeTab === 'memory'} onclick={() => activeTab = 'memory'}>Memory</button>
      <button class:active={activeTab === 'tools'} onclick={() => activeTab = 'tools'}>Tools</button>
    </div>
  {/if}

  <!-- Chat Tab -->
  {#if activeTab === 'chat'}
  <!-- Modes listed directly underneath chat (Solo / Dual / VS / Supervision), ported from gemma-code ChatComposer chat-mode-bar -->
  <div class="chat-mode-bar">
    <button class:active={appSettings.chatMode === 'solo'} onclick={() => { appSettings.chatMode = 'solo'; dualMode = false; }}>Solo</button>
    <button class:active={appSettings.chatMode === 'dual'} onclick={() => { appSettings.chatMode = 'dual'; dualMode = true; }}>Dual</button>
    <button class:active={appSettings.chatMode === 'vs'} onclick={() => { appSettings.chatMode = 'vs'; dualMode = false; }}>VS (crosstalk)</button>
    <button class:active={appSettings.chatMode === 'supervision'} onclick={() => { appSettings.chatMode = 'supervision'; dualMode = false; }}>Supervision</button>
  </div>
  {#if chatTermSplit}
  <!-- Minimal chat + terminal split screen -->
  <div class="split" style="display: flex; flex: 1; overflow: hidden;">
    <!-- Left: chat -->
    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <main class="chat-main" bind:this={chatContainer} style="flex: 1;">
        {#if messages.length === 0 && !streaming}
          <div class="splash">
            <pre class="logo">{config.logo.join('\n')}</pre>
            <p class="tagline">{config.tagline}</p>
          </div>
        {/if}
        {#each messages as msg}
          {#if msg.exec}
            <div class="exec-card {msg.exec.approved ? 'ran' : 'denied'}">
              <div class="exec-cmd"><span class="exec-ps">$</span> {msg.exec.cmd}</div>
              <pre class="exec-out">{msg.exec.output || (msg.exec.approved ? '' : 'denied')}</pre>
            </div>
          {:else}
          <div class="message {msg.role}">
            <div class="role">{msg.role === 'user' ? '▸ you' : config.assistantLabel}</div>
            {#if msg.role === 'assistant'}
              <div class="content markdown">{@html renderMd(msg.content)}</div>
            {:else}
              <div class="content user-content">{msg.content}</div>
            {/if}
          </div>
          {/if}
        {/each}
        {#if streaming && currentResponse}
          <div class="message assistant">
            <div class="role">{config.assistantLabel}</div>
            <div class="content markdown">{@html renderMd(currentResponse)}</div>
          </div>
        {/if}
        {#if pendingExec}
          <div class="exec-approve">
            <div class="exec-approve-head">⟶ {config.name} wants to run a command</div>
            <pre class="exec-out">{pendingExec.cmd}</pre>
            {#if showFeedbackInput}
              <textarea bind:value={feedbackInput} placeholder="Tell the agent why (e.g. 'Do not run ls ~ as it hangs forever. Use ls -la /specific/path instead or a different tool.')." rows="2" style="width:100%; margin:6px 0; font-size:12px; font-family:var(--font-mono);"></textarea>
              <div class="exec-approve-btns">
                <button class="exec-yes" onclick={submitFeedbackDeny}>Send feedback &amp; deny</button>
                <button class="exec-no" onclick={cancelFeedback}>Cancel</button>
              </div>
            {:else}
              <div class="exec-approve-btns">
                <button class="exec-yes" onclick={() => answerExec(true)}>Run</button>
                <button class="exec-always" onclick={() => answerExec(true, true)}>Always this session</button>
                <button class="exec-no" onclick={() => answerExec(false)}>Deny</button>
                <button onclick={startFeedback} style="background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);color:#fbbf24;">Say something back</button>
              </div>
            {/if}
          </div>
        {/if}
        {#if error}<div class="error">✗ {error}</div>{/if}
      </main>
    </div>
    <div class="divider"></div>
    <!-- Right: terminal pane (reusing existing terminal state/logic) -->
    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <main class="term-main" bind:this={termContainer} style="flex: 1;">
        <div class="term-output">
          {#each termOutput as line}
            <div class="term-line">{line}</div>
          {/each}
          {#if !termOutput.length}
            <div class="term-line dim">{config.name} shell · type commands</div>
          {/if}
        </div>
      </main>
      <div class="term-prompt">
        <span class="term-ps1">$</span>
        <input class="term-input" bind:value={termInput} onkeydown={termKeydown}
          placeholder="command..." disabled={termRunning} />
      </div>
    </div>
  </div>
  {:else if ENDPOINTS.length >= 2 && (dualMode || appSettings.chatMode === 'dual')}
  <!-- Dual pane using shared component (activated via the modes bar under chat or legacy flag) -->
  <div class="split">
    <DualPane 
      pane={dualState.left} 
      config={ENDPOINTS[0]} 
      container={leftContainer} 
      render={renderMd} 
    />
    <div class="divider"></div>
    <DualPane 
      pane={dualState.right} 
      config={ENDPOINTS[1]} 
      container={rightContainer} 
      render={renderMd} 
    />
  </div>
  {:else}
  <!-- Wrapper to make messages grow and push footer (with prompt at bottom of chat area) down -->
  <div class="chat-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;">
    <main class="chat-main" bind:this={chatContainer} style="flex: 1; overflow-y: auto;">
      {#if appSettings.chatMode !== 'solo'}
        <div class="mode-indicator" title="Multi modes (dual/vs/supervision) activate alternative layouts where wired. Send and custom ctx feeding currently use the solo agent path.">
          mode: <strong>{appSettings.chatMode}</strong>
          {#if appSettings.chatMode === 'dual'}(shared dual panes){:else if appSettings.chatMode === 'vs' || appSettings.chatMode === 'supervision'}(see composer or gemma variant for full panes/crosstalk){/if}
        </div>
      {/if}
      {#if messages.length === 0 && !streaming}
        <div class="splash">
          <pre class="logo">{config.logo.join('\n')}</pre>
          <p class="tagline">{config.tagline}</p>
        </div>
      {/if}
      {#each messages as msg}
        {#if msg.exec}
          <div class="exec-card {msg.exec.approved ? 'ran' : 'denied'}">
            <div class="exec-cmd"><span class="exec-ps">$</span> {msg.exec.cmd}</div>
            <pre class="exec-out">{msg.exec.output || (msg.exec.approved ? '' : 'denied')}</pre>
          </div>
        {:else}
        <div class="message {msg.role}">
          <div class="role">{msg.role === 'user' ? '▸ you' : config.assistantLabel}</div>
          {#if msg.role === 'assistant'}
            <div class="content markdown">{@html renderMd(msg.content)}</div>
          {:else}
            <div class="content user-content">{msg.content}</div>
          {/if}
        </div>
        {/if}
      {/each}
      {#if streaming && currentResponse}
        <div class="message assistant">
          <div class="role">{config.assistantLabel}</div>
          <div class="content markdown">{@html renderMd(currentResponse)}</div>
        </div>
      {/if}
      {#if pendingExec}
        <div class="exec-approve">
          <div class="exec-approve-head">⟶ {config.name} wants to run a command</div>
          <pre class="exec-out">{pendingExec.cmd}</pre>
          {#if showFeedbackInput}
            <textarea bind:value={feedbackInput} placeholder="Tell the agent why (e.g. 'Do not run ls ~ as it hangs forever. Use ls -la /specific/path instead or a different tool.')." rows="2" style="width:100%; margin:6px 0; font-size:12px; font-family:var(--font-mono);"></textarea>
            <div class="exec-approve-btns">
              <button class="exec-yes" onclick={submitFeedbackDeny}>Send feedback &amp; deny</button>
              <button class="exec-no" onclick={cancelFeedback}>Cancel</button>
            </div>
          {:else}
            <div class="exec-approve-btns">
              <button class="exec-yes" onclick={() => answerExec(true)}>Run</button>
              <button class="exec-always" onclick={() => answerExec(true, true)}>Always this session</button>
              <button class="exec-no" onclick={() => answerExec(false)}>Deny</button>
              <button onclick={startFeedback} style="background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);color:#fbbf24;">Say something back</button>
            </div>
          {/if}
        </div>
      {/if}
      {#if error}<div class="error">✗ {error}</div>{/if}
    </main>
  </div>
  {/if}
  <footer>
    <!-- Prompt box bound to the bottom of the chat area.
         Only metrics and suggestive prompts go below the prompt box.
         Context (shown list) also moved below, made wider/fuller. -->
    <div class="input-row">
      <textarea bind:this={inputEl} bind:value={inputText} onkeydown={chatKeydown}
        placeholder={`talk to ${config.name}...`} rows="2" disabled={streaming}></textarea>
    </div>

    <!-- Metrics (ctx usage + stats) and suggestive prompts (feed actions) below the prompt. -->
    <div class="post-prompt-bar">
      <!-- Metrics row: ctx usage + stats side by side on large screens -->
      <div class="bottom-metrics">
        <!-- ctx usage metrics -->
        <div class="ctx-bar" title="Context usage for the next request (after client-side sliding per maxHistoryTurns + maxToolHistory). Estimated at ~4 chars per token. Tool usage results are preferentially retained. Window probed from the active inference server's /v1/models (max_model_len). Use Test in Settings to help populate the window size. Control in Settings &gt; Agent.">
          <span class="ctx-label">ctx</span>
          <div class="ctx-track">
            <div class="ctx-fill" class:warn={ctxPct > 75} class:crit={ctxPct > 90} style:width="{ctxWindow ? Math.max(ctxPct, 1.5) : 0}%"></div>
          </div>
          <div class="ctx-text">
            {#if ctxWindow}
              {(ctxUsedTokens / 1000).toFixed(1)}k / {(ctxWindow / 1000).toFixed(0)}k · {(Math.max(0, ctxWindow - ctxUsedTokens) / 1000).toFixed(1)}k left
            {:else}
              ~{(ctxUsedTokens / 1000).toFixed(1)}k used · window unknown
            {/if}
          </div>
        </div>

        <!-- stats metrics -->
        {#if !streaming && messages.length > 0}
          <div class="stats">{elapsed.toFixed(1)}s · {tokenCount} tok · {(tokenCount / Math.max(elapsed, 0.1)).toFixed(0)} tok/s</div>
        {/if}
      </div>

      <!-- suggestive prompts / feed actions -->
      <div class="bottom-actions">
        <div class="feed-ctx-row">
          <button class="feed-btn" onclick={feedMarkedContext} disabled={!shownCtx.length}>Feed marked context</button>
          <button class="feed-btn" onclick={refreshContext}>Refresh context</button>
          <button class="feed-btn" onclick={clearShown} disabled={!shownCtx.length}>Clear shown</button>
        </div>
      </div>

      <!-- Context shown list: now below the prompt box, wider/full width -->
      {#if shownCtx.length}
        <div class="shown-ctx context-below">
          <div class="shown-ctx-head">📎 Shown context (marked in Context tab • fed to Gemma)</div>
          {#each shownCtx as c}
            <div class="shown-ctx-item" title={c.path}>
              <span class="kind {c.kind}">{c.kind}</span>
              <span class="p">{c.path}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </footer>

  <!-- Prompt Tab -->
  {:else if activeTab === 'prompt'}
  <main class="editor-main">
    <div class="editor-header">
      <span>{config.homeDir}/prompt.md</span>
      {#if promptDirty}<span class="dirty">● unsaved</span>{/if}
      {#if promptStatus}<span class="status">{promptStatus}</span>{/if}
      <button class="save-btn" onclick={savePrompt} disabled={!promptDirty}>save</button>
      <button class="reload-btn" onclick={loadPrompt}>reload</button>
    </div>
    <div class="prompt-overlay-wrap">
      <pre class="prompt-highlight" bind:this={promptHighlightEl} aria-hidden="true">{@html highlightMdSource(promptText + '\n')}</pre>
      <textarea class="prompt-input" bind:value={promptText}
        oninput={() => promptDirty = true}
        onscroll={(e: Event) => { if (promptHighlightEl) promptHighlightEl.scrollTop = (e.target as HTMLElement).scrollTop; }}
        onkeydown={(e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); savePrompt(); } }}
        spellcheck="false"></textarea>
    </div>
  </main>

  <!-- Memory Tab (modular, with full editing from gemma-code) -->
  {:else if activeTab === 'memory'}
  <MemoryTab
    memStatus={memStatus}
    editingKey={editingKey}
    editKey={editKey}
    editValue={editValue}
    editTags={editTags}
    newCellKey={newCellKey}
    onLoad={loadMemory}
    onPersist={persistMemory}
    onStartEdit={startEditCell}
    onSaveCell={saveMemCell}
    onCancelEdit={cancelEditCell}
    onAddCell={addMemCell}
  />

  <!-- Tools Tab -->
  {:else if activeTab === 'tools'}
  <main class="editor-main">
    <div class="editor-header">
      <span>{config.homeDir}/tools/</span>
      <span class="meta">{tools.length} tools</span>
      {#if toolsStatus}<span class="status error-text">{toolsStatus}</span>{/if}
      <button class="reload-btn" onclick={loadTools}>reload</button>
    </div>
    {#if selectedTool}
      <div class="editor-header">
        <span class="tool-name">{selectedTool.name}</span>
        <span class="meta">{selectedTool.language} · {selectedTool.calls} calls · {selectedTool.successes} ok · {selectedTool.failures} fail</span>
        <button class="reload-btn" onclick={() => { selectedTool = null; toolSource = ''; }}>← back</button>
      </div>
      <pre class="tool-source">{@html hljs.highlightAuto(toolSource).value}</pre>
    {:else}
      <div class="tools-list">
        {#each tools as tool}
          <div class="tool-card" onclick={() => viewToolSource(tool)}>
            <div class="tool-card-top">
              <span class="tool-icon">⚙</span>
              <span class="tool-name">{tool.name}</span>
              <span class="tool-lang">{tool.language}</span>
            </div>
            <div class="tool-desc">{tool.description || '(no description)'}</div>
            <div class="tool-meta">
              <span class="tool-stat">{tool.calls || 0} calls</span>
              {#if tool.calls > 0}
                <span class="tool-stat rate" class:good={tool.successes/tool.calls >= 0.7} class:bad={tool.successes/tool.calls < 0.5}>
                  {Math.round(tool.successes/tool.calls*100)}% success
                </span>
              {/if}
              {#if tool.last_error}
                <span class="tool-stat err">⚠ {tool.last_error}</span>
              {/if}
            </div>
          </div>
        {/each}
        {#if !tools.length}<div class="empty">no tools forged yet — {config.title} creates them as needed</div>{/if}
      </div>
    {/if}
  </main>

  <!-- Transcripts Tab -->
  {:else if activeTab === 'transcripts'}
  <main class="editor-main">
    <div class="editor-header">
      <span>{config.homeDir}/transcripts/</span>
      <span class="meta">{transcripts.length} files</span>
      {#if transcriptsStatus}<span class="status error-text">{transcriptsStatus}</span>{/if}
      <button class="reload-btn" onclick={loadTranscripts}>reload</button>
      {#if viewingTranscript}
        <button class="save-btn" onclick={() => loadTranscriptIntoChat({ name: viewingTranscript!, path: '', date: '' })}>↗ load into chat</button>
        <button class="reload-btn" onclick={() => { viewingTranscript = null; transcriptContent = []; }}>← back</button>
      {/if}
    </div>
    {#if viewingTranscript}
      <div class="transcript-view">
        {#each transcriptContent as msg}
          <div class="transcript-msg {msg.role}">
            <div class="transcript-role">{msg.role === 'user' ? '▸ you' : config.assistantLabel}</div>
            {#if msg.role === 'assistant'}
              <div class="markdown">{@html renderMd(msg.content)}</div>
            {:else}
              <div class="transcript-text">{msg.content}</div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="transcript-list">
        {#each transcripts as t}
          <div class="transcript-row" onclick={() => viewTranscript(t)}>
            <span class="transcript-name">{t.name}</span>
            <!-- English naming only — no dates or machine ids in the schema -->
          </div>
        {/each}
        {#if !transcripts.length}<div class="empty">(no transcripts yet — they save automatically)</div>{/if}
      </div>
    {/if}
  </main>

  <!-- Terminal Tab -->
  {:else if activeTab === 'terminal'}
  <main class="term-main" bind:this={termContainer}>
    <div class="term-output">
      {#each termOutput as line}
        <div class="term-line">{line}</div>
      {/each}
      {#if !termOutput.length}
        <div class="term-line dim">{config.name} shell · type commands or paste !sh / shell blocks from Gemma (auto-stripped)</div>
      {/if}
    </div>
  </main>
  <footer>
    <div class="term-prompt">
      <span class="term-ps1">$</span>
      <input class="term-input" bind:value={termInput} onkeydown={termKeydown}
        placeholder="command... (or paste !sh block from Gemma)" disabled={termRunning} />
    </div>
  </footer>

  <!-- Context Tab (from modular) - brings the full context list (prompt, memory, extra files/dirs) into the app.
       Content is loaded via libLoadContext and passed to the unified agent so it gets injected into every send
       as system context (along with prompt + memory + EXEC_AWARENESS). The tab UI is self-contained but
       all state/handlers are wired here in the host. -->
  {:else if activeTab === 'context'}
  <ContextTab
    ctxEntries={ctxEntries}
    ctxLoadStatus={ctxLoadStatus}
    ctxAddPath={ctxAddPath}
    ctxDragIdx={ctxDragIdx}
    onRemove={removeCtxEntry}
    onLoad={loadContext}
    onClear={clearContext}
    onDropReorder={ctxDrop}
    onPickFile={pickCtxFile}
    onAddPath={addCtxPath}
    onToggleShowInChat={toggleShowInChat}
  />

  <!-- Settings Tab: dynamic multi-endpoint management (add/edit/reorder/test/+Local, persisted via Tauri DB).
       This is the full Settings tab from the modular layer, now integrated so you can set the inference endpoint
       from the UI instead of only editing config.ts. Active endpoint drives chat fetches. -->
  {:else if activeTab === 'settings'}
  <SettingsTab
    endpoints={appSettings.endpoints}
    activeEndpointId={appSettings.activeEndpointId}
    settingsStatus={appSettings.settingsStatus}
    localPort={appSettings.localPort}
    editingId={appSettings.editingId}
    formName={appSettings.formName}
    formUrl={appSettings.formUrl}
    formModel={appSettings.formModel}
    testState={appSettings.testState}
    draggedIdx={appSettings.draggedIdx}
    settingsSection={settingsSection}
    onSection={(s) => settingsSection = s}
    onSaveAppearance={saveAppearance}
    onSaveAgent={saveAgentSettings}
    onSavePanes={savePanesSettings}
    onSaveAdvanced={saveAdvancedSettings}
    onClearData={clearSettingsState}
    onRefreshAllHealth={refreshAllHealth}
    onSaveLocalPort={saveLocalPortAndSync}
    onSyncLocalPorts={syncLocalEndpointPorts}
    onAddEndpoint={onAddEndpointClick}
    onTestEndpoint={testEndpoint}
    onStartEdit={startEdit}
    onDeleteEndpoint={deleteEndpoint}
    onSetActive={setActive}
    onMoveEndpoint={moveEndpoint}
    onCancelEdit={cancelEdit}
    onHandleDragStart={handleDragStart}
    onHandleDragOver={handleDragOver}
    onHandleDrop={handleDrop}
    onHandleDragEnd={handleDragEnd}
    onHandleEndpointFormSubmit={handleEndpointFormSubmit}
    onAddLocalEndpoint={addLocalEndpoint}
    onAddLocalToEndpoints={addLocalEndpoint}
    onSaveLocalPortAndSync={saveLocalPortAndSync}
  />

  {/if}
</div>

<style>
  .app {
    display: flex; flex-direction: column; height: 100vh;
    background: var(--bg-primary);
  }

  /* ── Header ── */
  header {
    display: flex; align-items: center; gap: 16px;
    padding: 0 20px; height: 40px;
    background: linear-gradient(180deg, #10131a 0%, #0c0e14 100%);
    border-bottom: 1px solid rgba(42, 42, 58, 0.6);
    flex-shrink: 0;
  }
  .title {
    color: var(--pink); font-weight: 700; font-size: 15px;
    letter-spacing: 0.5px;
  }
  .web-mode-banner {
    font-size: 10px;
    font-family: var(--font-mono);
    color: #a5b4fc;
    background: rgba(167, 139, 250, 0.1);
    border: 1px solid rgba(167, 139, 250, 0.3);
    padding: 1px 6px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
    cursor: help;
  }
  nav { display: flex; gap: 1px; background: rgba(42, 42, 58, 0.3); border-radius: 6px; padding: 2px; }
  nav button {
    background: none; border: none; color: var(--muted);
    font-size: 12px; padding: 5px 14px; cursor: pointer;
    border-radius: 4px; font-family: var(--font-sans);
    transition: all 150ms ease; letter-spacing: 0.3px;
  }
  nav button:hover { color: var(--text-secondary); background: rgba(167, 139, 250, 0.08); }
  nav button.active {
    color: var(--lavend); background: rgba(167, 139, 250, 0.12);
    box-shadow: 0 0 8px rgba(139, 92, 246, 0.1);
  }
  .meta { color: var(--muted); font-size: 11px; font-family: var(--font-mono); margin-left: auto; }
  .streaming { color: var(--hotpink); animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

  /* ── Chat ── */
  .chat-main {
    flex: 1; overflow-y: auto; padding: 24px 32px;
    scroll-behavior: smooth;
  }
  .chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .splash {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 55vh; opacity: 0.5;
  }
  .logo {
    font-family: var(--font-mono); font-size: 12px; line-height: 1.35;
    background: linear-gradient(135deg, #3fb6b2, #a371f7, #f0883e);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .tagline { margin-top: 16px; color: var(--lavend); font-size: 13px; letter-spacing: 0.5px; opacity: 0.7; }

  .message { margin-bottom: 20px; max-width: 780px; animation: fadeIn 200ms ease; }
  /* Relax message width in multi-mode split panes (dual/vs/supervision) so text is easier to read on large desktop */
  .split .message,
  :global(.dual-panes) .message,
  :global(.vs-crosstalk) .vs-msg,
  :global(.supervision-pane) .message {
    max-width: 100% !important;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .message.user .role { color: var(--blue); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .message.assistant .role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .user-content {
    color: var(--text); font-size: 14px; line-height: 1.6;
    padding: 10px 14px; background: var(--bg-secondary);
    border-radius: 10px; border: 1px solid rgba(42, 42, 58, 0.5);
  }
  .message.assistant .content { color: var(--text); font-size: 14px; line-height: 1.75; padding: 4px 0; }
  .error { color: var(--red); font-size: 12px; font-family: var(--font-mono); padding: 8px 0; opacity: 0.9; }
  .stats { color: var(--dim); font-size: 11px; font-family: var(--font-mono); padding: 8px 0 20px; opacity: 0.6; }

  /* Exec / !sh approval UI (same as gemma-code) */
  .exec-card {
    margin: 8px 0 12px;
    padding: 8px 10px;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
  .exec-card.denied {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.25);
  }
  .exec-cmd { color: var(--dim); margin-bottom: 4px; }
  .exec-ps { color: var(--lavend); }
  .exec-out { white-space: pre-wrap; color: var(--text); margin: 0; }

  .exec-approve {
    margin: 12px 0;
    padding: 12px;
    border: 1px solid rgba(251, 191, 36, 0.35);
    background: rgba(251, 191, 36, 0.06);
    border-radius: 8px;
  }
  .exec-approve-head { color: #fbbf24; font-size: 12px; margin-bottom: 6px; font-family: var(--font-mono); }
  .exec-approve-btns { display: flex; gap: 8px; margin-top: 8px; }
  .exec-approve-btns button {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-mono);
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
  }
  .exec-yes { background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4); color: #34d399; }
  .exec-always { background: rgba(167, 139, 250, 0.12); border-color: rgba(167, 139, 250, 0.3); color: var(--lavend); }
  .exec-no { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.3); color: #f87171; }

  /* Context usage bar (imported from gemma-code ChatComposer) */
  .ctx-bar { display: flex; align-items: center; gap: 10px; padding: 4px 12px; font-size: 11px; color: var(--muted); font-family: var(--font-mono); border-top: 1px solid rgba(42,42,58,0.25); }
  .post-prompt-bar .ctx-bar { border-top: none; padding-top: 0; }
  .ctx-label { font-weight: 600; letter-spacing: 0.5px; }
  .ctx-track { flex: 1; height: 4px; background: rgba(42,42,58,0.4); border-radius: 2px; overflow: hidden; }
  .ctx-fill { height: 100%; background: var(--lavend); transition: width 200ms ease; }
  .ctx-fill.warn { background: #fbbf24; }
  .ctx-fill.crit { background: #f87171; }
  .ctx-text { font-size: 10px; }

  .shown-ctx {
    margin: 8px 12px 4px;
    padding: 6px 10px;
    background: rgba(167, 139, 250, 0.06);
    border: 1px solid rgba(167, 139, 250, 0.2);
    border-radius: 6px;
    font-size: 11px;
  }
  .shown-ctx-head {
    font-size: 10px;
    color: var(--lavend);
    margin-bottom: 4px;
    font-family: var(--font-mono);
  }
  .shown-ctx-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
  }
  .shown-ctx-item .p {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70%;
  }
  .context-below .shown-ctx-item .p {
    max-width: 85%; /* wider in the bottom bar on large screens */
  }

  .feed-ctx-row {
    display: flex;
    gap: 6px;
    padding: 0;
    flex-wrap: wrap;
  }
  .feed-btn {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .feed-btn:disabled { opacity: 0.5; cursor: default; }

  /* Post-prompt bar below the input: metrics + suggestive + wider context */
  .post-prompt-bar {
    padding: 4px 0 8px; /* full width on large desktop */
    border-top: 1px solid rgba(42,42,58,0.2);
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    width: 100%;
  }
  .post-prompt-bar .ctx-bar,
  .post-prompt-bar .stats,
  .post-prompt-bar .feed-ctx-row,
  .post-prompt-bar .context-below {
    padding-left: 32px;
    padding-right: 32px;
  }

  /* Make ctx taller and more prominent */
  .ctx-bar {
    padding: 6px 0;
    font-size: 13px;
  }
  .ctx-track {
    height: 8px;
  }
  .ctx-text {
    font-size: 12px;
  }

  /* Bottom sections: group metrics, actions, context for better readability on large screens */
  .bottom-metrics {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }
  .bottom-actions {
    display: flex;
    gap: 8px;
  }
  .bottom-metrics .stats {
    font-size: 12px;
    color: var(--dim);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .context-below {
    background: rgba(167, 139, 250, 0.04);
    border: 1px solid rgba(167, 139, 250, 0.15);
    border-radius: 4px;
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .context-below .shown-ctx-head {
    font-size: 11px;
    margin-bottom: 2px;
  }
  .context-below .shown-ctx-item {
    font-size: 12px;
    padding: 1px 0;
  }
  .context-below .shown-ctx-item .p {
    max-width: 80%;
  }

  /* Make feed buttons more readable */
  .feed-ctx-row .feed-btn {
    font-size: 11px;
    padding: 3px 10px;
    min-height: 26px;
  }
  .context-below {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: 4px 8px;
    background: rgba(167,139,250,0.04);
    border: 1px solid rgba(167,139,250,0.15);
    border-radius: 4px;
  }

  .mode-indicator {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    margin: 4px 0 10px;
    padding: 3px 8px;
    background: rgba(42,42,58,0.4);
    border: 1px solid rgba(42,42,58,0.6);
    border-radius: 4px;
    display: inline-block;
  }
  .mode-indicator strong { color: var(--lavend); font-weight: 600; }

  /* chat-mode-bar: modes listed directly underneath chat (Solo/Dual/VS/Supervision).
     Matches gemma-code's .chat-mode-bar in ChatComposer for consistent "under chat" UX. */
  .chat-mode-bar { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(42,42,58,0.4); }
  .chat-mode-bar button { background: rgba(28,33,40,0.6); border: 1px solid rgba(42,42,58,0.5); color: var(--text-secondary); padding: 5px 12px; border-radius: 4px; font-size: 13px; font-family: var(--font-mono); cursor: pointer; min-height: 30px; }
  .chat-mode-bar button.active { background: var(--bg-elevated); color: var(--text); border-color: rgba(167,139,250,0.4); font-weight: 600; }
  .chat-mode-bar button:hover { color: var(--text); background: rgba(42,42,58,0.5); }

  /* Editor tabs (Context / Prompt / Memory / Source / Kv / etc.)
     Ported from gemma-code reference (~/.worktrees/unified-pkg/src/app/App.svelte).
     These .editor-* and .ctx-* rules were stripped during prior CSS cleanup
     (see comments about unused selectors and self-contained tab styles).
     The Context page (and sibling editor tabs) were left with broken/no layout.
     Shared via global styles here for the multiple tabs that use <main class="editor-main"> + .editor-header.
  */
  /* Shared editor tab base styles (for modular child components like ContextTab, PromptTab etc.)
     Must use :global() because these classes are rendered inside separate Svelte components,
     not directly in App.svelte's template (unlike the monolithic version in gemma-code worktree).
     Plain rules here would only apply to elements directly in App's markup. */
  :global(.editor-main) { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  :global(.editor-header) {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono); border-bottom: 1px solid rgba(42, 42, 58, 0.4);
  }

  :global(.ctx-list) { flex: 1; overflow-y: auto; padding: 14px 20px; }
  :global(.ctx-entry) {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 6px;
    background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    border-radius: 8px; cursor: grab; font-family: var(--font-mono); font-size: 12px;
  }
  :global(.ctx-entry.dragging) { opacity: 0.4; border-color: #2dd4bf; }
  :global(.ctx-entry .grip) { color: var(--dim); cursor: grab; }
  :global(.ctx-entry .kind) {
    font-size: 10px; padding: 1px 7px; border-radius: 5px; text-transform: uppercase;
    background: rgba(45, 212, 191, 0.12); color: #2dd4bf;
  }
  :global(.ctx-entry .kind.prompt) { background: rgba(167, 139, 250, 0.14); color: #a78bfa; }
  :global(.ctx-entry .kind.memory) { background: rgba(240, 136, 62, 0.14); color: #f0883e; }
  :global(.ctx-entry .kind.dir) { background: rgba(96, 165, 250, 0.14); color: #60a5fa; }
  :global(.ctx-entry .path) { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :global(.ctx-entry .x) {
    background: transparent; border: none; color: var(--text-secondary);
    font-size: 14px; cursor: pointer; padding: 0 4px;
  }
  :global(.ctx-entry .x:hover) { color: #ef4444; }
  :global(.ctx-empty) { color: var(--dim); font-size: 12px; padding: 20px 0; text-align: center; }
  :global(.ctx-add-row) { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  :global(.ctx-add-input) {
    flex: 1; background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5); border-radius: 8px;
    padding: 6px 12px; font-size: 12px; font-family: var(--font-mono); outline: none;
  }
  :global(.ctx-hint) { color: var(--dim); font-size: 11px; line-height: 1.6; margin-top: 14px; }

  :global(.save-btn) {
    background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4);
    color: #34d399; padding: 4px 12px; border-radius: 5px; cursor: pointer;
    font-size: 11px; font-family: var(--font-mono);
  }
  :global(.reload-btn) {
    background: rgba(28, 33, 40, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary); padding: 4px 12px; border-radius: 5px;
    cursor: pointer; font-size: 11px; font-family: var(--font-mono);
    transition: all 150ms ease;
  }
  :global(.dirty) { color: var(--warn); font-size: 11px; }
  :global(.status) { color: var(--green); font-size: 11px; transition: opacity 300ms; }

  /* Source tab styles (added for consistency with ContextTab fix; :global() so they apply
     inside modular <SourceTab> component and any monolithic sections. Directly ported from
     gemma-code reference as requested. We only edit bro-code here.) */
  :global(.source-main) { flex: 1; display: flex; min-height: 0; }

  :global(.src-files) {
    width: 250px; flex-shrink: 0; overflow-y: auto; padding: 10px 0;
    border-right: 1px solid rgba(42, 42, 58, 0.5); background: rgba(13, 17, 23, 0.6);
    font-family: var(--font-mono); font-size: 11px;
  }

  :global(.src-file) {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 14px; color: var(--text-secondary); cursor: pointer;
  }

  :global(.src-file-name) { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  :global(.src-add) {
    visibility: hidden; background: transparent; border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 5px; color: #2dd4bf; font-size: 11px; line-height: 1;
    padding: 1px 6px; cursor: pointer; flex-shrink: 0;
  }

  :global(.src-file:hover .src-add) { visibility: visible; }

  :global(.src-add:hover) { background: rgba(45, 212, 191, 0.12); }

  :global(.src-file:hover) { color: var(--text); background: rgba(255, 255, 255, 0.04); }

  :global(.src-file.active) { color: #2dd4bf; background: rgba(45, 212, 191, 0.08); }

  :global(.src-editor) { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  :global(.src-wrap) { flex: 1; position: relative; overflow: hidden; background: #0d1117; }

  :global(.src-highlight), :global(.src-input) {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    padding: 16px 20px; margin: 0;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.5;
    white-space: pre; tab-size: 2; letter-spacing: 0;
    border: none; border-radius: 0; outline: none; overflow: auto; box-shadow: none;
  }

  :global(.src-highlight) { color: #c9d1d9; pointer-events: none; background: #0d1117; z-index: 0; }

  :global(.src-input) {
    color: transparent; caret-color: #2dd4bf; background: transparent;
    -webkit-text-fill-color: transparent; resize: none; z-index: 1;
  }

  :global(.src-input:focus) { border: none; box-shadow: none; }

  .input-row {
    padding: 8px;
    border-top: 1px solid rgba(42,42,58,0.3);
  }

  /* Settings specific styles are provided exclusively by the SettingsTab component's own <style> (self-contained).
     All global duplicates have been excised. This fixes the CSS parse error and the Svelte unused-selector warnings.
     Editor tab styles (.editor-main, .editor-header, .ctx-*, shared buttons etc.) are defined just above (ported from gemma-code reference to fix the broken context page and peer tabs). */

  /* ── Footer / Input ── */
  footer {
    padding: 0; /* let inner elements control padding for full width on large desktop */
    background: linear-gradient(180deg, var(--bg-primary) 0%, #0a0c12 100%);
    border-top: 1px solid rgba(42, 42, 58, 0.4);
    flex-shrink: 0;
  }
  .input-row {
    padding: 8px 32px; /* match chat-main side padding for aligned width on large desktop */
    border-top: 1px solid rgba(42,42,58,0.3);
  }
  textarea, .term-input {
    width: 100%; background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5); border-radius: 10px;
    padding: 12px 16px; font-size: 14px; font-family: var(--font-sans);
    resize: none; outline: none; line-height: 1.5;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  .settings-subnav button {
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    cursor: pointer;
    transition: all 120ms ease;
  }
  .settings-subnav button.active {
    background: var(--bg-elevated);
    color: var(--text);
    border-color: rgba(167, 139, 250, 0.4);
  }
  .settings-subnav button:hover:not(.active) {
    color: var(--text);
    background: rgba(42, 42, 58, 0.3);
  }

  .settings-body {
    padding: 8px 4px;
  }
  .settings-body.endpoints-section,
  .settings-body.appearance-section,
  .settings-body.agent-section,
  .settings-body.panes-section,
  .settings-body.advanced-section {
    background: rgba(16, 17, 26, 0.4);
    border-radius: 6px;
    padding: 12px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .section-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .section-hint {
    font-size: 10px;
    color: var(--dim);
    margin-top: 2px;
    max-width: 420px;
    line-height: 1.3;
  }

  .endpoint-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 5px;
    background: rgba(22, 23, 34, 0.6);
    font-size: 11px;
  }
  .endpoint-row.active {
    border-color: var(--lavend);
    background: rgba(167, 139, 250, 0.08);
  }
  .endpoint-row.dragging {
    opacity: 0.6;
  }

  .priority-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 58px;
  }
  .drag-grip {
    cursor: grab;
    color: var(--dim);
    font-size: 13px;
    padding: 0 3px;
  }
  .icon-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    width: 16px;
    height: 16px;
    border-radius: 3px;
    font-size: 9px;
    line-height: 1;
    cursor: pointer;
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .priority-num {
    font-size: 10px;
    color: var(--dim);
    margin-left: 4px;
    min-width: 12px;
  }

  .ep-info {
    flex: 1;
    min-width: 0;
  }
  .ep-name {
    font-weight: 600;
    color: var(--text);
    font-size: 11px;
  }
  .ep-url {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ep-model {
    font-size: 10px;
    color: var(--text-secondary);
  }
  .ep-model span {
    color: var(--text);
  }

  .ep-status {
    font-size: 10px;
    min-width: 120px;
  }
  .health-ok { color: var(--green); }
  .health-bad { color: var(--red); }

  .ep-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .small-btn {
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .small-btn:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }
  .small-btn.danger {
    color: var(--red);
    border-color: rgba(239,68,68,0.3);
  }
  .small-btn.test-btn.testing { opacity: 0.6; }

  .endpoint-form {
    margin-top: 12px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(16,17,26,0.5);
  }
  .form-title {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--text-secondary);
  }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    margin-bottom: 6px;
  }
  .form-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .form-hint {
    font-size: 9px;
    color: var(--dim);
    margin-top: 6px;
    line-height: 1.3;
  }

  .setting {
    margin-bottom: 10px;
  }
  .setting-label {
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 3px;
  }
  .setting-input {
    background: var(--bg-secondary);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    font-family: var(--font-mono);
    width: 100%;
  }
  .setting-input.small {
    width: auto;
    min-width: 70px;
  }
  .setting-hint {
    font-size: 9px;
    color: var(--dim);
    margin-top: 2px;
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .segmented button {
    background: rgba(28,33,40,0.6);
    border: none;
    color: var(--text-secondary);
    padding: 3px 9px;
    font-size: 10px;
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .segmented button.active {
    background: var(--bg-elevated);
    color: var(--text);
  }
  .segmented button + button {
    border-left: 1px solid var(--border);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .toggle input[type="checkbox"] {
    display: none;
  }
  .toggle-slider {
    width: 28px;
    height: 14px;
    background: var(--border);
    border-radius: 999px;
    position: relative;
    transition: background 120ms;
    flex-shrink: 0;
  }
  .toggle input:checked + .toggle-slider {
    background: var(--lavend);
  }
  .toggle-slider::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 1px;
    width: 12px;
    height: 12px;
    background: var(--text);
    border-radius: 50%;
    transition: transform 120ms;
  }
  .toggle input:checked + .toggle-slider::after {
    transform: translateX(14px);
  }
  .toggle-label {
    color: var(--text-secondary);
  }

  .save-btn, .reload-btn, .small-btn {
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-family: var(--font-mono);
    cursor: pointer;
    transition: all 120ms ease;
  }
  .save-btn:hover, .reload-btn:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }
  .save-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .empty {
    color: var(--dim);
    font-size: 11px;
    padding: 8px 0;
  }

  .danger-zone {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid var(--red);
  }

  .meta {
    font-size: 9px;
    color: var(--dim);
    margin-left: auto;
  }

  .input-row {
    padding: 8px;
    border-top: 1px solid rgba(42,42,58,0.3);
  }

  /* ── Footer / Input ── */
  footer {
    padding: 10px 20px 14px;
    background: linear-gradient(180deg, var(--bg-primary) 0%, #0a0c12 100%);
    border-top: 1px solid rgba(42, 42, 58, 0.4); flex-shrink: 0;
  }
  textarea, .term-input {
    width: 100%; background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5); border-radius: 10px;
    padding: 12px 16px; font-size: 14px; font-family: var(--font-sans);
    resize: none; outline: none; line-height: 1.5;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }
  textarea:focus, .term-input:focus {
    border-color: rgba(167, 139, 250, 0.5);
    box-shadow: 0 0 12px rgba(139, 92, 246, 0.08);
  }
  textarea::placeholder, .term-input::placeholder { color: var(--dim); }
  textarea:disabled, .term-input:disabled { opacity: 0.4; }

  /* ── Markdown ── */
  .markdown :global(h1), .markdown :global(h2), .markdown :global(h3) { color: var(--lavend); margin: 14px 0 8px; font-weight: 600; }
  .markdown :global(h1) { font-size: 18px; } .markdown :global(h2) { font-size: 16px; } .markdown :global(h3) { font-size: 14px; }
  .markdown :global(p) { margin: 8px 0; }
  .markdown :global(code) {
    font-family: var(--font-mono); font-size: 12.5px;
    background: rgba(28, 33, 40, 0.8); padding: 2px 6px;
    border-radius: 4px; color: var(--sky);
  }
  .markdown :global(pre) {
    background: rgba(28, 33, 40, 0.6); border: 1px solid rgba(42, 42, 58, 0.4);
    border-radius: 8px; padding: 14px 16px; margin: 10px 0; overflow-x: auto;
  }
  .markdown :global(pre code) { background: none; padding: 0; font-size: 13px; line-height: 1.6; }
  .markdown :global(ul), .markdown :global(ol) { padding-left: 22px; margin: 8px 0; }
  .markdown :global(li) { margin: 4px 0; line-height: 1.6; }
  .markdown :global(blockquote) {
    border-left: 2px solid rgba(139, 92, 246, 0.4); padding-left: 14px;
    color: var(--text-secondary); margin: 10px 0; font-style: italic;
  }
  .markdown :global(strong) { color: var(--text); font-weight: 600; }
  .markdown :global(a) { color: var(--blue); text-decoration: none; }
  .markdown :global(a:hover) { text-decoration: underline; }
  .markdown :global(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

  /* ── Prompt editor ── */
  .editor-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .editor-header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono); border-bottom: 1px solid rgba(42, 42, 58, 0.4);
  }
  .dirty { color: var(--warn); font-size: 11px; }
  .status { color: var(--green); font-size: 11px; transition: opacity 300ms; }
  .save-btn, .reload-btn {
    background: rgba(28, 33, 40, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary); padding: 4px 12px; border-radius: 5px;
    cursor: pointer; font-size: 11px; font-family: var(--font-mono);
    transition: all 150ms ease;
  }
  .save-btn:hover, .reload-btn:hover { background: var(--bg-elevated); color: var(--text); }
  .save-btn:disabled { opacity: 0.2; cursor: default; }
  .prompt-overlay-wrap {
    flex: 1; position: relative; overflow: hidden;
    background: linear-gradient(180deg, var(--bg-primary) 0%, #080a0f 100%);
  }
  .prompt-highlight, .prompt-input {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    padding: 24px 28px; margin: 0;
    font-family: var(--font-mono); font-size: 13px; line-height: 1.9;
    white-space: pre-wrap; word-wrap: break-word;
    letter-spacing: 0.2px; border: none; border-radius: 0; outline: none;
    overflow-y: auto; box-shadow: none;
  }
  .prompt-highlight {
    color: var(--text-secondary); pointer-events: none;
    background: transparent; z-index: 0;
  }
  .prompt-input {
    color: transparent; caret-color: var(--lavend);
    background: transparent; resize: none;
    -webkit-text-fill-color: transparent;
    z-index: 1;
  }
  .prompt-input:focus {
    border: none; border-color: transparent;
    box-shadow: inset 0 0 60px rgba(139, 92, 246, 0.03);
  }
  .prompt-highlight :global(.hl-heading) {
    color: var(--lavend); font-weight: 600;
    text-shadow: 0 0 14px rgba(167, 139, 250, 0.35);
  }
  .prompt-highlight :global(.hl-bold) {
    color: var(--text); font-weight: 600;
    text-shadow: 0 0 10px rgba(212, 212, 216, 0.12);
  }
  .prompt-highlight :global(.hl-code) {
    color: var(--sky); background: rgba(28, 33, 40, 0.7);
    padding: 1px 5px; border-radius: 3px;
    text-shadow: 0 0 8px rgba(122, 184, 255, 0.25);
  }
  .prompt-highlight :global(.hl-list) {
    color: var(--green);
    text-shadow: 0 0 10px rgba(52, 211, 153, 0.2);
  }
  .prompt-highlight :global(.hl-quote) {
    color: var(--dim); font-style: italic;
  }

  /* ── Memory ── */
  .memory-list { flex: 1; overflow-y: auto; padding: 12px 20px; }
  .mem-cell {
    padding: 12px 14px; margin-bottom: 2px;
    border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    transition: background 150ms ease;
  }
  .mem-cell:hover { background: rgba(167, 139, 250, 0.03); }
  .mem-key { font-weight: 600; color: var(--warn); font-size: 12px; margin-bottom: 5px; font-family: var(--font-mono); letter-spacing: 0.3px; }
  .mem-tags { color: var(--dim); font-size: 10px; margin-left: 8px; font-weight: 400; }
  .badge { font-size: 10px; margin-left: 4px; }
  .mem-value { color: var(--text-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; opacity: 0.8; }
  .empty { color: var(--dim); padding: 40px; text-align: center; font-size: 13px; }

  /* ── Tools ── */
  .tools-list { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
  .tool-card {
    padding: 14px 18px; cursor: pointer;
    background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(42, 42, 58, 0.4);
    border-radius: 8px; transition: all 150ms ease;
  }
  .tool-card:hover { background: rgba(22, 27, 34, 0.9); border-color: rgba(139, 92, 246, 0.3); transform: translateY(-1px); }
  .tool-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .tool-icon { font-size: 14px; opacity: 0.5; }
  .tool-name { color: var(--green); font-weight: 600; font-size: 14px; font-family: var(--font-mono); }
  .tool-lang {
    color: var(--dim); font-size: 10px; font-family: var(--font-mono);
    background: rgba(42, 42, 58, 0.5); padding: 1px 6px; border-radius: 3px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .tool-desc { color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 8px; }
  .tool-meta { display: flex; gap: 12px; flex-wrap: wrap; }
  .tool-stat { color: var(--dim); font-size: 11px; font-family: var(--font-mono); }
  .tool-stat.rate.good { color: var(--green); }
  .tool-stat.rate.bad { color: var(--red); }
  .tool-stat.err { color: var(--red); opacity: 0.8; }
  .tool-source {
    flex: 1; overflow-y: auto; padding: 20px 24px; margin: 0;
    font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
    background: #0a0c10; color: var(--text); white-space: pre-wrap;
    border: none;
  }
  .error-text { color: var(--red); }

  /* ── Transcripts ── */
  .transcript-list { flex: 1; overflow-y: auto; padding: 8px 20px; }
  .transcript-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; cursor: pointer;
    border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    transition: background 150ms ease;
  }
  .transcript-row:hover { background: rgba(167, 139, 250, 0.04); }
  .transcript-name { color: var(--lavend); font-size: 13px; font-family: var(--font-mono); }
  .transcript-date { color: var(--dim); font-size: 11px; }
  .transcript-view { flex: 1; overflow-y: auto; padding: 16px 24px; }
  .transcript-msg { margin-bottom: 16px; max-width: 780px; }
  .transcript-msg.user .transcript-role { color: var(--blue); font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  .transcript-msg.assistant .transcript-role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  .transcript-text { color: var(--text); font-size: 14px; line-height: 1.6; padding: 8px 12px; background: var(--bg-secondary); border-radius: 8px; }

  /* ── Terminal ── */
  .term-main {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    font-family: var(--font-mono); font-size: 13px;
    background: #0a0c10;
  }
  .term-output { display: flex; flex-direction: column; gap: 1px; }
  .term-line { color: var(--text); line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
  .term-line.dim { color: var(--dim); }
  .term-prompt { display: flex; align-items: center; gap: 10px; }
  .term-ps1 { color: var(--green); font-family: var(--font-mono); font-size: 13px; font-weight: 600; flex-shrink: 0; }
  .term-input {
    border-radius: 0; border: none; border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    background: transparent; font-family: var(--font-mono); font-size: 13px;
  }

  /* ── hljs One Dark ── */
  :global(.hljs) { color: #abb2bf; }
  :global(.hljs-keyword) { color: #c678dd; } :global(.hljs-string) { color: #98c379; }
  :global(.hljs-number) { color: #d19a66; } :global(.hljs-comment) { color: #5c6370; font-style: italic; }
  :global(.hljs-function), :global(.hljs-title) { color: #61afef; }
  :global(.hljs-built_in), :global(.hljs-type) { color: #e5c07b; }
  :global(.hljs-attr) { color: #d19a66; } :global(.hljs-variable) { color: #e06c75; }

  /* ============================================
     MOBILE RESPONSIVE STYLES (entire UI)
     Targets phones + small tablets. Desktop unchanged.
     Covers host App + all :global() modular tab styles.
  ============================================ */
  @media (max-width: 768px) {
    .app {
      height: 100dvh; /* dynamic viewport for mobile browsers */
    }
    /* Boost base readability on mobile - prevents "everything small" feel */
    body, .app {
      font-size: 15px;
    }

    /* Header: tighter, scrollable nav for the many tabs */
    header {
      height: 48px;
      padding: 0 10px;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .title {
      font-size: 15px;
    }
    .web-mode-banner {
      font-size: 11px;
      padding: 1px 5px;
      margin-left: 3px;
    }
    nav {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      flex-wrap: nowrap;
      scrollbar-width: none;
      width: 100%;
    }
    nav::-webkit-scrollbar { display: none; }
    nav button {
      flex-shrink: 0;
      font-size: 11px;
      padding: 5px 8px;
      min-height: 32px;
    }
    .meta {
      display: none;
    }

    /* Main chat / editor content */
    .chat-main {
      padding: 16px 18px;
    }
    .message {
      max-width: 100%;
    }
    .user-content {
      font-size: 15px;
      padding: 10px 12px;
    }
    .message.assistant .content {
      font-size: 15px;
    }
    .splash {
      height: 45vh;
    }
    .logo {
      font-size: 12px;
    }
    .tagline {
      font-size: 13px;
      margin-top: 12px;
    }

    /* Mode bar under chat */
    .chat-mode-bar {
      padding: 8px 10px;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chat-mode-bar button {
      font-size: 11px;
      padding: 3px 8px;
      min-height: 32px;
    }

    /* Split layouts (chat+term, dual etc) -> stack on mobile */
    .split {
      flex-direction: column !important;
    }
    .chat-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    /* Footer / composer input - touch friendly */
    footer {
      padding: 10px 12px 12px;
    }
    textarea, .term-input {
      font-size: 16px;
      padding: 12px 14px;
      min-height: 48px;
      border-radius: 10px;
    }

    /* Editor / context / prompt / source / memory etc. (via :global) */
    :global(.editor-header) {
      padding: 10px 14px;
      font-size: 12px;
      gap: 10px;
      flex-wrap: wrap;
    }
    :global(.ctx-list) {
      padding: 12px 14px;
    }
    :global(.ctx-entry) {
      padding: 8px 10px;
      font-size: 13px;
    }
    :global(.ctx-add-input) {
      font-size: 14px;
    }
    :global(.src-files) {
      width: 100% !important;
      max-height: 160px;
      border-right: none;
      border-bottom: 1px solid rgba(42, 42, 58, 0.5);
      overflow-x: hidden;
    }
    :global(.src-file) {
      padding: 4px 10px;
      font-size: 12px;
    }
    :global(.src-highlight), :global(.src-input),
    :global(.prompt-highlight), :global(.prompt-input) {
      padding: 14px 16px;
      font-size: 13px;
    }
    :global(.memory-list) {
      padding: 10px 14px;
    }
    :global(.tools-list) {
      padding: 12px 14px;
    }
    .tool-card {
      padding: 12px 14px;
    }
    .tool-name { font-size: 15px; }
    .tool-desc { font-size: 14px; }

    /* Settings - generous and readable even on mobile */
    .settings-body {
      padding: 10px 6px;
    }
    .settings-body.endpoints-section,
    .settings-body.appearance-section,
    .settings-body.agent-section,
    .settings-body.panes-section,
    .settings-body.advanced-section {
      padding: 16px;
    }
    .settings-body.endpoints-section {
      padding-left: 4px;
      padding-right: 4px;
    }
    .form-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .endpoint-row {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
      padding: 12px;
      width: 100%;
      box-sizing: border-box;
    }
    .ep-info { width: 100%; }
    .ep-actions {
      width: 100%;
      justify-content: space-between;
      margin-top: 4px;
    }
    .ep-status {
      min-width: auto;
      font-size: 13px;
      order: -1;
    }
    .ep-name { font-size: 15px; }
    .ep-url, .ep-model {
      font-size: 13px;
      max-width: 100%;
    }
    .ep-models { max-width: 100%; }
    .priority-controls {
      min-width: auto;
      width: 100%;
      justify-content: flex-start;
      margin-bottom: 4px;
    }
    .icon-btn {
      width: 22px;
      height: 22px;
      font-size: 12px;
    }
    .setting-input {
      font-size: 15px;
      padding: 8px 12px;
    }
    .setting-label { font-size: 15px; }
    .setting-hint { font-size: 13px; }
    .segmented button {
      padding: 8px 12px;
      font-size: 13px;
      min-height: 38px;
    }

    /* Subtabs (Settings) fill full width on mobile, prevent bleed */
    :global(.settings-subnav) {
      width: 100%;
      display: flex;
      gap: 2px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    :global(.settings-subnav button) {
      flex: 1 0 auto;
      min-width: 0;
      font-size: 10px;
      padding: 4px 6px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Mobile chat subnav - full width, fits under main tabs */
    .mobile-chat-subnav {
      display: flex;
      width: 100%;
      gap: 2px;
      padding: 4px 8px;
      background: rgba(42, 42, 58, 0.3);
      border-bottom: 1px solid rgba(42, 42, 58, 0.4);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .mobile-chat-subnav button {
      flex: 1 0 auto;
      font-size: 11px;
      padding: 4px 8px;
      min-height: 32px;
      border-radius: 4px;
      background: rgba(28, 33, 40, 0.6);
      border: 1px solid rgba(42, 42, 58, 0.5);
      color: var(--text-secondary);
      cursor: pointer;
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .mobile-chat-subnav button.active {
      background: var(--bg-elevated);
      color: var(--text);
      border-color: rgba(167, 139, 250, 0.4);
    }

    /* General content tightening */
    .input-row {
      padding: 8px 10px;
    }
    .exec-card {
      font-size: 13px;
    }
    .ctx-bar {
      font-size: 12px;
      padding: 4px 10px;
    }
    .stats {
      font-size: 12px;
    }

    /* Mobile adjustments for post-prompt / ctx */
    .post-prompt-bar {
      gap: 6px;
      font-size: 12px;
    }
    .ctx-bar {
      font-size: 12px;
      padding: 4px 0;
    }
    .ctx-track {
      height: 6px;
    }
    .bottom-metrics {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .bottom-actions {
      flex-wrap: wrap;
    }
    .context-below .shown-ctx-item .p {
      max-width: 100%;
    }

    /* Markdown / pre blocks */
    .markdown :global(pre) {
      padding: 12px 14px;
      font-size: 13px;
    }
    .markdown :global(code) {
      font-size: 13px;
    }

    /* Empty states, hints */
    .empty {
      font-size: 13px;
      padding: 24px 0;
    }
    .form-hint {
      font-size: 11px;
    }
  }

  /* Extra small phones */
  @media (max-width: 480px) {
    header {
      height: 46px;
    }
    nav button {
      padding: 4px 8px;
      font-size: 11px;
      min-height: 34px;
    }
    .chat-main {
      padding: 10px 12px;
    }
    .message .user-content,
    .message.assistant .content {
      font-size: 14px;
    }
    textarea, .term-input {
      font-size: 16px;
    }
    .src-files {
      max-height: 130px;
    }
    .small-btn {
      min-height: 30px;
      font-size: 10px;
    }
  }

  /* Bonus: make dual / multi-pane UIs (imported from bro-shared) stack nicely on mobile */
  :global(.dual-panes),
  :global(.vs-crosstalk),
  :global(.supervision-pane) {
    flex-direction: column !important;
  }
  :global(.chat-pane) {
    border-right: none !important;
    border-bottom: 1px solid rgba(42, 42, 58, 0.3);
  }

  /* Improve readability of text in multi-mode UIs (dual/vs/supervision) on desktop - larger labels, better contrast */
  :global(.pane-header),
  :global(.pane-label),
  :global(.dual-label) {
    font-size: 13px !important;
    color: var(--text-secondary) !important;
  }
  :global(.pane-header select) {
    font-size: 12px !important;
    padding: 4px 8px !important;
  }
  :global(.dual-input textarea) {
    font-size: 14px !important;
  }
</style>
