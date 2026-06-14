<script lang="ts">
  import { isDestructiveCmd } from '../../lib';
  import { invoke as tauriInvoke } from '@tauri-apps/api/core';

  // Terminal tab supports parent bind: for termInput, termOutput, termRunning, termContainer (for host wiring / parity).
  // Internal $state merged with $props $bindable.
  let {
    termInput = $bindable(''),
    termOutput = $bindable<string[]>([]),
    termRunning = $bindable(false),
    termContainer = $bindable<HTMLElement | undefined>(),
  } = $props();

  // (the $state lets below were the self-contained attempt; now via bindable props for parent compatibility)

  const isTauri = '__TAURI_INTERNALS__' in (typeof window !== 'undefined' ? window : {});
  async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
    if (!isTauri) return null;
    return tauriInvoke(cmd, args);
  }

  async function runCommand() {
    const cmd = termInput.trim();
    if (!cmd || termRunning) return;
    termInput = '';
    termOutput = [...termOutput, `$ ${cmd}`];
    termRunning = true;
    scrollToBottom();
    try {
      let result: string;
      if (isDestructiveCmd(cmd)) {
        result = '(command denied: deleting files is not allowed)';
      } else if (isTauri) {
        result = await invoke('run_shell', { cmd }) || '';
      } else {
        result = '(shell requires Tauri)';
      }
      termOutput = [...termOutput, ...result.split('\n')];
    } catch (e: any) {
      termOutput = [...termOutput, `error: ${e}`];
    }
    termRunning = false;
    scrollToBottom();
  }

  function termKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); runCommand(); }
  }

  function onInput(_e: Event) {
    // bind:value handles it
  }

  function scrollToBottom() {
    // next tick
    setTimeout(() => {
      if (termContainer) termContainer.scrollTop = termContainer.scrollHeight;
    }, 0);
  }
</script>

<main class="term-main">
  <div class="editor-header">
    <span>Terminal (shell via run_shell)</span>
  </div>
  <div class="term-output" bind:this={termContainer}>
    {#each termOutput as line}
      <div class="term-line" class:dim={line.startsWith('error:') || line.startsWith('(shell')}>{line}</div>
    {/each}
  </div>
  <div class="term-prompt">
    <span class="term-ps1">$</span>
    <input
      class="term-input"
      bind:value={termInput}
      onkeydown={termKeydown}
      oninput={onInput}
      disabled={termRunning}
      placeholder="enter command (e.g. ls, gemma --help)"
    />
  </div>
  <div class="term-hint" style="font-size:10px; color:var(--dim); padding:4px 0 0 20px;">
    Enter to run · non-destructive only (rm blocked by backend)
  </div>
</main>

<style>
  /* Terminal styles (pulled from gemma-code reference) */
  .term-main {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    font-family: var(--font-mono); font-size: 13px;
    background: #0a0c10;
  }
  .term-output { display: flex; flex-direction: column; gap: 1px; }
  .term-line { color: var(--text); line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
  .term-line.dim { color: var(--dim); }
  .term-prompt { display: flex; align-items: center; gap: 10px; }
  .term-ps1 { color: var(--green); font-family: var(--font-mono); font-size: 13px; font-weight: 600; flex-shrink: 0; }
  .term-input {
    border-radius: 0; border: none; border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    background: transparent; font-family: var(--font-mono); font-size: 13px;
  }
  .term-input:focus { border-color: rgba(167, 139, 250, 0.4); box-shadow: none; }
  .term-hint { font-size: 10px; color: var(--dim); padding: 4px 0 0 20px; }
</style>
