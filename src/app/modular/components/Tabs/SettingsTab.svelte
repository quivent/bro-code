<script lang="ts">
  import type { Endpoint } from '../../lib/types';
  import {
    settings as appSettings,
    loadSettings,
    saveAppearance,
    saveAgentSettings,
    saveAdvancedSettings,
    savePanesSettings,
    saveLocalPortAndSync,
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
    clearSettingsState,
    addLocalEndpoint,
    syncLocalEndpointPorts,
  } from '../../lib/settings-store.svelte.ts';

  // Settings tab in runes mode. Use $props() (with $bindable for fields the parent two-way binds via bind:).
  // This restores build + form functionality after incomplete store/runes port attempt.
  let {
    endpoints = [],
    settingsStatus = '',
    localPort = 8091,
    editingId = $bindable<string | null>(null),
    formName = $bindable(''),
    formUrl = $bindable(''),
    formModel = $bindable(''),
    testState = $bindable<Record<string, string>>({}),
    draggedIdx = $bindable<number | null>(null),
    activeEndpointId = null,
    settingsSection: _settingsSection = $bindable<'endpoints' | 'appearance' | 'agent' | 'panes' | 'advanced'>('endpoints'),
    // handlers (passed from host)
    onSection = (s: string) => {},
    onSaveAppearance = () => {},
    onSaveAgent = () => {},
    onSaveAdvanced = () => {},
    onSavePanes = () => {},
    onClearData = () => {},
    onRefreshAllHealth = () => {},
    onSaveLocalPort = () => {},
    onSyncLocalPorts = () => {},
    onAddEndpoint = () => {},
    onTestEndpoint = (ep: Endpoint) => {},
    onStartEdit = (ep: Endpoint) => {},
    onDeleteEndpoint = (id: string) => {},
    onSetActive = (id: string) => {},
    onMoveEndpoint = (id: string, dir: number) => {},
    onCancelEdit = () => {},
    onHandleDragStart = (i: number, e: DragEvent) => {},
    onHandleDragOver = (e: DragEvent) => {},
    onHandleDrop = (i: number) => {},
    onHandleDragEnd = () => {},
    onHandleEndpointFormSubmit = (e: Event) => {},
    onCheckLocalHealth = () => {},
    onResetApc = () => {},
    onLoadServeConfig = () => {},
    onAddLocalToEndpoints = () => {},
    onAddLocalEndpoint = () => {},
  } = $props();

  let settingsSection = $state(_settingsSection);

  // (aliases commented to avoid redeclaration conflict with added export let props for bind compatibility)
  // const endpoints = appSettings.endpoints;
  // const settingsStatus = appSettings.settingsStatus;
  // const localPort = appSettings.localPort;

  // Local section only (no need to lift to store)
  // (endpoints etc consumed directly via appSettings in template for reactivity)

  // Transient form/UI state provided via export let props (for parent bind: + internal binds).
  // Kick load defensive (if a store is partially active).

  // Kick a load if empty (defensive)
  $effect(() => {
    // if a store is present in scope it can be used; otherwise no-op
  });

  // on* provided via $props(). (store references may remain in other functions for hybrid state.)
  // Direct mutators / remaining cleaned for declaration conflicts.

  // Local helper for the + Local gemma button (was missing, causing JS error on click)
  function doAddLocal() {
    if (onAddLocalEndpoint) onAddLocalEndpoint();
    else if (onAddLocalToEndpoints) onAddLocalToEndpoints();
  }
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>settings</span>
    {#if appSettings.settingsStatus}<span class="status">{appSettings.settingsStatus}</span>{/if}
    <span class="meta">persisted via app settings</span>
  </div>

  <!-- Sub-tabs for more settings sections -->
  <div class="settings-subnav">
    <button 
      class:active={settingsSection === 'endpoints'} 
      onclick={() => onSection('endpoints')}>
      Endpoints
    </button>
    <button 
      class:active={settingsSection === 'appearance'} 
      onclick={() => onSection('appearance')}>
      Appearance
    </button>
    <button 
      class:active={settingsSection === 'agent'} 
      onclick={() => onSection('agent')}>
      Agent
    </button>
    <button 
      class:active={settingsSection === 'panes'} 
      onclick={() => onSection('panes')}>
      Panes
    </button>
    <button 
      class:active={settingsSection === 'advanced'} 
      onclick={() => onSection('advanced')}>
      Advanced
    </button>
  </div>

  {#if settingsSection === 'endpoints'}
  <div class="settings-body endpoints-section">
    <div class="section-header">
      <div>
        <div class="section-title">Registered Endpoints</div>
        <div class="section-hint">Drag or arrows to reorder priority (top = highest). For simple bases we auto-append the standard /v1/chat/completions. For remote or custom servers, paste the *exact full* working completions URL (it will be used as-is if it contains "completions"). Active endpoint powers chat + health.</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="reload-btn" onclick={onRefreshAllHealth}>Refresh all</button>
        {#if !appSettings.endpoints.some((e: any) => e.url && e.url.startsWith('http://127.0.0.1'))}
          <button class="reload-btn" onclick={doAddLocal} title="http://127.0.0.1:{appSettings.localPort} · mlx-community/gemma-4-31b-it-4bit">+ Local gemma</button>
        {/if}
        <button class="reload-btn" onclick={onAddEndpoint}>Add</button>
        <span style="margin-left:8px; opacity:0.8;">local port</span>
        <input type="number" bind:value={appSettings.localPort} min="1024" max="65535" style="width:62px; font-size:11px;" title="Port used for +Local and health (save+sync below)" />
        <button class="small-btn" onclick={() => { onSaveLocalPort(); onSyncLocalPorts(); }} title="Persist port and update any 127.0.0.1 Local endpoint(s) to this port">apply+sync</button>
      </div>
    </div>

    {#if appSettings.endpoints.length === 0}
      <div class="empty">No endpoints yet. Add one below.</div>
    {/if}

    {#each appSettings.endpoints as ep, i (ep.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="endpoint-row" 
        class:active={ep.id === appSettings.activeEndpointId}
        class:dragging={appSettings.draggedIdx === i}
        draggable="true"
        ondragstart={(e) => onHandleDragStart(i, e as any)}
        ondragover={onHandleDragOver}
        ondrop={() => onHandleDrop(i)}
        ondragend={onHandleDragEnd}
      >
        <div class="priority-controls">
          <span class="drag-grip" title="Drag to reorder priority">⠿</span>
          <button class="icon-btn" onclick={() => onMoveEndpoint(ep.id, -1)} disabled={i === 0}>↑</button>
          <button class="icon-btn" onclick={() => onMoveEndpoint(ep.id, 1)} disabled={i === endpoints.length-1}>↓</button>
          <span class="priority-num">{i + 1}</span>
        </div>

        <div class="ep-info">
          <div class="ep-name">{ep.name}</div>
          <div class="ep-url" title={ep.url}>{ep.url.length > 80 ? ep.url.slice(0, 77) + '…' : ep.url}</div>
          <div class="ep-model">model: <span>{ep.model}</span></div>
          {#if ep.availableModels && ep.availableModels.length}
            {#if !ep.availableModels.includes(ep.model)}
              <div class="ep-models" style="color:#f87171; font-size:9px;">
                ⚠ model not in server's list — re-Test & pick exact ID
              </div>
            {/if}
            <div class="ep-models" title="Click Test to refresh. Use exact ID from server in the model field.">
              server: {ep.availableModels.slice(0, 3).join(', ')}{ep.availableModels.length > 3 ? '…' : ''}
            </div>
          {/if}
        </div>

        <div class="ep-status">
          {#if ep.lastHealth}
            <span class={ep.lastHealth.ok ? 'health-ok' : 'health-bad'} title={ep.lastHealth.message}>
              {ep.lastHealth.ok ? '●' : '●'} {ep.lastHealth.message}
            </span>
          {/if}
        </div>

        <div class="ep-actions">
          <!-- Active logic handled in parent; simplified here -->
          <button class="small-btn" onclick={() => onSetActive(ep.id)}>Use</button>
          <button class="small-btn test-btn {appSettings.testState[ep.id] || ''}"
            disabled={appSettings.testState[ep.id] === 'testing'}
            onclick={() => onTestEndpoint(ep)}>
            {appSettings.testState[ep.id] === 'testing' ? 'testing…' : 'Test'}
          </button>
          <button class="small-btn" onclick={() => onStartEdit(ep)}>Edit</button>
          <button class="small-btn danger" onclick={() => onDeleteEndpoint(ep.id)}>×</button>
        </div>
      </div>
    {/each}

    <!-- Add / Edit form -->
    <div class="endpoint-form">
      <div class="form-title">
        {appSettings.editingId ? 'Edit Endpoint' : 'Add Endpoint'}
      </div>
      <form onsubmit={onHandleEndpointFormSubmit}>
        <div class="form-grid">
          <input class="setting-input" bind:value={appSettings.formName} placeholder="Name (e.g. Local Ollama)" />
          <input class="setting-input" bind:value={appSettings.formUrl} placeholder="https://example.com  or  https://example.com/v1  or full path" />
          {#if editingId}
            {@const ep = endpoints.find(e => e.id === editingId)}
            {#if ep?.availableModels?.length}
              <select class="setting-input" bind:value={appSettings.formModel}>
                {#each ep.availableModels as m}
                  <option value={m}>{m}</option>
                {/each}
              </select>
            {:else}
              <input class="setting-input" bind:value={appSettings.formModel} placeholder="Exact model ID (Test endpoint first — we'll auto-pick and validate from server's /v1/models list)" />
            {/if}
          {:else}
            <input class="setting-input" bind:value={appSettings.formModel} placeholder="Exact model ID (Test endpoint first — we'll auto-pick and validate from server's /v1/models list)" />
          {/if}
          {#if editingId}
            {@const ep = endpoints.find(e => e.id === editingId)}
            {#if ep?.availableModels?.length}
              <div class="form-models">
                <span class="models-label">Available on server (click to set full model ID):</span>
                {#each ep.availableModels as m}
                  <button type="button" class="model-chip" onclick={() => { appSettings.formModel = m; }}>
                    {m}
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
        <div class="form-actions">
          <button type="submit" class="save-btn">
            {editingId ? 'Save Changes' : 'Add'}
          </button>
          {#if appSettings.editingId}
            <button type="button" class="reload-btn" onclick={onCancelEdit}>Cancel</button>
          {/if}
        </div>
      </form>
      <div class="form-hint">
        You can paste a base (e.g. <code>https://example.com</code> or with <code>/v1</code>) and we infer /v1/chat/completions. For remote/custom setups, paste the *exact full* URL that works for your server (e.g. ending in <code>/v1/chat/completions</code> or whatever your remote uses); if it contains "completions" we trust the path exactly. Endpoints tried top-to-bottom.
      </div>
    </div>
  </div>

  {:else if settingsSection === 'appearance'}
  <div class="settings-body appearance-section">
    <div class="section-header">
      <div>
        <div class="section-title">Appearance</div>
        <div class="section-hint">Customize how the app looks and feels.</div>
      </div>
    </div>

    <div class="setting">
      <div class="setting-label">UI Density</div>
      <div class="segmented">
        <button class:active={appSettings.uiDensity === 'comfortable'} onclick={() => { appSettings.uiDensity = 'comfortable'; onSaveAppearance(); }}>Comfortable</button>
        <button class:active={appSettings.uiDensity === 'compact'} onclick={() => { appSettings.uiDensity = 'compact'; onSaveAppearance(); }}>Compact</button>
      </div>
      <div class="setting-hint">Affects padding and spacing throughout the interface.</div>
    </div>

    <div class="setting">
      <div class="setting-label">Chat Font Size</div>
      <div class="segmented">
        <button class:active={appSettings.chatFontSize === 'small'} onclick={() => { appSettings.chatFontSize = 'small'; onSaveAppearance(); }}>Small</button>
        <button class:active={appSettings.chatFontSize === 'medium'} onclick={() => { appSettings.chatFontSize = 'medium'; onSaveAppearance(); }}>Medium</button>
        <button class:active={appSettings.chatFontSize === 'large'} onclick={() => { appSettings.chatFontSize = 'large'; onSaveAppearance(); }}>Large</button>
      </div>
    </div>

    <div class="setting">
      <div class="setting-label">Accent Color</div>
      <div class="segmented">
        <button class:active={appSettings.accentColor === 'lavender'} onclick={() => { appSettings.accentColor = 'lavender'; onSaveAppearance(); }}>Lavender</button>
        <button class:active={appSettings.accentColor === 'cyan'} onclick={() => { appSettings.accentColor = 'cyan'; onSaveAppearance(); }}>Cyan</button>
        <button class:active={appSettings.accentColor === 'green'} onclick={() => { appSettings.accentColor = 'green'; onSaveAppearance(); }}>Green</button>
      </div>
      <div class="setting-hint">Changes highlights, active states, and accents across the app.</div>
    </div>
  </div>

  {:else if settingsSection === 'agent'}
  <div class="settings-body agent-section">
    <div class="section-header">
      <div>
        <div class="section-title">Agent Behavior</div>
        <div class="section-hint">How the self-forging agent operates.</div>
      </div>
    </div>

    <div class="setting">
      <div class="setting-label">Auto-reload Prompt</div>
      <label class="toggle">
        <input type="checkbox" bind:checked={appSettings.autoReloadPrompt} onchange={onSaveAgent} />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Automatically reload prompt.md when opening the Prompt tab</span>
      </label>
    </div>

    <div class="setting">
      <div class="setting-label">Max Transcripts to Keep</div>
      <input type="number" bind:value={appSettings.maxTranscripts} oninput={onSaveAgent} class="setting-input small" min="5" max="500" />
      <div class="setting-hint">Older transcripts are not auto-deleted, but the UI limits display.</div>
    </div>

    <div class="setting">
      <div class="setting-label">Enable Tools by Default</div>
      <label class="toggle">
        <input type="checkbox" bind:checked={appSettings.enableToolsByDefault} onchange={onSaveAgent} />
        <span class="toggle-slider"></span>
        <span class="toggle-label">New sessions start with tools manifest loaded</span>
      </label>
    </div>
  </div>

  {:else if settingsSection === 'panes'}
  <div class="settings-body panes-section">
    <div class="section-header">
      <div>
        <div class="section-title">Panes &amp; Crosstalk</div>
        <div class="section-hint">Settings for dual-pane and VS modes using multiple endpoints.</div>
      </div>
    </div>

    <div class="setting">
      <div class="setting-label">Default Chat Mode</div>
      <div class="segmented">
        <button class:active={appSettings.chatMode === 'solo'} onclick={() => { appSettings.chatMode = 'solo'; onSavePanes(); }}>Solo</button>
        <button class:active={appSettings.chatMode === 'dual'} onclick={() => { appSettings.chatMode = 'dual'; onSavePanes(); }}>Dual</button>
        <button class:active={appSettings.chatMode === 'vs'} onclick={() => { appSettings.chatMode = 'vs'; onSavePanes(); }}>VS</button>
        <button class:active={appSettings.chatMode === 'supervision'} onclick={() => { appSettings.chatMode = 'supervision'; onSavePanes(); }}>Supervision</button>
      </div>
      <div class="setting-hint">Mode when opening the chat tab.</div>
    </div>

    <div class="setting">
      <div class="setting-label">Default Left Endpoint</div>
      <select bind:value={appSettings.leftEndpointId} onchange={() => onSavePanes()} class="setting-input">
        {#each appSettings.endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
    </div>

    <div class="setting">
      <div class="setting-label">Default Right Endpoint</div>
      <select bind:value={appSettings.rightEndpointId} onchange={() => onSavePanes()} class="setting-input">
        {#each appSettings.endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
    </div>

    <div class="setting">
      <div class="setting-label">VS Max Rounds</div>
      <input 
        type="number" 
        bind:value={appSettings.maxVsRounds} 
        oninput={() => onSavePanes()} 
        class="setting-input small"
        min="1" 
        max="100" 
      />
      <div class="setting-hint">Maximum back-and-forth turns in crosstalk (VS) mode.</div>
    </div>
  </div>

  {:else if settingsSection === 'advanced'}
  <div class="settings-body advanced-section">
    <div class="section-header">
      <div>
        <div class="section-title">Advanced</div>
        <div class="section-hint">Power-user and debugging options. Use with care.</div>
      </div>
    </div>

    <div class="setting">
      <div class="setting-label">Request Timeout (ms)</div>
      <input type="number" bind:value={appSettings.requestTimeoutMs} oninput={onSaveAdvanced} class="setting-input small" min="5000" max="120000" step="1000" />
      <div class="setting-hint">How long to wait for responses from endpoints before giving up.</div>
    </div>

    <div class="setting">
      <div class="setting-label">Debug Mode</div>
      <label class="toggle">
        <input type="checkbox" bind:checked={appSettings.debugMode} onchange={onSaveAdvanced} />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Log extra details to console (and show raw responses if enabled)</span>
      </label>
    </div>

    <div class="setting">
      <div class="setting-label">Show Raw Responses</div>
      <label class="toggle">
        <input type="checkbox" bind:checked={appSettings.showRawResponses} onchange={onSaveAdvanced} />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Display unprocessed SSE data in the terminal tab for debugging</span>
      </label>
    </div>

    <div class="danger-zone">
      <div class="section-title" style="color: var(--red);">Danger Zone</div>
      <button class="save-btn" style="background: rgba(239,68,68,0.15); border-color: var(--red);" onclick={onClearData}>
        Clear All Local Data
      </button>
      <div class="setting-hint" style="color: var(--dim);">Clears in-memory data and UI state only. NO files are deleted (prompt, memory, DB etc. stay on disk). Cannot be undone for the session.</div>
    </div>
  </div>
  {/if}
</main>

<style lang="postcss">
  /* Comprehensive settings styles (restored/port for modular tab) */
  .settings-subnav {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    flex-wrap: wrap;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
  .ep-model span {
    color: var(--text);
  }

  .ep-models {
    font-size: 9px;
    color: var(--dim);
    font-family: var(--font-mono);
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
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

  .form-models {
    grid-column: 1 / -1;
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .models-label {
    font-size: 9px;
    color: var(--dim);
    display: block;
    margin-bottom: 3px;
    width: 100%;
  }
  .model-chip {
    background: rgba(28, 33, 40, 0.6);
    border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-family: var(--font-mono);
    cursor: pointer;
    margin: 1px 2px 1px 0;
    display: inline-block;
  }
  .model-chip:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }
</style>
