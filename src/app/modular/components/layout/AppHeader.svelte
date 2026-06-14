<script lang="ts">
  import type { Tab } from '../../lib/types';
  export let activeTab: Tab;
  export let streaming: boolean;
  export let tokenCount: number;
  export let elapsed: number;
  export let messagesLength: number;
  export let activeName: string;
  export let healthStatus: string;
  export let healthMsg: string;
  export let onTabChange: (tab: Tab) => void;
  export let onCheckHealth: () => void;
</script>

<header>
  <span class="title">gemma</span>
  {#if typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)}
    <span class="web-mode-banner" title="Web mode (see WEB_MODE_PICKUP.md)">🌐 Web</span>
  {/if}
  <nav>
    {#each ['chat', 'prompt', 'memory', 'tools', 'transcripts', 'context', 'terminal', 'kv', 'source', 'settings'] as tab}
      <button 
        class:active={activeTab === tab} 
        onclick={() => onTabChange(tab as Tab)}
      >
        {tab === 'kv' ? 'KV' : tab.charAt(0).toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </nav>
  <span class="meta">
    {#if streaming}
      <span class="streaming">● {tokenCount} tok · {elapsed.toFixed(1)}s</span>
    {:else}
      {messagesLength}m
    {/if}
    <span class="endpoint-badge" title="Endpoint: ... Model: ...">{activeName}</span>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <span
      class="health-dot {healthStatus}"
      title={healthMsg ? `${healthMsg} — click to recheck` : 'Click to check endpoint health'}
      onclick={onCheckHealth}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCheckHealth(); } }}
    ></span>
    <!-- Watermark for refactor version (v2 = current modular refactored; v1 was original monolith). -->
    <span class="watermark" title="Refactor v2 (modular extraction in progress; shared bro-shared dual logic is being phased out for local agent integration)">v2 (modular)</span>
  </span>
</header>

<style>
  /* Copy relevant styles from main, or use global */
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
    padding: 1px 5px;
    border-radius: 3px;
    margin-left: 6px;
    vertical-align: middle;
  }
  nav { display: flex; gap: 1px; background: rgba(42, 42, 58, 0.3); border-radius: 6px; padding: 2px; }
  nav button {
    background: none; border: none; color: var(--muted); font-size: 12px; padding: 5px 14px; cursor: pointer;
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
  .endpoint-badge { /* ... */ }
  .health-dot { /* ... */ }

  .watermark {
    font-size: 9px;
    font-family: var(--font-mono);
    color: #aaa; /* lighter for visibility on dark header */
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 4px;
    border-radius: 2px;
    line-height: 1;
    opacity: 0.85;
    margin-left: 8px;
    vertical-align: middle;
  }
</style>
