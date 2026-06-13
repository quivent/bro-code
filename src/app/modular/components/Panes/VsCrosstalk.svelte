<script lang="ts">
  import type { ChatPane, Endpoint } from '../../lib/types';
  import { renderMd } from '../../lib/utils';

  // Full VS (crosstalk) layout props: thread rendering, live panes, stop, splash, vsThread logic, getPaneConfig parity.
  // Uses custom vs-msg rendering (not ChatPaneComp, as crosstalk is flattened cross-thread transcript vs per-pane history).
  // DualPanes uses ChatPaneComp; this provides parity in look/feel (colors, splash, seed, live streaming blocks, stop).
  let {
    vsThread = [],
    vsRunning = false,
    vsSeed = '',
    vsRound = 0,
    maxVsRounds = 10,
    leftPane,
    rightPane,
    endpoints = [],
    chatClick = () => {},
    onUpdateAutoScroll = () => {},
    onStopVs = () => {},
    // Optional show stop control inside (for full layout); host can manage footer stop separately.
    showStop = true,
  } = $props();

  let vsContainer: HTMLElement | undefined = $state();

  function getPaneConfig(pane: ChatPane) {
    const ep = endpoints.find((e) => e.id === pane.endpointId) || endpoints[0];
    return {
      url: ep?.url ?? '',
      model: ep?.model ?? '',
      name: ep?.name ?? 'gemma'
    };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<main class="vs-main" bind:this={vsContainer} onclick={chatClick} onscroll={() => onUpdateAutoScroll(vsContainer)}>
  {#if !vsThread.length && !leftPane.streaming && !rightPane.streaming}
    <div class="splash">
      <div class="splash-vs">
        <span style:color="#3fb6b2">{getPaneConfig(leftPane).name}</span>
        <span class="vs-sword">vs</span>
        <span style:color="#f0883e">{getPaneConfig(rightPane).name}</span>
      </div>
      <p class="tagline">seed a topic · they'll take it from there</p>
    </div>
  {/if}

  {#if vsSeed}
    <div class="vs-seed">"{vsSeed}"</div>
  {/if}

  {#each vsThread as msg}
    <div class="vs-msg {msg.side}">
      <div class="vs-role" style:color={msg.side === 'left' ? '#3fb6b2' : '#f0883e'}>
        {msg.side === 'left' ? getPaneConfig(leftPane).name : getPaneConfig(rightPane).name}
      </div>
      <div class="content markdown">{@html renderMd(msg.content)}</div>
    </div>
  {/each}

  {#if leftPane.streaming && leftPane.response}
    <div class="vs-msg left live">
      <div class="vs-role" style:color="#3fb6b2">{getPaneConfig(leftPane).name}</div>
      <div class="content markdown">{@html renderMd(leftPane.response)}</div>
    </div>
  {/if}

  {#if rightPane.streaming && rightPane.response}
    <div class="vs-msg right live">
      <div class="vs-role" style:color="#f0883e">{getPaneConfig(rightPane).name}</div>
      <div class="content markdown">{@html renderMd(rightPane.response)}</div>
    </div>
  {/if}

  {#if vsRunning && !leftPane.streaming && !rightPane.streaming}
    <div class="vs-waiting">switching...</div>
  {/if}
</main>

{#if showStop && vsRunning}
  <div class="vs-footer">
    <div class="vs-status">
      <span class="streaming">● round {vsRound}/{maxVsRounds}</span>
      <button class="stop-btn" onclick={onStopVs}>stop</button>
    </div>
  </div>
{/if}

<style lang="postcss">
  .vs-main {
    flex: 1; overflow-y: auto; padding: 16px 24px; scroll-behavior: smooth;
  }
  .splash {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 55vh; opacity: 0.5;
  }
  .tagline { margin-top: 16px; color: var(--lavend); font-size: 13px; letter-spacing: 0.5px; opacity: 0.7; }
  .splash-vs {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
    font-weight: 600;
  }
  .vs-sword { color: var(--muted); font-size: 14px; }

  .vs-seed {
    color: var(--text-secondary); font-size: 13px; font-style: italic;
    padding: 10px 14px; margin-bottom: 16px;
    background: rgba(42, 42, 58, 0.15); border-radius: 6px;
    border-left: 2px solid var(--muted);
  }
  .vs-msg { margin-bottom: 18px; max-width: 720px; padding-left: 10px; animation: fadeIn 200ms ease; }
  .vs-msg.left { border-left: 2px solid #3fb6b2; }
  .vs-msg.right { border-left: 2px solid #f0883e; }
  .vs-msg.live { opacity: 0.85; }
  .vs-role { font-weight: 600; font-size: 11px; margin-bottom: 4px; letter-spacing: 0.3px; }
  .vs-waiting { color: var(--dim); font-size: 11px; font-family: var(--font-mono); padding: 6px 0; }

  .vs-footer {
    padding: 6px 16px;
    border-top: 1px solid rgba(42, 42, 58, 0.3);
  }
  .vs-status {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
  }
  .streaming { color: #fbbf24; font-family: var(--font-mono); }
  .stop-btn {
    background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.3);
    color: var(--red); padding: 3px 10px; border-radius: 4px; font-size: 10px; font-family: var(--font-mono);
    cursor: pointer;
  }
  .stop-btn:hover { background: rgba(248, 113, 113, 0.25); }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
</style>
