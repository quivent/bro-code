<script lang="ts">
  export let requestTimeoutMs = 30000;
  export let debugMode = false;
  export let showRawResponses = false;
  export let onChange = (key: string, val: any) => {};
  export let onClearData = () => {};
</script>

<div>
  <div class="setting">
    <div class="setting-label">Request Timeout (ms)</div>
    <input type="number" bind:value={requestTimeoutMs} oninput={() => onChange('requestTimeoutMs', requestTimeoutMs)} />
  </div>

  <div class="setting">
    <div class="setting-label">Debug Mode</div>
    <label><input type="checkbox" bind:checked={debugMode} onchange={() => onChange('debugMode', debugMode)} /> Enable extra logs</label>
  </div>

  <div class="setting">
    <div class="setting-label">Show Raw Responses</div>
    <label><input type="checkbox" bind:checked={showRawResponses} onchange={() => onChange('showRawResponses', showRawResponses)} /> Dump SSE to terminal</label>
  </div>

  <div class="danger">
    <button onclick={onClearData}>Clear All Local Data</button>
  </div>
</div>
