<script lang="ts">
  import type { ChatPane as ChatPaneType, Message } from '../../lib/types';
  import ChatMessage from './ChatMessage.svelte';
  import StreamingMessage from './StreamingMessage.svelte';
  import ExecCard from './ExecCard.svelte'; // if exec separate
  import { renderMd } from '../../lib/utils';

  export let pane: ChatPaneType;
  export let onSend: (text: string) => void;
  export let onKeydown: (e: KeyboardEvent) => void = () => {};
  export let inputText: string;
  export let chatClick: (e: MouseEvent) => void;
  export let copyMsg: (e: MouseEvent, content: string) => void;
  export let container: HTMLElement | undefined = undefined;
  export let onScroll: () => void = () => {};
  // For dual/vs, pass messages as pane.messages etc.
  // onKeydown, onScroll, container are optional for partial integrations from the monolith
  // (full port will wire them when the component owns the input + scroll container ref).
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<main class="pane-main" bind:this={container} onclick={chatClick} onscroll={onScroll}>
  {#if pane.messages.length === 0 && !pane.streaming}
    <div class="splash">
      <p class="tagline">pane ready</p>
    </div>
  {/if}
  {#each pane.messages as msg}
    {#if msg.exec}
      <div class="exec-card {msg.exec.approved ? 'ran' : 'denied'}">
        <div class="exec-cmd"><span class="exec-ps">$</span> {msg.exec.cmd}</div>
        <pre class="exec-out">{msg.exec.output || (msg.exec.approved ? '' : 'denied')}</pre>
      </div>
    {:else}
    <div class="message {msg.role}">
      <div class="role">
        {msg.role === 'user' ? '▸ you' : '✻ gemma'}
        {#if msg.role === 'assistant'}
          <button class="msg-copy" type="button" onclick={(e) => copyMsg(e, msg.content)}>copy</button>
        {/if}
      </div>
      {#if msg.thinking}
        <details class="thinking">
          <summary>thinking</summary>
          <div class="thinking-text">{msg.thinking}</div>
        </details>
      {/if}
      <div class="content markdown">
        {@html renderMd(msg.content)}
      </div>
    </div>
    {/if}
  {/each}
  {#if pane.streaming && (pane.response || pane.streaming)}
    <StreamingMessage 
      currentResponse={pane.response} 
      currentThinking="" 
      onChatClick={chatClick} 
      tokens={pane.tokens ?? 0}
      elapsed={pane.elapsed ?? 0}
    />
  {/if}
</main>

<!-- Input would be separate, but for pane in dual, the input is in mode bar or per pane -->
<style>
  /* pane styles, splash, message etc from main */
  .pane-main { flex: 1; overflow-y: auto; padding: 8px 16px; scroll-behavior: auto; }
  /* copy other relevant from .pane-main, .message etc */
</style>
