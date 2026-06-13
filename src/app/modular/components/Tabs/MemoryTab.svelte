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
    <span>~/lithos/gemma/memory/memory.json</span>
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

<style lang="postcss">
  /* memory styles */
</style>
