<script lang="ts">
  export let exec: { cmd: string; output: string; approved: boolean };
</script>

<div class="exec-card {exec.approved ? 'ran' : 'denied'}">
  <div class="exec-cmd"><span class="exec-ps">$</span> {exec.cmd}</div>
  <pre class="exec-out">{exec.output || (exec.approved ? '' : 'denied')}</pre>
</div>

<style>
  .exec-card { margin: 8px 0; padding: 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; }
  .exec-card.ran { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); }
  .exec-card.denied { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); }
  .exec-cmd { color: var(--dim); margin-bottom: 4px; }
  .exec-ps { color: var(--lavend); }
  .exec-out { white-space: pre-wrap; color: var(--text); margin: 0; }
</style>
