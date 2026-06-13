<script lang="ts">
  import type { ChatPane, Endpoint } from '../../lib/types';
  import ChatPaneComp from '../Chat/ChatPane.svelte';

  // Full dual layout props (headers, selects, split, scroll, inputs, getPaneConfig parity)
  // Accept all necessary handlers for seamless drop-in use (monolith may keep inline for container refs; modular/ChatComposer can use directly).
  let {
    leftPane,
    rightPane,
    endpoints = [],
    leftInputText = '',
    rightInputText = '',
    chatClick = () => {},
    copyMsg = () => {},
    leftKeydown = () => {},
    rightKeydown = () => {},
    // onSendToSide used for per-pane ChatPaneComp onSend wiring and/or host; defaults to no-op (inputs live in host footer for tight monolith coupling).
    onSendToSide = () => {},
    onUpdateAutoScroll = () => {},
    // Optional: whether DualPanes owns/renders the split dual-inputs UI (full layout port). Host footers can set false to avoid dup.
    showInputs = true,
  } = $props();

  // Internal scroll containers (component owns for its usage; monolith inline path binds its own top-level ones).
  let leftContainer: HTMLElement | undefined = $state();
  let rightContainer: HTMLElement | undefined = $state();

  function getPaneConfig(pane: ChatPane) {
    const ep = endpoints.find((e) => e.id === pane.endpointId) || endpoints[0];
    return {
      url: ep?.url ?? '',
      model: ep?.model ?? '',
      name: ep?.name ?? 'gemma',
      color: '#3fb6b2'
    };
  }

  // When endpoint select changes, also mirror to top-level ids if host passed them (no-op safe).
  function onLeftEndpointChange() {
    // leftEndpointId sync is host concern; pane.endpointId is already bound.
  }
  function onRightEndpointChange() {
    // same for right
  }
</script>

<div class="split">
  <!-- Left Pane (headers + select + ChatPaneComp for exec-card + StreamingMessage parity) -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <main class="pane-main" bind:this={leftContainer} onclick={chatClick} onscroll={() => onUpdateAutoScroll(leftContainer)}>
    <div class="pane-header">
      <select bind:value={leftPane.endpointId} onchange={onLeftEndpointChange}>
        {#each endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
      <span class="pane-label" style:color="#3fb6b2">{getPaneConfig(leftPane).name}</span>
    </div>
    <ChatPaneComp
      pane={leftPane as any}
      onSend={(t: string) => onSendToSide('left')}
      inputText={leftInputText}
      chatClick={chatClick}
      copyMsg={copyMsg}
      onKeydown={() => {}}
      onScroll={() => onUpdateAutoScroll(leftContainer)}
    />
  </main>

  <div class="divider"></div>

  <!-- Right Pane -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <main class="pane-main" bind:this={rightContainer} onclick={chatClick} onscroll={() => onUpdateAutoScroll(rightContainer)}>
    <div class="pane-header">
      <select bind:value={rightPane.endpointId} onchange={onRightEndpointChange}>
        {#each endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
      <span class="pane-label" style:color="#f0883e">{getPaneConfig(rightPane).name}</span>
    </div>
    <ChatPaneComp
      pane={rightPane as any}
      onSend={(t: string) => onSendToSide('right')}
      inputText={rightInputText}
      chatClick={chatClick}
      copyMsg={copyMsg}
      onKeydown={() => {}}
      onScroll={() => onUpdateAutoScroll(rightContainer)}
    />
  </main>
</div>

{#if showInputs}
<div class="dual-inputs">
  <div class="dual-input">
    <div class="dual-label" style:color="#3fb6b2">{getPaneConfig(leftPane).name}</div>
    <textarea bind:value={leftInputText} onkeydown={leftKeydown}
      placeholder="message for left..."
      rows="2" disabled={leftPane.streaming}></textarea>
  </div>
  <div class="dual-input">
    <div class="dual-label" style:color="#f0883e">{getPaneConfig(rightPane).name}</div>
    <textarea bind:value={rightInputText} onkeydown={rightKeydown}
      placeholder="message for right..."
      rows="2" disabled={rightPane.streaming}></textarea>
  </div>
</div>
{/if}

<style lang="postcss">
  .split { display: flex; flex: 1; overflow: hidden; }
  .pane-main { flex: 1; overflow-y: auto; padding: 8px 16px; scroll-behavior: auto; }
  .pane-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 11px;
  }
  .pane-header select {
    font-size: 10px;
    background: var(--bg-secondary);
    color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5);
    border-radius: 3px;
    padding: 2px 4px;
  }
  .pane-label {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    flex: 1;
  }
  .divider {
    width: 1px;
    background: linear-gradient(180deg, transparent, var(--border), transparent);
    flex-shrink: 0;
  }

  .dual-inputs {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 8px 0;
    border-top: 1px solid rgba(42, 42, 58, 0.3);
  }
  .dual-input {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .dual-input textarea {
    width: 100%;
    font-size: 13px;
    background: var(--bg-secondary);
    color: var(--text);
    border: 1px solid rgba(42, 42, 58, 0.5);
    border-radius: 6px;
    padding: 6px 8px;
    resize: none;
  }
  .dual-label {
    font-size: 10px;
    font-family: var(--font-mono);
    margin-bottom: 2px;
    font-weight: 600;
  }
</style>
