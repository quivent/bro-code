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

  const ENDPOINT = config.endpoint;
  const MODEL = config.model;
  const ENDPOINTS = config.endpoints || [];

  // Tauri invoke (falls back to no-op in browser)
  const isTauri = '__TAURI_INTERNALS__' in window;
  async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!isTauri) return null;
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke(cmd, args);
  }

  // ── State ──
  type Tab = 'chat' | 'prompt' | 'memory' | 'tools' | 'transcripts' | 'terminal';
  let activeTab: Tab = $state('chat');

  // Chat state
  interface Message { role: 'user' | 'assistant'; content: string; }
  let messages: Message[] = $state([]);
  let inputText = $state('');
  let streaming = $state(false);
  let currentResponse = $state('');
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
  async function send() {
    const text = inputText.trim();
    if (!text || streaming) return;
    if (!history.length || history[history.length - 1] !== text) history = [...history, text].slice(-50);
    histIdx = history.length;
    inputText = '';
    error = '';

    const isFirstMessage = messages.length === 0;
    messages = [...messages, { role: 'user', content: text }];
    scrollToBottom(chatContainer);
    streaming = true;
    currentResponse = '';
    tokenCount = 0;
    startTime = performance.now();
    elapsed = 0;
    timer = setInterval(() => { elapsed = (performance.now() - startTime) / 1000; }, 100);

    try {
      let apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

      // Auto-inject pinned/anchored memory on the very first message of a fresh chat session.
      // This connects "Bro" to his persistent memory cells without the user having to paste it manually.
      if (isFirstMessage) {
        if (!memLoaded) {
          await loadMemory();
        }
        const pinnedMems = memCells.filter(c => c.pinned || c.anchored);
        if (pinnedMems.length > 0) {
          const memText = pinnedMems.map(c => `${c.key}:\n${c.value}`).join('\n\n---\n\n');
          apiMessages = [
            {
              role: 'system',
              content: `Your current persistent memory cells (auto-loaded at the start of this chat session from the Memory tab):\n\n${memText}\n\nTreat these as your long-term memory. Reference them, update them via tools when you learn new important facts, and stay consistent with them. The Memory tab in the UI reflects the live cells in ~/bro/memory.json.`
            },
            ...apiMessages
          ];
        }
      }

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: apiMessages,
          max_tokens: 4096, temperature: 0.7, stream: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sseDone = false;
      while (!sseDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') { sseDone = true; break; }
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) { currentResponse += delta; tokenCount++; scrollToBottom(chatContainer); }
          } catch {}
        }
      }
      messages = [...messages, { role: 'assistant', content: currentResponse }];
      saveTranscript();
    } catch (e: any) {
      error = e.message || 'Connection failed';
    } finally {
      if (timer) clearInterval(timer);
      elapsed = (performance.now() - startTime) / 1000;
      streaming = false;
      currentResponse = '';
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
      {#if ENDPOINTS.length >= 2}
        <button onclick={() => dualMode = !dualMode}>{dualMode ? 'single' : 'dual'}</button>
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
  {#if ENDPOINTS.length >= 2 && dualMode}
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
      <div class="message {msg.role}">
        <div class="role">{msg.role === 'user' ? '▸ you' : config.assistantLabel}</div>
        {#if msg.role === 'assistant'}
          <div class="content markdown">{@html renderMd(msg.content)}</div>
        {:else}
          <div class="content user-content">{msg.content}</div>
        {/if}
      </div>
    {/each}
    {#if streaming && currentResponse}
      <div class="message assistant">
        <div class="role">{config.assistantLabel}</div>
        <div class="content markdown">{@html renderMd(currentResponse)}</div>
      </div>
    {/if}
    {#if error}<div class="error">✗ {error}</div>{/if}
    {#if !streaming && messages.length > 0}
      <div class="stats">{elapsed.toFixed(1)}s · {tokenCount} tok · {(tokenCount / Math.max(elapsed, 0.1)).toFixed(0)} tok/s</div>
    {/if}
  </main>
  {/if}
  <footer>
    <textarea bind:this={inputEl} bind:value={inputText} onkeydown={chatKeydown}
      placeholder={`talk to ${config.name}...`} rows="2" disabled={streaming}></textarea>
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
