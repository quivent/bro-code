<script lang="ts">
  import { renderMd, highlightMdSource } from '../../lib/utils';
  import { getAgentContext } from '../../lib/provider.svelte';
  const agentCtx = getAgentContext();
  let agent = $derived(agentCtx?.agent);

  // Derive from agent for integration - monolith sheds duplicate promptText state
  let promptText = $derived(agent?.promptText || '');
  let {
    promptDirty = false,
    promptStatus = '',
    promptView = 'source' as 'source' | 'preview',
    promptHighlightEl = undefined as any,
    onLoad = () => { agent?.loadAll?.(); },
    onSave,
    onInput,
    onToggleView,
    onInject,
  }: {
    promptDirty?: boolean;
    promptStatus?: string;
    promptView?: 'source' | 'preview';
    promptHighlightEl?: any;
    onLoad?: () => void;
    onSave?: () => void;
    onInput?: () => void;
    onToggleView?: () => void;
    onInject?: () => void;
  } = $props();

  // Local rehighlight helper for prompt source view (synced scroll + highlight)
  let promptHlTimer: ReturnType<typeof setTimeout> | null = null;
  function rehighlightPrompt() {
    if (promptHlTimer) clearTimeout(promptHlTimer);
    promptHlTimer = setTimeout(() => {
      // highlight is rendered in the pre via highlightMdSource when in source mode
    }, 120);
  }
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>~/bro/prompt.md</span>
    {#if promptDirty}<span class="dirty">● unsaved</span>{/if}
    {#if promptStatus}<span class="status">{promptStatus}</span>{/if}
    <button class="save-btn" onclick={onSave} disabled={!promptDirty}>save</button>
    <button class="reload-btn" onclick={onLoad}>reload</button>
    <button class="reload-btn" onclick={onToggleView}>{promptView}</button>
    <button class="reload-btn" onclick={onInject}>inject → ctx</button>
  </div>
  <div class="prompt-overlay-wrap">
    {#if promptView === 'source'}
      <div class="prompt-overlay-wrap">
        <pre class="prompt-highlight" bind:this={promptHighlightEl} aria-hidden="true">{@html highlightMdSource((promptText || '') + '\n')}</pre>
        <textarea class="prompt-input" bind:value={promptText}
          oninput={() => { onInput(); rehighlightPrompt(); }}
          onscroll={(e: Event) => { if (promptHighlightEl) promptHighlightEl.scrollTop = (e.target as HTMLElement).scrollTop; }}
          onkeydown={(e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave(); } }}
          spellcheck="false"></textarea>
      </div>
    {:else}
      <div class="prompt-preview markdown">
        {@html renderMd(promptText || '*No prompt content yet. Switch to source to edit.*')}
      </div>
    {/if}
  </div>
</main>

<style lang="postcss">
  /* prompt styles (scoped from original) + base editor for consistency */
  .editor-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .editor-header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono); border-bottom: 1px solid rgba(42, 42, 58, 0.4);
  }
  .dirty { color: var(--warn); font-size: 11px; }
  .status { color: var(--green); font-size: 11px; transition: opacity 300ms; }
  .save-btn {
    background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4);
    color: #34d399; padding: 4px 12px; border-radius: 5px; cursor: pointer;
    font-size: 11px; font-family: var(--font-mono);
  }
  .reload-btn {
    background: rgba(28, 33, 40, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary); padding: 4px 12px; border-radius: 5px;
    cursor: pointer; font-size: 11px; font-family: var(--font-mono);
    transition: all 150ms ease;
  }

  .prompt-overlay-wrap { position: relative; }
  .prompt-highlight { 
    position: absolute; top: 0; left: 0; right: 0; bottom: 0; 
    margin: 0; padding: 12px; overflow: auto; 
    font-family: var(--font-mono); font-size: 13px; line-height: 1.5; 
    color: #666; pointer-events: none; white-space: pre-wrap; 
  }
  .prompt-input { 
    position: relative; z-index: 1; width: 100%; min-height: 320px; 
    background: transparent; color: var(--text); font-family: var(--font-mono); 
    font-size: 13px; line-height: 1.5; padding: 12px; border: 1px solid var(--border); 
    border-radius: 8px; resize: vertical; 
  }
  .prompt-preview { padding: 12px; background: var(--bg-secondary); border-radius: 8px; }
</style>
