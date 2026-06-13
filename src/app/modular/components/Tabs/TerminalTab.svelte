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

<style lang="postcss">
  /* Terminal styles from original */
</style>
