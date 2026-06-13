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
    onToggleShowInChat,
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
    onToggleShowInChat?: (i: number) => void;
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
        <label class="show-on-chat" title="Mark to show this context visibly in the chat area and preferentially keep in sliding context">
          <input type="checkbox" checked={!!en.showInChat} onchange={() => onToggleShowInChat?.(i)} />
          <span>show on chat</span>
        </label>
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
  /* Styles for the context editor tab, ported/fixed from gemma-code reference
     (the monolithic worktree version inlines the markup + has these rules in App;
     here we scope them locally to this component for the modular <ContextTab> usage).
     Includes base .editor-main/.editor-header used by several tabs. */
  .editor-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .editor-header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono); border-bottom: 1px solid rgba(42, 42, 58, 0.4);
  }

  .ctx-list { flex: 1; overflow-y: auto; padding: 14px 20px; }
  .ctx-entry {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 6px;
    background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    border-radius: 8px; cursor: grab; font-family: var(--font-mono); font-size: 12px;
  }
  .ctx-entry.dragging { opacity: 0.4; border-color: #2dd4bf; }
  .ctx-entry .grip { color: var(--dim); cursor: grab; }
  .ctx-entry .kind {
    font-size: 10px; padding: 1px 7px; border-radius: 5px; text-transform: uppercase;
    background: rgba(45, 212, 191, 0.12); color: #2dd4bf;
  }
  .ctx-entry .kind.prompt { background: rgba(167, 139, 250, 0.14); color: #a78bfa; }
  .ctx-entry .kind.memory { background: rgba(240, 136, 62, 0.14); color: #f0883e; }
  .ctx-entry .kind.dir { background: rgba(96, 165, 250, 0.14); color: #60a5fa; }
  .ctx-entry .path { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ctx-entry .x {
    background: transparent; border: none; color: var(--text-secondary);
    font-size: 14px; cursor: pointer; padding: 0 4px;
  }
  .ctx-entry .x:hover { color: #ef4444; }
  .ctx-empty { color: var(--dim); font-size: 12px; padding: 20px 0; text-align: center; }
  .ctx-add-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  .ctx-add-input {
    flex: 1; background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5); border-radius: 8px;
    padding: 6px 12px; font-size: 12px; font-family: var(--font-mono); outline: none;
  }
  .ctx-hint { color: var(--dim); font-size: 11px; line-height: 1.6; margin-top: 14px; }

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
  .status { color: var(--green); font-size: 11px; transition: opacity 300ms; }

  .show-on-chat {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--dim);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    margin-left: 4px;
  }
  .show-on-chat input { margin: 0; width: 11px; height: 11px; }
</style>
