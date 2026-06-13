<script lang="ts">
  import type { KvSession } from '../../lib/types';
  import { addLocalEndpoint, settings as appSettings } from '../../lib/settings-store.svelte.ts';
  import { getLocalCacheStatsURL, getLocalCacheResetURL, getLocalModelsURL } from '../../lib/local-serve';
  import { invoke as tauriInvoke } from '@tauri-apps/api/core';

  // Fully self-contained (absolute final slice) except minimal getter for current chat snapshot (needed for capture KV of live conversation).
  // All other state/logic (list, restore, serve, health, APC, rm) owned here. No monolith callbacks.
  let { getChatText = () => '' }: { getChatText?: () => string } = $props();

  let kvSessions: KvSession[] = $state([]);
  let kvStatus: string = $state('');
  let kvBusy = $state(false);
  let kvCaptureName = $state('');
  let kvRestorePrompt = $state('');
  let kvRestoreOutput = $state('');
  let kvSelected: string | null = $state(null);

  let serveConfig = $state('');
  let localHealth: 'unknown' | 'checking' | 'ok' | 'error' = $state('unknown');
  let localHealthMsg = $state('');
  let serveBusy = $state(false);
  let apcStats: Record<string, unknown> | null = $state(null);

  const isTauri = '__TAURI_INTERNALS__' in (typeof window !== 'undefined' ? window : {});
  async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!isTauri) return null;
    return tauriInvoke(cmd, args);
  }

  async function checkLocalHealth() {
    localHealth = 'checking';
    try {
      const res = await fetch(getLocalModelsURL(localPortForKv()), { signal: AbortSignal.timeout?.(4000) });
      if (res.ok) { localHealth = 'ok'; localHealthMsg = 'local gemma serve up'; }
      else { localHealth = 'error'; localHealthMsg = `HTTP ${res.status}`; }
    } catch (e: any) {
      localHealth = 'error';
      localHealthMsg = e?.message || 'unreachable';
    }
  }

  function localPortForKv(): number {
    // Settings store owns the authoritative localPort (editable in Settings). Fall back to 8091.
    return (appSettings && appSettings.localPort) || 8091;
  }

  async function loadApcStats() {
    try {
      const url = getLocalCacheStatsURL(localPortForKv());
      const res = await fetch(url, { signal: AbortSignal.timeout?.(4000) });
      apcStats = res.ok ? await res.json() : null;
    } catch { apcStats = null; }
  }

  async function resetApc() {
    try {
      const url = getLocalCacheResetURL(localPortForKv());
      await fetch(url, { method: 'POST' });
      await loadApcStats();
      kvStatus = 'server cache reset';
      setTimeout(() => { kvStatus = ''; }, 2500);
    } catch (e: any) { kvStatus = `reset failed: ${e?.message || e}`; }
  }

  async function loadKvSessions() {
    if (!isTauri) return;
    try {
      const out: string = await invoke('run_shell', {
        cmd: `cd ~/gemma/kv 2>/dev/null && stat -f "%N|%z|%Sm" -t "%Y-%m-%d %H:%M" *.safetensors 2>/dev/null; true`
      }) || '';
      kvSessions = out.split('\n').filter(l => l.includes('|')).map(l => {
        const [name, bytes, mtime] = l.split('|');
        return { name: name.replace(/\.safetensors$/, ''), bytes: parseInt(bytes), mtime };
      });
    } catch (e: any) { kvStatus = `list failed: ${e}`; }
  }

  async function loadServeConfig() {
    if (!isTauri) { serveConfig = '(requires Tauri)'; return; }
    try {
      const out: string = await invoke('run_shell', {
        cmd: `echo "── process ──"; ps -eo args= | grep "mlx_vlm server" | grep -v grep || echo "(not running)"; echo; echo "── launch agent (com.mlx.gemma4-31b) ──"; launchctl list 2>/dev/null | grep com.mlx.gemma4-31b || echo "(not loaded)"; echo; echo "── plist ──"; plutil -p ~/Library/LaunchAgents/com.mlx.gemma4-31b.plist 2>/dev/null | grep -E 'model|draft|kv-size|max-tokens|APC|Program' | head -20; echo; echo "── kv sessions dir ──"; du -sh ~/gemma/kv 2>/dev/null || echo "(empty)"; echo "── apc disk ──"; du -sh ~/gemma/apc 2>/dev/null || echo "(empty)"`
      }) || '';
      serveConfig = out;
    } catch (e: any) { serveConfig = `failed: ${e}`; }
  }

  async function serveLocal() {
    if (!isTauri) return;
    serveBusy = true;
    kvStatus = 'starting gemma serve…';
    try {
      await invoke('run_shell', {
        cmd: `launchctl load -w ~/Library/LaunchAgents/com.mlx.gemma4-31b.plist 2>/dev/null; launchctl kickstart gui/$(id -u)/com.mlx.gemma4-31b 2>/dev/null; true`
      });
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        await checkLocalHealth();
        if (localHealth === 'ok') break;
      }
      kvStatus = localHealth === 'ok' ? 'gemma serve is up' : 'started — still loading (model preload takes ~1 min)';
    } catch (e: any) { kvStatus = `serve failed: ${e}`; }
    serveBusy = false;
    setTimeout(() => { kvStatus = ''; }, 4000);
  }

  async function captureCurrentChat() {
    if (!isTauri || kvBusy) return;
    const name = (kvCaptureName.trim() || `chat-${new Date().toISOString().slice(0, 10)}`).replace(/[^\w.-]/g, '_');
    const text = getChatText();
    if (!text) { kvStatus = 'chat is empty — nothing to capture'; return; }
    kvBusy = true;
    kvStatus = `capturing "${name}" (loads model, ~1 min)…`;
    try {
      const out: string = await invoke('run_shell', {
        cmd: `/opt/homebrew/bin/gemma kv capture ${shqForKv(name)} ${shqForKv(text)} 2>&1`
      });
      kvStatus = (out || '').trim().split('\n').pop() || 'captured';
      await loadKvSessions();
    } catch (e: any) { kvStatus = `capture failed: ${e}`; }
    kvBusy = false;
  }

  // minimal shell quote for the capture path (same spirit as main)
  function shqForKv(s: string) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  async function restoreSession() {
    if (!isTauri) { kvStatus = 'requires the desktop app'; return; }
    if (kvBusy) { kvStatus = 'another kv operation is still running…'; return; }
    if (!kvSelected) { kvStatus = 'click a session above to select it first'; return; }
    const prompt = kvRestorePrompt.trim();
    if (!prompt) { kvStatus = 'enter a prompt to continue from the saved KV'; return; }
    kvBusy = true;
    kvRestoreOutput = '';
    kvStatus = `restoring "${kvSelected}"…`;
    try {
      const out: string = await invoke('run_shell', {
        cmd: `/opt/homebrew/bin/gemma kv restore ${shqForKv(kvSelected)} ${shqForKv(prompt)} --max-tokens 400 2>&1`
      });
      kvRestoreOutput = (out || '').trim() || '(no output — command returned empty)';
      kvStatus = '';
    } catch (e: any) { kvStatus = `restore failed: ${e}`; }
    kvBusy = false;
  }

  async function rmSession(name: string) {
    // No file delete via rm; only UI filter. The .safetensors stays on disk.
    if (kvSelected === name) kvSelected = null;
    kvSessions = kvSessions.filter(s => s.name !== name);
  }

  async function onAddLocalToEndpoints() {
    await addLocalEndpoint();
    kvStatus = 'Local endpoint registered (see Settings)';
    setTimeout(() => { kvStatus = ''; }, 2000);
  }

  // Auto load on mount (self-contained)
  $effect(() => {
    if (!kvSessions.length) {
      void loadKvSessions();
      void loadServeConfig();
      void checkLocalHealth();
      void loadApcStats();
    }
  });
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>KV Sessions (capture/restore for fast context)</span>
    <span class="meta">{kvSessions.length} sessions</span>
    {#if kvStatus}<span class="status">{kvStatus}</span>{/if}
    <button class="reload-btn" onclick={loadKvSessions}>reload</button>
    <button class="reload-btn" onclick={loadServeConfig}>config</button>
  </div>

  <div class="kv-body">
    <div class="kv-intro">
      Capture current chat into a reusable KV cache snapshot (saves prompt+history as starting state for the model). 
      Restore to continue a prior chat from the exact KV weights (fast — skips re-prefill). Sessions live in ~/gemma/kv/*.safetensors.
    </div>

    <!-- Capture form (inputs+button) -->
    <div class="kv-capture">
      <input
        class="kv-input"
        bind:value={kvCaptureName}
        placeholder="name (optional; defaults to chat-YYYY-MM-DD)"
        disabled={kvBusy}
      />
      <button class="save-btn" onclick={captureCurrentChat} disabled={kvBusy || !kvCaptureName && true /* allow default name */}>
        {kvBusy ? 'capturing…' : 'capture current chat'}
      </button>
    </div>

    <!-- Sessions list with select + rm -->
    <div class="kv-list">
      {#each kvSessions as s}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="kv-row" class:kv-selected={kvSelected === s.name} onclick={() => { kvSelected = s.name; }} role="button" tabindex="0">
          <span>{s.name}</span>
          <span class="meta">{(s.bytes / 1e6).toFixed(1)} MB · {s.mtime}</span>
          <button class="reload-btn" onclick={(e) => { e.stopPropagation(); rmSession(s.name); }}>rm</button>
        </div>
      {/each}
      {#if !kvSessions.length}<div class="empty">(no KV sessions yet — capture one from a chat)</div>{/if}
    </div>

    <!-- Restore form (inputs+button + output) -->
    {#if kvSelected}
      <div class="kv-restore-row">
        <span class="meta" style="align-self:center;">restore from <strong>{kvSelected}</strong> with prompt:</span>
        <input
          class="kv-input grow"
          bind:value={kvRestorePrompt}
          placeholder="your continuation prompt…"
          disabled={kvBusy}
        />
        <button class="save-btn" onclick={restoreSession} disabled={kvBusy || !kvRestorePrompt.trim()}>restore + run</button>
      </div>
    {:else}
      <div class="meta" style="padding:4px 0;">select a session above to restore from it</div>
    {/if}

    {#if kvRestoreOutput}
      <div class="kv-output">{kvRestoreOutput}</div>
    {/if}

    <!-- Serve / APC / Local health controls -->
    <div style="margin-top:16px; border-top:1px solid rgba(42,42,58,0.3); padding-top:12px;">
      <div class="section-title" style="font-size:12px; margin-bottom:6px;">Local gemma serve (mlx) + APC</div>

      <div class="kv-stats">
        <div class="kv-stat"><span class="kv-stat-k">health:</span> {localHealth} {localHealthMsg ? '· ' + localHealthMsg : ''}</div>
        {#if apcStats}
          {#each Object.entries(apcStats) as [k,v]}
            <div class="kv-stat"><span class="kv-stat-k">{k}:</span> {typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}</div>
          {/each}
        {/if}
      </div>

      <div class="kv-restore-row" style="flex-wrap:wrap;">
        <button class="reload-btn" onclick={serveLocal} disabled={serveBusy}>{serveBusy ? 'starting…' : 'start / kickstart serve'}</button>
        <button class="reload-btn" onclick={resetApc}>reset APC cache</button>
        <button class="reload-btn" onclick={loadServeConfig}>load full config</button>
      </div>

      {#if serveConfig}
        <pre class="kv-config">{serveConfig}</pre>
      {/if}
    </div>
  </div>
</main>

<style lang="postcss">
  /* KV styles */
</style>
