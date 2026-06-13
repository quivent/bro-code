<script lang="ts">
  import type { CtxEntry } from '../../lib/types';
  import { getAgentContext } from '../../lib/provider.svelte';

  // Consume the provider (real use of getAgentContext beyond root setAgentContext in App).
  // This lets the context tab react to the unified agent's ctx (incl. now-full dirs/files from loadContext).
  const agentCtx = getAgentContext();
  let agent = $derived(agentCtx?.agent);

  // Svelte 5 runes: export let is invalid in runes mode; use $props() for all component inputs.
  // (Pre-existing mix of runes $derived + legacy exports was causing build failure.)
  let {
    ctxEntries: passedCtxEntries = [] as CtxEntry[],
    ctxLoadStatus = '',
    ctxAddPath = '',
    ctxDragIdx = null as number | null,
    onAdd = () => { const list = (passedCtxEntries && passedCtxEntries.length) ? passedCtxEntries : (agent?.ctxEntries || []); agent?.loadAll?.(list); },
    onRemove,
    onLoad = () => { const list = (passedCtxEntries && passedCtxEntries.length) ? passedCtxEntries : (agent?.ctxEntries || []); agent?.loadAll?.(list); },
    onClear,
    onDropReorder,
    onPickFile,
    onAddPath,
  } = $props<{
    ctxEntries?: CtxEntry[];
    ctxLoadStatus?: string;
    ctxAddPath?: string;
    ctxDragIdx?: number | null;
    onAdd?: () => void;
    onRemove?: (i: number) => void;
    onLoad?: () => void;
    onClear?: () => void;
    onDropReorder?: (target: number) => void;
    onPickFile?: (directory: boolean) => void;
    onAddPath?: (path: string) => void;
  }>();

  // Prefer entries passed by host (monolith state); fall back to agent's (now includes full ctx from loadContext with dirs).
  let ctxEntries = $derived((passedCtxEntries && passedCtxEntries.length) ? passedCtxEntries : (agent?.ctxEntries || [] as CtxEntry[]));
</script>

<main class="editor-main ctx-main">
  <div class="editor-header">
    <span>injection context — ordered top to bottom</span>
    {#if ctxLoadStatus}<span class="status">{ctxLoadStatus}</span>{/if}
    <button class="save-btn" onclick={onLoad}>load context</button>
    <button class="reload-btn" onclick={onClear} disabled={!ctxEntries.length}>clear</button>
  </div>
  <div class="ctx-list">
    {#each ctxEntries as en, i (en.path)}
      <div
        class="ctx-entry"
        class:dragging={ctxDragIdx === i}
        draggable="true"
        role="listitem"
        ondragstart={() => { ctxDragIdx = i; }}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => { e.preventDefault(); onDropReorder(i); }}
        ondragend={() => { ctxDragIdx = null; }}
      >
        <span class="grip">⠿</span>
        <span class="kind {en.kind}">{en.kind}</span>
        <span class="path" title={en.path}>{en.path}</span>
        <button class="x" onclick={() => onRemove(i)}>×</button>
      </div>
    {/each}
    {#if !ctxEntries.length}
      <div class="ctx-empty">no entries — add files below or drop them here from Finder</div>
    {/if}
    <div class="ctx-add-row">
      <button class="reload-btn" onclick={() => onPickFile(false)}>+ file…</button>
      <button class="reload-btn" onclick={() => onPickFile(true)}>+ folder…</button>
      <input class="ctx-add-input" bind:value={ctxAddPath} placeholder="or type a path (~/...) and press enter"
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && ctxAddPath.trim()) { onAddPath(ctxAddPath); ctxAddPath = ''; } }} />
    </div>
    <div class="ctx-hint">
      Drag rows to reorder — entries are injected as one system message, in this order, on every send.
      Folders inject their file listing. Each entry capped at ~6k tokens. Drop files from Finder anywhere on this tab.
      “load context” re-reads everything from disk; the chat's context bar includes what's loaded.
    </div>
  </div>
</main>

<style lang="postcss">
  /* ctx styles (ported for modularity) */
</style>
