<script lang="ts">
  import { renderMd } from '../../lib/utils';

  export let currentResponse: string;
  export let currentThinking: string;
  export let onChatClick: (e: MouseEvent) => void;
  export let tokens: number = 0;
  export let elapsed: number = 0;
</script>

<div class="message assistant">
  <div class="role">✻ gemma</div>
  {#if currentThinking}
    <div class="thinking live">
      <span class="thinking-label">thinking</span>
      <div class="thinking-text">{currentThinking}</div>
    </div>
  {/if}
  {#if currentResponse}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="content markdown" onclick={onChatClick}>
      {@html renderMd(currentResponse)}
    </div>
  {/if}
  {#if tokens || elapsed}
    <div class="live-stats" style="color: #ff69b4; font-size: 11px; font-family: var(--font-mono); margin-top: 4px; opacity: 0.85;">
      ● {tokens} tok · {elapsed.toFixed(1)}s
    </div>
  {/if}
</div>

<style lang="postcss">
  .message { margin-bottom: 20px; max-width: 780px; animation: fadeIn 200ms ease; }
  .message.assistant .role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .thinking { margin: 0 0 10px; }
  .thinking.live { border-left: 2px solid var(--lavend); }
  .thinking-label { display: block; color: var(--dim); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.3px; opacity: 0.7; }
  .thinking-text { color: var(--muted); font-size: 12px; line-height: 1.6; white-space: pre-wrap; font-style: italic; opacity: 0.75; padding: 2px 0 2px 10px; margin-top: 4px; }
  .content { color: var(--text); font-size: 14px; line-height: 1.75; padding: 4px 0; }
  /* .ansi-cyan, .ansi-magenta retained in renderMd pipeline but not emitted by current StreamingMessage content; kept for potential reuse or removed if not needed */
</style>
