<script lang="ts">
  import type { Endpoint } from '../../lib/endpoint-management';
  import { moveEndpoint, testEndpointHealth, createEndpoint, normalizeToChatCompletions } from '../../lib/endpoint-management';

  export let endpoints: Endpoint[] = [];
  export let activeEndpointId: string | null = null;
  export let onChange: (eps: Endpoint[], activeId: string | null) => void = () => {};
  export let onTest: (ep: Endpoint) => void = () => {};

  let formName = '';
  let formUrl = '';
  let formModel = '';
  let editingId: string | null = null;

  function addOrSave() {
    if (!formName || !formUrl || !formModel) return;
    let newList: Endpoint[];
    if (editingId) {
      newList = endpoints.map(e => e.id === editingId ? { ...e, name: formName.trim(), endpoint: normalizeToChatCompletions(formUrl), model: formModel.trim() } : e);
    } else {
      const newEp = createEndpoint(formName, formUrl, formModel);
      newList = [...endpoints, newEp];
    }
    const newActive = activeEndpointId || newList[0]?.id || null;
    onChange(newList, newActive);
    cancelEdit();
  }

  function startEdit(ep: Endpoint) {
    editingId = ep.id;
    formName = ep.name;
    formUrl = ep.endpoint;
    formModel = ep.model;
  }

  function cancelEdit() {
    editingId = null;
    formName = ''; formUrl = ''; formModel = '';
  }

  function deleteEp(id: string) {
    const newList = endpoints.filter(e => e.id !== id);
    let newActive = activeEndpointId;
    if (newActive === id) newActive = newList[0]?.id || null;
    onChange(newList, newActive);
  }

  function move(id: string, dir: number) {
    const newList = moveEndpoint(endpoints, id, dir);
    onChange(newList, activeEndpointId);
  }

  function setActive(id: string) {
    onChange(endpoints, id);
  }

  async function test(ep: Endpoint) {
    const updated = await testEndpointHealth(ep);
    const newList = endpoints.map(e => e.id === ep.id ? updated : e);
    onChange(newList, activeEndpointId);
    onTest(updated);
  }
</script>

<div class="endpoints-panel">
  {#each endpoints as ep, i (ep.id)}
    <div class="ep-row" class:active={ep.id === activeEndpointId}>
      <div class="prio">
        <button onclick={() => move(ep.id, -1)} disabled={i===0}>↑</button>
        <button onclick={() => move(ep.id, 1)} disabled={i===endpoints.length-1}>↓</button>
        <span>{i+1}</span>
      </div>
      <div class="info">
        <strong>{ep.name}</strong>
        <div class="url">{ep.endpoint}</div>
        <div>model: {ep.model}</div>
      </div>
      <div class="status">
        {#if ep.lastHealth}
          <span class={ep.lastHealth.ok ? 'ok' : 'bad'}>{ep.lastHealth.message}</span>
        {/if}
      </div>
      <div class="actions">
        {#if ep.id !== activeEndpointId}
          <button onclick={() => setActive(ep.id)}>Use</button>
        {:else}
          <span>ACTIVE</span>
        {/if}
        <button onclick={() => test(ep)}>Test</button>
        <button onclick={() => startEdit(ep)}>Edit</button>
        <button onclick={() => deleteEp(ep.id)} class="danger">×</button>
      </div>
    </div>
  {/each}

  <div class="form">
    <h4>{editingId ? 'Edit' : 'Add'} Endpoint</h4>
    <input bind:value={formName} placeholder="Name" />
    <input bind:value={formUrl} placeholder="URL (base or full /v1/chat/completions)" />
    <input bind:value={formModel} placeholder="Model" />
    <div>
      <button onclick={addOrSave}>{editingId ? 'Save' : 'Add'}</button>
      {#if editingId}<button onclick={cancelEdit}>Cancel</button>{/if}
    </div>
  </div>
</div>

<style>
  .ep-row { display: flex; gap: 8px; padding: 8px; border: 1px solid #333; margin-bottom: 4px; }
  .ep-row.active { border-color: #7c3aed; }
  .prio { display: flex; flex-direction: column; align-items: center; }
  .info { flex: 1; }
  .url { font-family: monospace; font-size: 0.8em; color: #888; }
  .actions { display: flex; gap: 4px; }
  .form { margin-top: 16px; padding: 12px; background: #1a1a2e; border-radius: 8px; }
  .ok { color: #22c55e; }
  .bad { color: #ef4444; }
  .danger { color: #ef4444; }
</style>
