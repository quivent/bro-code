<script lang="ts">
  export let chatMode = 'solo';
  export let leftEndpointId: string | null = null;
  export let rightEndpointId: string | null = null;
  export let maxVsRounds = 10;
  export let endpoints: any[] = [];
  export let onChange = (key: string, val: any) => {};
</script>

<div>
  <div class="setting">
    <div class="setting-label">Default Chat Mode</div>
    <div class="segmented">
      <button class:active={chatMode==='solo'} onclick={() => onChange('chatMode', 'solo')}>Solo</button>
      <button class:active={chatMode==='dual'} onclick={() => onChange('chatMode', 'dual')}>Dual</button>
      <button class:active={chatMode==='vs'} onclick={() => onChange('chatMode', 'vs')}>VS</button>
    </div>
  </div>

  <div class="setting">
    <div class="setting-label">Default Left Endpoint</div>
    <select bind:value={leftEndpointId} onchange={() => onChange('leftEndpointId', leftEndpointId)}>
      {#each endpoints as ep}
        <option value={ep.id}>{ep.name}</option>
      {/each}
    </select>
  </div>

  <div class="setting">
    <div class="setting-label">Default Right Endpoint</div>
    <select bind:value={rightEndpointId} onchange={() => onChange('rightEndpointId', rightEndpointId)}>
      {#each endpoints as ep}
        <option value={ep.id}>{ep.name}</option>
      {/each}
    </select>
  </div>

  <div class="setting">
    <div class="setting-label">VS Max Rounds</div>
    <input type="number" bind:value={maxVsRounds} oninput={() => onChange('maxVsRounds', maxVsRounds)} min="1" max="100" />
  </div>
</div>
