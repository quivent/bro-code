<script lang="ts">
  // ChatComposer: full chat tab UI (solo + dual + vs + supervision) + mode bar + footer.
  // Receives live state + callbacks from host (App.svelte hybrid). Core send/exec/memory via unified agent passed through callbacks.
  import type { ChatPane, Message, Endpoint } from '../../lib/types';
  import ChatPaneComp from './ChatPane.svelte';
  import DualPanes from '../Panes/DualPanes.svelte';
  import VsCrosstalk from '../Panes/VsCrosstalk.svelte';
  import { renderMd } from '../../lib/utils';

  // Props from host (App state + handlers). Hybrid during final modular polish.
  // Converted to Svelte 5 runes $props() syntax.
  // Use `let` (not const) because several props are $bindable (for bind:this on containers + inputEl).
  let {
    chatMode = 'solo' as 'solo' | 'dual' | 'vs' | 'supervision',
    messages = [] as Message[],
    streaming = false,
    currentResponse = '',
    currentThinking = '',
    tokenCount = 0,
    elapsed = 0,
    error = '',
    queue = [] as string[],
    pendingExec = null as { cmd: string } | null,

    // Dual / panes
    leftPane,
    rightPane,
    leftInputText = '',
    rightInputText = '',
    leftContainer = $bindable(undefined as HTMLElement | undefined),
    rightContainer = $bindable(undefined as HTMLElement | undefined),
    vsContainer = $bindable(undefined as HTMLElement | undefined),
    vsThread = [] as Array<{ side: 'left' | 'right'; content: string }>,
    vsSeed = '',
    vsRunning = false,
    vsRound = 0,
    maxVsRounds = 10,
    supervisionThoughts = '',
    supervisionRunning = false,

    // Shared
    inputText = '',
    inputEl = $bindable(undefined as HTMLTextAreaElement | undefined),
    chatContainer = $bindable(undefined as HTMLElement | undefined),
    endpoints = [] as Endpoint[],
    activeName = '',
    ctxPct = 0,
    ctxUsedTokens = 0,
    ctxWindow = null as number | null,

    // Callbacks wired from host
    onModeChange = () => {},
    onSave = () => {},
    onClear = () => {},

    // Supervision specific
    mainEndpointId = null as string | null,
    supervisorEndpointId = null as string | null,
    onChatClick = () => {},
    onCopyMsg = () => {},
    onSend = () => {},
    onSendToSide = () => {},
    onKeydown = () => {},
    onLeftKeydown = (() => {}) as (e: KeyboardEvent) => void,
    onRightKeydown = (() => {}) as (e: KeyboardEvent) => void,
    onStopVs = () => {},
    onAnswerExec = (() => {}) as (ok: boolean, always?: boolean, feedback?: string) => void,
    onUpdateAutoScroll = () => {},
    onScrollActivePane = (() => {}) as (side?: 'left' | 'right') => void,

    // For dual footer inputs
    leftKeydown = () => {},
    rightKeydown = () => {},
  } = $props();

  // Local state for "Say something back" feedback in this composer instance (for when it's the main chat UI)
  let showFeedbackInput = $state(false);
  let feedbackInput = $state('');

  function startFeedback() {
    showFeedbackInput = true;
    feedbackInput = `Do not do things like 'ls ~' which hangs forever. `;
  }

  function cancelFeedback() {
    showFeedbackInput = false;
    feedbackInput = '';
  }

  function submitFeedbackDeny() {
    const fb = feedbackInput.trim();
    onAnswerExec(false, false, fb);
    showFeedbackInput = false;
    feedbackInput = '';
  }

  // Helpers that were in monolith (moved here for encapsulation; can be further extracted)
  function getPaneConfig(pane: ChatPane) {
    const ep = endpoints.find((e) => e.id === pane.endpointId) || endpoints[0];
    return { name: ep?.name || 'unknown', url: ep?.url || '', model: ep?.model || '' };
  }
</script>

<!-- Mode switcher -->
<div class="chat-mode-bar">
  <button class:active={chatMode === 'solo'} onclick={() => onModeChange('solo')}>Solo</button>
  <button class:active={chatMode === 'dual'} onclick={() => onModeChange('dual')}>Dual</button>
  <button class:active={chatMode === 'vs'} onclick={() => onModeChange('vs')}>VS (crosstalk)</button>
  <button class:active={chatMode === 'supervision'} onclick={() => onModeChange('supervision')}>Supervision</button>
  <button onclick={onSave} style="margin-left:auto; font-size:10px;">{ /* saveStatus would be passed */ '' || 'save'}</button>
  <button onclick={onClear} style="font-size:10px;">clear</button>
</div>

