<script lang="ts">
  export let autoReloadPrompt = true;
  export let maxTranscripts = 50;
  export let enableToolsByDefault = true;
  export let onChange = (key: string, val: any) => {};
</script>

<div>
  <div class="setting">
    <div class="setting-label">Auto-reload Prompt</div>
    <label><input type="checkbox" bind:checked={autoReloadPrompt} onchange={() => onChange('autoReloadPrompt', autoReloadPrompt)} /> Auto reload prompt.md on tab open</label>
  </div>

  <div class="setting">
    <div class="setting-label">Max Transcripts</div>
    <input type="number" bind:value={maxTranscripts} oninput={() => onChange('maxTranscripts', maxTranscripts)} />
  </div>

  <div class="setting">
    <div class="setting-label">Enable Tools by Default</div>
    <label><input type="checkbox" bind:checked={enableToolsByDefault} onchange={() => onChange('enableToolsByDefault', enableToolsByDefault)} /> Load tools on start</label>
  </div>
</div>
