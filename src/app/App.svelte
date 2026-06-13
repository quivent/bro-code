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
    loadPrompt as libLoadPrompt,
    savePrompt as libSavePrompt,
    loadContext as libLoadContext,
    buildApiMessages as libBuildApiMessages,
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
    savePanesSettings,
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

  const ENDPOINT = config.endpoint; // legacy fallback
  const MODEL = config.model;       // legacy fallback
  const ENDPOINTS = config.endpoints || []; // still used for the dual demo toggle

  // NOTE: Primary inference endpoint is now driven by the Settings tab (dynamic + persisted).
  // See activeEndpoint / currentEndpoint derived below and the SettingsTab render.

  // Tauri invoke (falls back to no-op in browser)
  const isTauri = '__TAURI_INTERNALS__' in window;
  async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!isTauri) return null;
    return tauriInvoke(cmd, args);
  }

  // Debug marker to prove this exact source is running (bypasses any caching doubts).
  // Guarded so HMR doesn't spam the log on every hot update.
  if (typeof window !== 'undefined' && !(window as any).__bro_v1_logged) {
    (window as any).__bro_v1_logged = true;
    console.log('%c[bro-code v1] loaded at ' + new Date().toISOString(), 'color:#f0883e;font-weight:bold');
  }

  // Proactively clean any bad/dev endpoints (e.g. pointing at :5314 Vite server causing completions 404s)
  cleanBadEndpoints();

  // Dynamic endpoint + agent setup (Settings tab drives this)
  let unifiedAgent: any = $state(null);
  const agentCtx = setAgentContext();

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
    if (!isTauri) return;
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

  // Supporting state for modular context / agent init (minimal for integration)
  let ctxEntries: Array<{ kind: 'prompt' | 'memory' | 'file' | 'dir'; path: string }> = $state([
    { kind: 'prompt', path: PROMPT_FILE },
    { kind: 'memory', path: MEMORY_FILE },
  ]);
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
  // ctxUsedTokens ~ chars/4 estimate of what will be sent next
  // ctxPct for the visual bar
  let ctxWindow = $state<number | null>(null);

  let ctxUsedTokens = $derived(
    Math.ceil(
      (messages.reduce((a, m) => a + ((m.content || '').length), 0) + (currentResponse || '').length) / 4
    )
  );
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
    if (!isTauri) return;
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
    ctxEntries = [...ctxEntries, { kind, path: t }];
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
        ctxEntries = [...ctxEntries, { kind: directory ? 'dir' : 'file', path: t }];
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

  async function saveCtxSettings() {
    if (!isTauri) return;
    await invoke('set_setting', { key: 'ctxEntries', value: JSON.stringify(ctxEntries) }).catch(() => {});
  }

  async function loadCtxSettings() {
    try {
      const raw = await invoke('get_setting', { key: 'ctxEntries' });
      if (raw) ctxEntries = JSON.parse(raw as string);
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
  let memCells: Array<{key: string; value: string; tags?: string[]; pinned?: boolean; anchored?: boolean}> = $state([]);
  let memStatus = $state('');
  let memLoaded = $state(false);

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

  // ── Execute organ / !sh approval (same as gemma-code for the modular agent send)
  let pendingExec = $state<{ cmd: string } | null>(null);
  let execResolver: ((ok: boolean) => void) | null = null;
  let execAlwaysAllow = $state(false);

  function requestApproval(cmd: string): Promise<boolean> {
    if (execAlwaysAllow) return Promise.resolve(true);
    return new Promise((resolve) => {
      pendingExec = { cmd };
      execResolver = resolve;
    });
  }

  function answerExec(ok: boolean, always = false) {
    if (always && ok) execAlwaysAllow = true;
    const r = execResolver;
    pendingExec = null;
    execResolver = null;
    r?.(ok);
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

      const result = await uAgent.send(text, {
        onUpdate: (partial: any) => {
          currentResponse = partial.response || '';
          currentThinking = partial.thinking || '';
          tokenCount = partial.tokens || 0;
          scrollToBottom(chatContainer);
        },
        onExecApproval: (cmd: string) => requestApproval(cmd),
        // Pass history so the agent owns the full loop (including previous exec results, memory injection via its context, etc.)
        history: messages.map(m => ({ role: m.role, content: m.content, thinking: m.thinking, exec: m.exec })),
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
  let sessionId = Date.now().toString(36);

  async function saveTranscript() {
    if (!isTauri || messages.length < 2) return;
    await invoke('run_shell', { cmd: `mkdir -p ${config.homeDir}/transcripts` }).catch(() => {});
    const path = `${config.homeDir}/transcripts/${new Date().toISOString().slice(0,10)}_${sessionId}.json`;
    const data = JSON.stringify(messages.map(m => ({ ...m, ts: new Date().toISOString() })), null, 2);
    await invoke('write_file', { path, content: data }).catch(() => {});
  }

  async function loadTranscripts() {
    try {
      const raw = await invoke('run_shell', { cmd: `ls -t ${config.homeDir}/transcripts/*.json 2>/dev/null | head -20` }) || '';
      transcripts = raw.trim().split('\n').filter((l: string) => l).map((path: string) => {
        const name = path.split('/').pop()?.replace('.json', '') || path;
        const date = name.slice(0, 10);
        return { name, path, date };
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
    sessionId = Date.now().toString(36); // new session for further saves
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
    <nav>
      <button class:active={activeTab === 'chat'} onclick={() => activeTab = 'chat'}>chat</button>
      <button class:active={activeTab === 'prompt'} onclick={() => activeTab = 'prompt'}>prompt</button>
      <button class:active={activeTab === 'memory'} onclick={() => activeTab = 'memory'}>memory</button>
      <button class:active={activeTab === 'tools'} onclick={() => activeTab = 'tools'}>tools</button>
      <button class:active={activeTab === 'transcripts'} onclick={() => activeTab = 'transcripts'}>transcripts</button>
      <button class:active={activeTab === 'terminal'} onclick={() => activeTab = 'terminal'}>terminal</button>
      <button class:active={activeTab === 'context'} onclick={() => activeTab = 'context'}>context</button>
      <button class:active={activeTab === 'kv'} onclick={() => activeTab = 'kv'}>kv</button>
      <button class:active={activeTab === 'source'} onclick={() => activeTab = 'source'}>source</button>
      <button class:active={activeTab === 'settings'} onclick={() => activeTab = 'settings'}>settings</button>
      {#if ENDPOINTS.length >= 2}
        <button onclick={() => dualMode = !dualMode}>{dualMode ? 'single' : 'dual'}</button>
      {/if}
      {#if activeTab === 'chat'}
        <button onclick={() => chatTermSplit = !chatTermSplit}>{chatTermSplit ? 'chat only' : 'chat+term'}</button>
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

  <!-- Chat Tab -->
  {#if activeTab === 'chat'}
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
              <pre class="exec-out">{msg.exec.approved ? msg.exec.output : 'denied'}</pre>
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
            <div class="exec-approve-btns">
              <button class="exec-yes" onclick={() => answerExec(true)}>Run</button>
              <button class="exec-always" onclick={() => answerExec(true, true)}>Always this session</button>
              <button class="exec-no" onclick={() => answerExec(false)}>Deny</button>
            </div>
          </div>
        {/if}
        {#if error}<div class="error">✗ {error}</div>{/if}
        {#if !streaming && messages.length > 0}
          <div class="stats">{elapsed.toFixed(1)}s · {tokenCount} tok · {(tokenCount / Math.max(elapsed, 0.1)).toFixed(0)} tok/s</div>
        {/if}
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
  {:else if ENDPOINTS.length >= 2 && dualMode}
  <!-- Dual pane using shared component -->
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
  <main class="chat-main" bind:this={chatContainer}>
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
          <pre class="exec-out">{msg.exec.approved ? msg.exec.output : 'denied'}</pre>
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
        <div class="exec-approve-btns">
          <button class="exec-yes" onclick={() => answerExec(true)}>Run</button>
          <button class="exec-always" onclick={() => answerExec(true, true)}>Always this session</button>
          <button class="exec-no" onclick={() => answerExec(false)}>Deny</button>
        </div>
      </div>
    {/if}
    {#if error}<div class="error">✗ {error}</div>{/if}
    {#if !streaming && messages.length > 0}
      <div class="stats">{elapsed.toFixed(1)}s · {tokenCount} tok · {(tokenCount / Math.max(elapsed, 0.1)).toFixed(0)} tok/s</div>
    {/if}
  </main>
  {/if}
  <footer>
    <!-- Context bar placed in the footer (lowered towards the bottom, above the input).
         This is the position matching the gemma-code composer structure, which puts it right in the input area at the very bottom of the UI.
         Added a small margin-bottom so it's not jammed flush against the textarea (a bit of breathing room / "higher" from the absolute input edge). -->
    <div class="ctx-bar" style="margin-bottom: 6px;" title="Context usage for the next request (history + response so far). Estimated at ~4 chars per token. Window probed from the active inference server's /v1/models response (max_model_len or similar). Use Test in Settings to help populate the window size.">
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
    <div class="input-row">
      <textarea bind:this={inputEl} bind:value={inputText} onkeydown={chatKeydown}
        placeholder={`talk to ${config.name}...`} rows="2" disabled={streaming}></textarea>
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

  <!-- Memory Tab -->
  {:else if activeTab === 'memory'}
  <main class="editor-main">
    <div class="editor-header">
      <span>{config.homeDir}/memory.json</span>
      <span class="meta">{memCells.length} cells</span>
      {#if memStatus}<span class="status">{memStatus}</span>{/if}
      <button class="reload-btn" onclick={loadMemory}>reload</button>
    </div>
    <div class="memory-list">
      {#each memCells as cell}
        <div class="mem-cell">
          <div class="mem-key">
            {cell.key}
            {#if cell.pinned}<span class="badge pin">📌</span>{/if}
            {#if cell.anchored}<span class="badge anchor">⚓</span>{/if}
            {#if cell.tags?.length}<span class="mem-tags">{cell.tags.join(', ')}</span>{/if}
          </div>
          <div class="mem-value">{cell.value.length > 200 ? cell.value.slice(0, 200) + '…' : cell.value}</div>
        </div>
      {/each}
      {#if !memCells.length}
        <div class="empty">(no memory cells)</div>
      {/if}
    </div>
  </main>

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
            <span class="transcript-date">{t.date}</span>
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
    settingsSection={'endpoints'}
    onSection={() => {}}
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
  .ctx-label { font-weight: 600; letter-spacing: 0.5px; }
  .ctx-track { flex: 1; height: 4px; background: rgba(42,42,58,0.4); border-radius: 2px; overflow: hidden; }
  .ctx-fill { height: 100%; background: var(--lavend); transition: width 200ms ease; }
  .ctx-fill.warn { background: #fbbf24; }
  .ctx-fill.crit { background: #f87171; }
  .ctx-text { font-size: 10px; }

  .input-row {
    padding: 8px;
    border-top: 1px solid rgba(42,42,58,0.3);
  }

  /* Settings specific styles are provided exclusively by the SettingsTab component's own <style lang="postcss"> (self-contained).
     All global duplicates have been excised. This fixes the CSS parse error ("Expected a valid CSS identifier" at bare "display" after the comment) and the Svelte unused-selector warnings.
     The .editor-main and .editor-header rules (defined earlier in this <style>) will style the outer container/header inside the component. */

  /* ── Footer / Input ── */
  footer {
    padding: 10px 20px 14px;
    background: linear-gradient(180deg, var(--bg-primary) 0%, #0a0c12 100%);
    border-top: 1px solid rgba(42, 42, 58, 0.4);
    flex-shrink: 0;
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
</style>