<!-- Solo -->
{#if chatMode === 'solo'}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<main class="chat-main" bind:this={chatContainer} onclick={onChatClick} onscroll={() => onUpdateAutoScroll(chatContainer)}>
  {#if messages.length === 0 && !streaming}
    <div class="splash">
      <pre class="logo">██████  ███████ ██    ███ ███    ███  █████
██       ██      ██  ███ ████  ████ ██   ██
██   ███ █████   ██ ████ ██ ████ ██ ███████
██    ██ ██      ██  ██  ██  ██  ██ ██   ██
 ██████  ███████ ██      ██      ██ ██   ██</pre>
      <p class="tagline">self-forging agent · type to begin</p>
    </div>
  {/if}
  {#each messages as msg}
    {#if msg.exec}
      <div class="exec-card {msg.exec.approved ? 'ran' : 'denied'}">
        <div class="exec-cmd"><span class="exec-ps">$</span> {msg.exec.cmd}</div>
        <pre class="exec-out">{msg.exec.approved ? msg.exec.output : 'denied'}</pre>
      </div>
    {:else}
    <div class="message {msg.role}">
      <div class="role">
        {msg.role === 'user' ? '▸ you' : '✻ gemma'}
        {#if msg.role === 'assistant'}
          <button class="msg-copy" type="button" onclick={(e) => onCopyMsg(e, msg.content)}>copy</button>
        {/if}
      </div>
      {#if msg.role === 'assistant'}
        {#if msg.thinking}
          <details class="thinking">
            <summary>thinking</summary>
            <div class="thinking-text">{msg.thinking}</div>
          </details>
        {/if}
        <div class="content markdown">{@html renderMd(msg.content)}</div>
      {:else}
        <div class="content user-content">{msg.content}</div>
      {/if}
    </div>
    {/if}
  {/each}
  {#if streaming && (currentResponse || currentThinking)}
    <div class="message assistant">
      <div class="role">✻ gemma</div>
      {#if currentThinking}
        <div class="thinking live">
          <span class="thinking-label">thinking</span>
          <div class="thinking-text">{currentThinking}</div>
        </div>
      {/if}
      {#if currentResponse}
        <div class="content markdown">{@html renderMd(currentResponse)}</div>
      {/if}
    </div>
  {/if}
  {#each queue as q}
    <div class="queued">▸ queued · {q}</div>
  {/each}
  {#if pendingExec}
    <div class="exec-approve">
      <div class="exec-approve-head">⟶ gemma wants to run a command</div>
      <pre class="exec-out">{pendingExec.cmd}</pre>
      {#if showFeedbackInput}
        <textarea bind:value={feedbackInput} placeholder="Tell the agent why (e.g. 'Do not run ls ~ as it hangs forever. Use ls -la /specific/path instead or a different tool.')." rows="2" style="width:100%; margin:6px 0; font-size:12px; font-family:var(--font-mono);"></textarea>
        <div class="exec-approve-btns">
          <button class="exec-yes" onclick={submitFeedbackDeny}>Send feedback &amp; deny</button>
          <button class="exec-no" onclick={cancelFeedback}>Cancel</button>
        </div>
      {:else}
        <div class="exec-approve-btns">
          <button class="exec-yes" onclick={() => onAnswerExec(true)}>Run</button>
          <button class="exec-always" onclick={() => onAnswerExec(true, true)}>Always this session</button>
          <button class="exec-no" onclick={() => onAnswerExec(false)}>Deny</button>
          <button onclick={startFeedback} style="background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);color:#fbbf24;">Say something back</button>
        </div>
      {/if}
    </div>
  {/if}
  {#if error}<div class="error">✗ {error}</div>{/if}

  {#if !streaming && messages.length > 0}
    <div class="stats">{elapsed.toFixed(1)}s · {tokenCount} tok · {(tokenCount / Math.max(elapsed, 0.1)).toFixed(0)} tok/s</div>
  {/if}
</main>

<!-- Dual panes -->
{:else if chatMode === 'dual'}
<DualPanes
  {leftPane}
  {rightPane}
  {endpoints}
  {leftInputText}
  {rightInputText}
  chatClick={onChatClick}
  copyMsg={onCopyMsg}
  leftKeydown={leftKeydown}
  rightKeydown={rightKeydown}
  onSendToSide={onSendToSide}
  onUpdateAutoScroll={onUpdateAutoScroll}
  showInputs={true}
/>

<!-- Supervision -->
{:else if chatMode === 'supervision'}
<div class="supervision-main">
  <div class="supervision-controls">
    <label>Primary model: 
      <select bind:value={mainEndpointId} onchange={() => { /* host save */ }}>
        {#each endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
    </label>
    <label style="margin-left: 16px;">Supervisor model: 
      <select bind:value={supervisorEndpointId} onchange={() => { /* host save */ }}>
        <option value={null}>(same as primary)</option>
        {#each endpoints as ep}
          <option value={ep.id}>{ep.name}</option>
        {/each}
      </select>
    </label>
  </div>
  <div class="supervision-split">
    <div class="primary-chat">
      <div class="pane-label">Primary (you talk here — full memory + context via unified agent)</div>
      <ChatPaneComp
        pane={{ messages, streaming, response: currentResponse, tokens: tokenCount, elapsed, error: '', endpointId: mainEndpointId } as any}
        onSend={(t: string) => onSend(t)}
        inputText={inputText}
        chatClick={onChatClick}
        copyMsg={onCopyMsg}
        onKeydown={onKeydown}
        onScroll={() => onUpdateAutoScroll(undefined)}
      />
    </div>
    <div class="supervisor-panel">
      <div class="pane-label">Supervisor (observes + [SUPERVISION] notes)</div>
      <div class="supervisor-log">
        {#if supervisionThoughts}
          <pre>{supervisionThoughts}</pre>
        {:else}
          <p class="hint">Supervisor reviews using SUPERVISION_AWARENESS + the same unified memory/prompt/context. Choose a different model above for asymmetric oversight.</p>
        {/if}
        {#if supervisionRunning}
          <div style="color:#fbbf24;">Supervisor thinking...</div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- VS crosstalk -->
{:else if chatMode === 'vs'}
<VsCrosstalk
  {vsThread}
  {vsRunning}
  {vsSeed}
  {vsRound}
  {maxVsRounds}
  {leftPane}
  {rightPane}
  {endpoints}
  chatClick={onChatClick}
  onUpdateAutoScroll={onUpdateAutoScroll}
  onStopVs={onStopVs}
  showStop={false}
/>
{/if}

<!-- Footer / inputs (ctx bar, dual inputs, solo input) -->
<footer>
  {#if chatMode === 'solo'}
    <div class="ctx-bar" title="Context = full message history sent with each request. Usage estimated at 4 chars/token; window is the server's max_model_len.">
      <span class="ctx-label">ctx</span>
      <div class="ctx-track">
        <div class="ctx-fill" class:warn={ctxPct > 75} class:crit={ctxPct > 90} style:width="{ctxWindow ? Math.max(ctxPct, 1.5) : 0}%"></div>
      </div>
      <div class="ctx-text">
        {#if ctxWindow}
          {(ctxUsedTokens / 1000).toFixed(1)}k / {(ctxWindow / 1000).toFixed(0)}k · {(Math.max(0, ctxWindow - ctxUsedTokens) / 1000).toFixed(1)}k left
        {:else}
          ~{(ctxUsedTokens / 1000).toFixed(1)}k used · window unknown
        {/if}
      </div>
    </div>
  {/if}
  {#if chatMode === 'vs' && vsRunning}
    <div class="vs-footer">
      <div class="vs-status">
        <span class="streaming">● round {vsRound}/{maxVsRounds}</span>
        <button class="stop-btn" onclick={onStopVs}>stop</button>
      </div>
    </div>
  {:else}
    <div class="input-row">
      <textarea bind:this={inputEl} bind:value={inputText} onkeydown={onKeydown}
        placeholder={chatMode === 'vs' ? 'seed a topic for them to discuss...'
          : chatMode === 'supervision' ? 'message to primary (supervisor will review)...'
          : streaming ? 'draft your next message — Enter queues it to send next…'
          : 'talk to gemma...'}
        rows="2"></textarea>
      {#if chatMode === 'vs' && vsRunning}
        <button class="stop-btn" onclick={onStopVs}>stop</button>
      {/if}
    </div>
  {/if}
</footer>

<style lang="postcss">
  /* Consolidated chat UI styles for solo/dual/vs/supervision (sourced from extracted ChatMessage/ExecCard + original chat affordances). */
  .chat-mode-bar { display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid rgba(42,42,58,0.4); }
  .chat-mode-bar button { background: rgba(28,33,40,0.6); border: 1px solid rgba(42,42,58,0.5); color: var(--text-secondary); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: var(--font-mono); cursor: pointer; }
  .chat-mode-bar button.active { background: var(--bg-elevated); color: var(--text); border-color: rgba(167,139,250,0.4); }
  .chat-mode-bar button:hover { color: var(--text); }

  .chat-main { flex: 1; overflow-y: auto; padding: 24px 32px; scroll-behavior: auto; }
  .splash { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 55vh; opacity: 0.5; }
  .logo { font-family: var(--font-mono); font-size: 11px; line-height: 1.05; color: var(--lavend); }
  .tagline { margin-top: 16px; color: var(--lavend); font-size: 13px; letter-spacing: 0.5px; opacity: 0.7; }

  .message { margin-bottom: 20px; max-width: 780px; animation: fadeIn 200ms ease; }
  .message.user .role { color: var(--blue); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .message.assistant .role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 6px; letter-spacing: 0.3px; }
  .user-content { color: var(--text); font-size: 14px; line-height: 1.6; padding: 10px 14px; background: var(--bg-secondary); border-radius: 10px; border: 1px solid rgba(42,42,58,0.5); }
  .message.assistant .content { color: var(--text); font-size: 14px; line-height: 1.75; padding: 4px 0; }
  .markdown { /* content inside */ }
  .msg-copy { margin-left: 8px; background: transparent; color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; font-size: 10px; font-family: var(--font-mono); padding: 1px 7px; cursor: pointer; opacity: 0.35; transition: opacity 0.15s ease; }
  .message:hover .msg-copy { opacity: 1; }
  .msg-copy:hover { color: var(--text); border-color: rgba(255,255,255,0.3); }

  .thinking { margin: 0 0 10px; }
  .thinking summary { color: var(--dim); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.3px; cursor: pointer; opacity: 0.7; user-select: none; }
  .thinking summary:hover { opacity: 1; }
  .thinking-label { display: block; color: var(--dim); font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.3px; opacity: 0.7; }
  .thinking-text { color: var(--muted); font-size: 12px; line-height: 1.6; white-space: pre-wrap; font-style: italic; opacity: 0.75; border-left: 2px solid rgba(167,139,250,0.25); padding: 2px 0 2px 10px; margin-top: 4px; }

  .exec-card { margin: 8px 0; padding: 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; }
  .exec-card.ran { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); }
  .exec-card.denied { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); }
  .exec-cmd { color: var(--dim); margin-bottom: 4px; }
  .exec-ps { color: var(--lavend); }
  .exec-out { white-space: pre-wrap; color: var(--text); margin: 0; }

  .queued { color: var(--muted); font-size: 12px; font-family: var(--font-mono); padding: 2px 0; }
  .error { color: #f87171; margin: 12px 0; font-family: var(--font-mono); }
  .stats { margin-top: 12px; color: var(--dim); font-size: 11px; font-family: var(--font-mono); }

  .exec-approve { margin: 16px 0; padding: 12px; border: 1px solid rgba(251,191,36,0.3); background: rgba(251,191,36,0.06); border-radius: 8px; }
  .exec-approve-head { color: #fbbf24; font-size: 12px; margin-bottom: 6px; font-family: var(--font-mono); }
  .exec-approve-btns { display: flex; gap: 8px; margin-top: 8px; }
  .exec-approve-btns button { font-size: 11px; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: var(--font-mono); }
  .exec-yes { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.4); color: #34d399; }
  .exec-always { background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.3); color: var(--lavend); }
  .exec-no { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #f87171; }

  .ctx-bar { display: flex; align-items: center; gap: 10px; padding: 4px 12px; font-size: 11px; color: var(--muted); font-family: var(--font-mono); border-top: 1px solid rgba(42,42,58,0.25); }
  .ctx-label { font-weight: 600; letter-spacing: 0.5px; }
  .ctx-track { flex: 1; height: 4px; background: rgba(42,42,58,0.4); border-radius: 2px; overflow: hidden; }
  .ctx-fill { height: 100%; background: var(--lavend); transition: width 200ms ease; }
  .ctx-fill.warn { background: #fbbf24; }
  .ctx-fill.crit { background: #f87171; }
  .ctx-text { font-size: 10px; }

  .input-row { padding: 8px; border-top: 1px solid rgba(42,42,58,0.3); }
  .input-row textarea { width: 100%; font-size: 13px; background: var(--bg-secondary); color: var(--text); border: 1px solid rgba(42,42,58,0.5); border-radius: 6px; padding: 8px 10px; resize: none; font-family: var(--font-sans); line-height: 1.4; }

  .stop-btn { background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.3); color: var(--red); padding: 3px 10px; border-radius: 4px; font-size: 10px; font-family: var(--font-mono); cursor: pointer; }
  .stop-btn:hover { background: rgba(248,113,113,0.25); }

  /* supervision (inline in composer for this mode) */
  .supervision-main { display: flex; flex-direction: column; flex: 1; }
  .supervision-controls { padding: 6px 12px; font-size: 11px; border-bottom: 1px solid rgba(42,42,58,0.25); display: flex; align-items: center; gap: 12px; }
  .supervision-split { display: flex; flex: 1; overflow: hidden; }
  .primary-chat, .supervisor-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .pane-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--dim); padding: 4px 8px; border-bottom: 1px solid rgba(42,42,58,0.2); }
  .supervisor-log { flex: 1; padding: 8px; font-family: var(--font-mono); font-size: 12px; overflow: auto; white-space: pre-wrap; color: var(--text-secondary); background: rgba(0,0,0,0.15); }
  .supervisor-log .hint { opacity: 0.6; font-style: italic; }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
</style>
