<script lang="ts">
  import { getAgentContext } from '../../lib/provider.svelte';
  const agentCtx = getAgentContext();
  let agent = $derived(agentCtx?.agent);

  // Use agent's memCells for integration - monolith no longer owns duplicate state
  let memCells = $derived(agent?.memCells || []);
  let {
    memStatus = '',
    editingKey = null as string | null,
    editKey = '',
    editValue = '',
    editTags = '',
    newCellKey = '',
    onLoad = () => { agent?.loadAll?.(); },
    onPersist,
    onStartEdit,
    onSaveCell,
    onCancelEdit,
    onAddCell,
  }: {
    memStatus?: string;
    editingKey?: string | null;
    editKey?: string;
    editValue?: string;
    editTags?: string;
    newCellKey?: string;
    onLoad?: () => void;
    onPersist?: () => void;
    onStartEdit?: (cell: any) => void;
    onSaveCell?: () => void;
    onCancelEdit?: () => void;
    onAddCell?: () => void;
  } = $props();
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>~/bro/memory/memory.json</span>
    <span class="meta">{memCells.length} cells</span>
    {#if memStatus}<span class="status">{memStatus}</span>{/if}
    <button class="reload-btn" onclick={onPersist}>standardize</button>
    <button class="reload-btn" onclick={onLoad}>reload</button>
  </div>
  <div class="memory-list">
    {#each memCells as cell}
      <div class="mem-cell" class:editing={editingKey === cell.key}>
        <div class="mem-key" role="button" tabindex="0" onclick={() => onStartEdit(cell)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          {cell.key}
          {#if cell.pinned}<span class="badge pin">📌</span>{/if}
          {#if cell.anchored}<span class="badge anchor">⚓</span>{/if}
          {#if cell.tags?.length}<span class="mem-tags">{cell.tags.join(', ')}</span>{/if}
          <span class="mem-meta">{(cell.updated || '').slice(0, 10) || '—'} · {cell.reads ?? 0}r · {cell.writes ?? 0}w</span>
        </div>
        {#if editingKey === cell.key}
          <textarea class="mem-edit" bind:value={editValue} rows="6" spellcheck="false"></textarea>
          <div class="mem-edit-row">
            <input class="mem-key-input" bind:value={editKey} placeholder="key" />
            <input class="mem-tags-input" bind:value={editTags} placeholder="tags" />
            <button class="save-btn" onclick={onSaveCell}>save</button>
            <button class="reload-btn" onclick={onCancelEdit}>cancel</button>
          </div>
        {:else}
          <div class="mem-value" role="button" tabindex="0" onclick={() => onStartEdit(cell)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>{cell.value.length > 200 ? cell.value.slice(0, 200) + '…' : cell.value}</div>
        {/if}
      </div>
    {/each}
    {#if !memCells.length}<div class="empty">(no memory cells)</div>{/if}
    <div class="mem-add">
      <input class="mem-key-input" bind:value={newCellKey} placeholder="new_cell_key" onkeydown={(e) => { if (e.key === 'Enter') onAddCell(); }} />
      <button class="save-btn" onclick={onAddCell}>+ add cell</button>
    </div>
  </div>
</main>

<style>
  /* memory styles (pulled safely from gemma-code reference worktree for visual parity with other editor tabs) */
  .memory-list { flex: 1; overflow-y: auto; padding: 12px 20px; }

  .mem-cell {
    padding: 10px 14px; margin-bottom: 8px;
    background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(42, 42, 58, 0.4);
    border-radius: 8px; font-family: var(--font-mono); font-size: 12px;
  }
  .mem-cell.editing { border-color: #f0883e; }

  .mem-key { color: #f0883e; font-weight: 600; cursor: pointer; margin-bottom: 4px; }
  .mem-key:hover { text-decoration: underline; }

  .badge { font-size: 10px; padding: 0 4px; border-radius: 3px; margin-left: 6px; }
  .badge.pin { background: rgba(250, 204, 21, 0.2); color: #facc15; }
  .badge.anchor { background: rgba(52, 211, 153, 0.2); color: #34d399; }

  .mem-tags { color: var(--dim); font-size: 10px; margin-left: 8px; }
  .mem-meta { color: var(--dim); font-size: 10px; margin-left: auto; }

  .mem-value { color: var(--text); line-height: 1.4; white-space: pre-wrap; cursor: pointer; }
  .mem-value:hover { background: rgba(255,255,255,0.03); }

  .mem-edit { width: 100%; background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42,42,58,0.5); border-radius: 6px; padding: 8px; font-family: var(--font-mono); font-size: 12px; }
  .mem-edit-row { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
  .mem-key-input, .mem-tags-input { background: var(--bg-secondary); color: var(--text);
    border: 1px solid rgba(42,42,58,0.5); border-radius: 4px; padding: 4px 8px; font-size: 11px; font-family: var(--font-mono); }

  .mem-add { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
  .empty { color: var(--dim); font-size: 12px; padding: 20px 0; text-align: center; }
</style>
