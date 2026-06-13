<script lang="ts">
  import type { ModelConfig } from '../types';
  import type { ChatPaneState } from '../lib/dual-chat';

  export let pane: ChatPaneState;
  export let config: ModelConfig;
  export let container: HTMLElement | undefined = undefined;
  export let render: (md: string) => string = (md: string) => md; // pass renderMd from consumer
</script>

<main class="pane-main" bind:this={container}>
  <div class="pane-label" style:color={config.color || '#3fb6b2'} style:border-bottom-color={config.color || '#3fb6b2'}>
    {config.name}
  </div>

  {#if !pane.messages.length && !pane.streaming}
    <div class="splash mini">
      <span style:color={config.color}>{config.label || config.name}</span>
    </div>
  {/if}

  {#each pane.messages as msg}
    <div class="message {msg.role}">
      <div class="role" style:color={msg.role === 'user' ? 'var(--blue)' : config.color}>
        {msg.role === 'user' ? '▸ you' : (config.label || '✻ ' + config.name)}
      </div>
      {#if msg.role === 'assistant'}
        <div class="content markdown">{@html render(msg.content)}</div>
      {:else}
        <div class="content user-content">{msg.content}</div>
      {/if}
    </div>
  {/each}

  {#if pane.streaming && pane.response}
    <div class="message assistant">
      <div class="role" style:color={config.color}>{config.label || config.name}</div>
      <div class="content markdown">{@html render(pane.response)}</div>
    </div>
  {/if}

  {#if pane.error}<div class="error">{pane.error}</div>{/if}

  {#if !pane.streaming && pane.messages.length}
    <div class="stats">{pane.elapsed.toFixed(1)}s · {pane.tokens} tok</div>
  {/if}
</main>

<style>
  .pane-main {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px;
  }

  .pane-label {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 8px 0 6px;
    border-bottom: 1px solid;
    margin-bottom: 12px;
    opacity: 0.8;
  }

  .splash.mini {
    height: 25vh;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
  }

  .message {
    margin-bottom: 20px;
    max-width: 780px;
    animation: fadeIn 200ms ease;
  }

  .role {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 6px;
    letter-spacing: 0.3px;
  }

  .content {
    color: var(--text);
    font-size: 14px;
    line-height: 1.75;
    padding: 4px 0;
  }

  .user-content {
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
    padding: 10px 14px;
    background: var(--bg-secondary);
    border-radius: 10px;
    border: 1px solid rgba(42, 42, 58, 0.5);
  }

  .error {
    color: var(--red);
    font-size: 12px;
    font-family: var(--font-mono);
    padding: 8px 0;
  }

  .stats {
    color: var(--dim);
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 8px 0 20px;
    opacity: 0.6;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
