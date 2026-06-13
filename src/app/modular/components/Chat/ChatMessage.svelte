<script lang="ts">
  import type { Message } from '../../types';
  import { renderMd } from '../../lib/utils';

  export let msg: Message;
  export let onCopy: (content: string) => void;
  export let onChatClick: (e: MouseEvent) => void;
</script>

<div class="message {msg.role}">
  <div class="role">
    {msg.role === 'user' ? '▸ you' : '✻ gemma'}
    {#if msg.role === 'assistant'}
      <button class="msg-copy" type="button" onclick={(e) => onCopy(msg.content)}>copy</button>
    {/if}
  </div>
  {#if msg.exec}
    <div class="exec-card {msg.exec.approved ? 'ran' : 'denied'}">
      <div class="exec-cmd"><span class="exec-ps">$</span> {msg.exec.cmd}</div>
      <pre class="exec-out">{msg.exec.output || (msg.exec.approved ? '' : 'denied')}</pre>
    </div>
  {:else}
    {#if msg.thinking}
      <details class="thinking">
        <summary>thinking</summary>
        <div class="thinking-text">{msg.thinking}</div>
      </details>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="content markdown" onclick={onChatClick}>
      {@html renderMd(msg.content)}
    </div>
  {/if}
</div>

<style lang="postcss">
  /* Styles can be moved from main CSS later, scoped here for modularity */
  .message { margin-bottom: 20px; max-width: 780px; animation: fadeIn 200ms ease; }
  .message.user .role { color: var(--blue); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .message.assistant .role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .user-content { color: var(--text); font-size: 14px; line-height: 1.6; padding: 10px 14px; background: var(--bg-secondary); border-radius: 10px; border: 1px solid rgba(42, 42, 58, 0.5); }
  .message.assistant .content { color: var(--text); font-size: 14px; line-height: 1.75; padding: 4px 0; }
  .ansi-cyan { color: #00e5ff; font-weight: 600; }
  .ansi-magenta { color: #ff69b4; font-weight: 600; }
  .exec-card { margin: 8px 0; padding: 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; }
  .exec-card.ran { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); }
  .exec-card.denied { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); }
  .exec-cmd { color: var(--dim); margin-bottom: 4px; }
  .exec-ps { color: var(--lavend); }
  .exec-out { white-space: pre-wrap; color: var(--text); margin: 0; }
  .thinking { margin: 0 0 10px; }
  .thinking summary { color: var(--dim); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.3px; cursor: pointer; opacity: 0.7; user-select: none; }
  .thinking summary:hover { opacity: 1; }
  .thinking-label { display: block; color: var(--dim); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.3px; opacity: 0.7; }
  .thinking-text { color: var(--muted); font-size: 12px; line-height: 1.6; white-space: pre-wrap; font-style: italic; opacity: 0.75; border-left: 2px solid rgba(167, 139, 250, 0.25); padding: 2px 0 2px 10px; margin-top: 4px; }
  .msg-copy { margin-left: 8px; background: transparent; color: var(--text-secondary); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px; font-size: 10px; font-family: var(--font-mono); padding: 1px 7px; cursor: pointer; opacity: 0.35; transition: opacity 0.15s ease; }
  .message:hover .msg-copy { opacity: 1; }
  .msg-copy:hover { color: var(--text); border-color: rgba(255, 255, 255, 0.3); }
</style>
