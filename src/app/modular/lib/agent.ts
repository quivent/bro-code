import type { InvokeFn, Message, ChatPane, CtxEntry, Endpoint } from './types';
import { buildApiMessages, loadContext, pruneHistoryForContext } from './context';
import { settings as appSettings, resolveModelForEndpoint } from './settings-store.svelte.ts';  // for runtime maxHistoryTurns + shared model inference from /v1/models
import { loadMemory, persistMemory, getMemorySection, type MemoryManagerOptions } from './memory';
import { loadPrompt } from './prompt';
import { extractExecCalls, EXEC_AWARENESS, runExec, requestExecApproval, isDestructiveCmd, type ExecApprovalResult } from './scp';
import { splitThinking, trimPartialTag } from './thinking'; // now local to unified package for drop-in reuse
import { SUPERVISION_AWARENESS } from './supervision';
import { defaultConfig, createDefaultInvoke } from './config';

// Local copy of the normalizer (pure, no dep on store to avoid import cycles with agent usages).
// Keep in sync with the one in settings-store.svelte.ts.
function normalizeToChatCompletions(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  try {
    const u = new URL(url);
    if (!u.hostname || /\s/.test(u.hostname) || u.hostname.includes(' ') || u.hostname.startsWith('[')) {
      return '';
    }
    let path = u.pathname.replace(/\/+$/, '');
    path = path.replace(/\/v1(\/+v1)*/g, '/v1');
    // If the path contains "completions", trust it as a specific/full URL (for remote/custom servers).
    if (/completions/i.test(path)) {
      u.pathname = path;
      return u.toString();
    }
    if (!path || path === '/' || path === '/v1' || path === '/api') {
      path = '/v1/chat/completions';
    } else if (!path.includes('/chat/completions') && !path.includes('/v1/')) {
      path = (path.endsWith('/v1') ? path : path + '/v1') + '/chat/completions';
    } else if (!path.endsWith('/chat/completions')) {
      path = path + '/chat/completions';
    }
    u.pathname = path;
    return u.toString();
  } catch {
    return '';
  }
}

function getModelsUrl(chatUrl: string): string {
  try {
    const full = normalizeToChatCompletions(chatUrl);
    if (!full) return '';
    const u = new URL(full);
    if (u.pathname.endsWith('/chat/completions')) {
      u.pathname = u.pathname.replace(/\/chat\/completions$/, '/models');
      return u.toString();
    }
    let base = u.pathname.replace(/\/$/, '') || '/v1';
    base = base.replace(/\/v1(\/+v1)*/g, '/v1');
    u.pathname = base + '/models';
    return u.toString();
  } catch {
    return '';
  }
}

// resolveModelForEndpoint is now shared from settings-store (single source of truth for /v1/models inference)

// Reusable agent core for solo + dual/VS. Provides memory + prompt + full context access.
export interface AgentCore {
  config: any;
  systemContext: string;
  ctxEntries: CtxEntry[];
  promptText: string;
  memRaw: Record<string, any>;
  memCells: any[];
  loadAll: (ctxEntries?: CtxEntry[]) => Promise<void>;
  buildMessages: (history: Array<{role: string; content: string}>) => Array<{role: string; content: string}>;
  // Main entry point: handles full agent loop including streaming turns and exec approval rounds.
  // The onExecApproval callback allows the UI layer to show approval UI and return the decision.
  send: (
    text: string,
    options?: {
      onUpdate?: (partial: {response: string, thinking: string, tokens: number, elapsed?: number}) => void;
      onExecApproval?: (cmd: string) => Promise<boolean>;
      pane?: ChatPane; // for compatibility with dual/supervision panes
      extraConfig?: any;
    }
  ) => Promise<string | { reply?: string; history?: any[] } | null>;

  // For dual panes / supervision: prepare rich messages including memory/prompt/SCP for any model
  prepareApiMessages: (history: Array<{role: string; content: string}>) => Array<{role: string; content: string}>;
  // Dedicated for Supervision mode: review a turn with supervisor awareness + shared memory/context
  superviseTurn: (primaryUser: string, primaryAssistant: string, supervisorConfig?: { endpoint: string; model: string; temperature?: number }) => Promise<string>;
  // For advanced streaming in unified modes
  streamTurn: (apiMessages: Array<{role: string; content: string}>, onUpdate: (partial: {response: string, thinking: string, tokens: number}) => void, endpointsList?: Endpoint[], activeId?: string | null, temperature?: number, maxTokens?: number) => Promise<{ full: string; thinking: string; error?: string }>;
}

export async function createAgentCore(opts: {
  invoke?: InvokeFn;
  promptFile?: string;
  memoryFile?: string;
  // Endpoints and chat params for rich streaming (optional for dual-only use)
  endpoints?: Endpoint[];
  activeEndpointId?: string | null;
  chatTemperature?: number;
  chatMaxTokens?: number;
  autoFallback?: boolean;
  // Optional hook (kept for external VS/custom consumers)
  streamToPane?: any;
  // Full ctx (files + dirs) for parity: when provided, loadContext will use this list (incl. prompt/memory + extras)
  // so agent.buildMessages / send get the same system context as monolith loadContext.
  ctxEntries?: CtxEntry[];
}): Promise<AgentCore> {
  const invoke = opts.invoke || createDefaultInvoke();
  const promptFile = opts.promptFile || defaultConfig.promptFile!;
  const memoryFile = opts.memoryFile || defaultConfig.memoryFile!;

  let systemContext = '';
  let ctxEntries: CtxEntry[] = [];
  let promptText = '';
  let memRaw: Record<string, any> = {};
  let memCells: any[] = [];

  // Streaming state internal to streamTurn (for abort partials + controller).
  // NOTE: `streaming` flag removed as vestigial (was never driven true by send or streamTurn;
  // send() manages pane.streaming + its own elapsed; early abort guard now unconditional).
  let abortController: AbortController | null = null;
  let currentResponse = '';
  let currentThinking = '';
  let tokenCount = 0;

  // Track commands rejected this agent lifetime so we don't call the same one twice after a reject.
  const rejectedCmds = new Set<string>();

  const memOpts: MemoryManagerOptions = { invoke, memoryFile };

  async function loadAll(passedCtxEntries?: CtxEntry[]) {
    // Load prompt + memory + full context (this gives "memory access" to dual mode too)
    // Accepts optional passed ctxEntries (from createAgentCore opts or runtime host current state)
    // so that loadAll(ctxEntries) after adds/dirs in monolith or components uses the latest list
    // (including dirs which loadContext now expands via real run_shell). Falls back to creation-time.
    promptText = await loadPrompt({ invoke, promptFile });
    const mem = await loadMemory(memOpts);
    memRaw = mem.memRaw;
    memCells = mem.memCells;

    const useCtx = (passedCtxEntries && passedCtxEntries.length > 0) ? passedCtxEntries : opts.ctxEntries;
    // cast to satisfy ContextManagerOptions (which extends Partial<AgentConfig>); the manager handles promptFile/memoryFile internally
    const ctx = await loadContext({ invoke, promptFile, memoryFile, ctxEntries: useCtx } as any);
    systemContext = ctx.systemContext;
    ctxEntries = ctx.ctxEntries;
  }

  function abortCurrentStream() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    // Reset partials unconditionally (the streaming flag guard was vestigial/dead).
    if (currentResponse || currentThinking) {
      // caller (or host) should commit partial if desired
    }
    currentResponse = '';
    currentThinking = '';
  }

  function buildMessages(history: Array<{role: string; content: string}>) {
    // Always include the rich system context (prompt + memory cells + SCP awareness)
    // Note: full buildApiMessages in monolith also folds exec results; this version assumes history is clean or caller handles.
    // Apply client-side sliding/pruning for context control if maxHistoryTurns is set >0.
    // This lets the user control how much of the conversation history is sent to the model,
    // independent of (or in addition to) the server's own context window management.
    let h = history;
    // We don't have direct access to settings here, but the monolith can pass a pruned snapshot.
    // For internal agent use (e.g. exec rounds), we keep full unless caller prunes before.
    // Pruning is primarily applied at the call sites (App send + prepare).
    return buildApiMessages(h, systemContext);
  }

  function prepareApiMessages(history: Array<{role: string; content: string}>) {
    return buildMessages(history);
  }

  // Full rich stream turn (ported/adapted from main App.svelte streamAssistant)
  // Supports multi-endpoint, reasoning, early exec interrupt, abort, thinking split.
  async function streamTurn(
    apiMessages: Array<{role: string; content: string}>,
    onUpdate: (partial: {response: string, thinking: string, tokens: number}) => void,
    endpointsList: Endpoint[] = opts.endpoints || [],
    activeId: string | null = opts.activeEndpointId || null,
    temperature = opts.chatTemperature ?? 0.7,
    maxTokens = opts.chatMaxTokens ?? 4096,
    fallback = opts.autoFallback ?? true
  ): Promise<{ full: string; thinking: string; error?: string }> {
    let candidates = [...endpointsList];
    if (activeId) {
      const active = candidates.find(e => e.id === activeId);
      if (active) candidates = [active, ...candidates.filter(e => e.id !== activeId)];
    }
    let lastErr = '';

    for (const ep of candidates) {
      if (!fallback && ep.id !== (activeId || candidates[0]?.id)) continue;
      // Always attempt the active endpoint even if previously marked unhealthy.
      // Only skip other unhealthy ones (so the one the user explicitly selected in Settings gets tried).
      if (ep.lastHealth && !ep.lastHealth.ok && ep.id !== activeId) {
        lastErr = ep.lastHealth.message || 'skipped unhealthy endpoint';
        continue;
      }
      const u = (ep.url || '').toLowerCase();
      if (u.includes(':5314') || u.includes('not found (completions') || u.includes('failed to load resource')) {
        lastErr = 'skipped bad dev endpoint (would 404 on completions)';
        continue;
      }
      // Last-mile sanitize before every chat completions POST (in case an endpoint object bypassed
      // earlier normalize on load/test or came from legacy/pane override). Guarantees no dup v1 etc.
      const chatUrl = normalizeToChatCompletions(ep.url) || ep.url;
      if (!chatUrl || !chatUrl.startsWith('http')) {
        lastErr = 'skipped invalid endpoint URL (prevents 404 on completions against dev server or bad host)';
        continue;
      }
      const modelToUse = await resolveModelForEndpoint(ep);
      // ensure any UI (endpoints list in Settings, currentModel derived, etc) sees the freshly inferred ID
      appSettings.endpoints = [...appSettings.endpoints];
      console.warn(`[inference] chat completions POST → ${chatUrl} (model: ${modelToUse})  [activeId=${activeId}, ep.id=${ep.id}, ep.model after resolve=${ep.model}]`);
      try {
        abortController = new AbortController();
        const res = await fetch(chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelToUse,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature,
            stream: true,
          }),
          signal: abortController.signal,
        });
        if (!res.ok) {
          let detail = '';
          try { const t = await res.text(); detail = JSON.parse(t)?.error?.message || t.slice(0, 200); } catch {}
          let modelsInfo = '';
          if (res.status === 404) {
            modelsInfo = ` (remote returned 404 for model '${ep.model || '(none)'}'. We now auto-query /v1/models and use the first reported ID if the stored model field is blank or invalid — try clicking Test in Settings, or ensure the URL points at a real completions endpoint.)`;
          }
          // Always probe /v1/models on any chat failure so we can tell the user the exact model IDs the remote server actually supports.
          // This is especially useful for 404s caused by wrong "model" value (very common when people use friendly names like "Gemma").
          const modelsUrl = getModelsUrl(ep.url);
          if (modelsUrl) {
            try {
              const controller = new AbortController();
              const t = setTimeout(() => controller.abort(), 4000);
              const mres = await fetch(modelsUrl, { method: 'GET', signal: controller.signal });
              clearTimeout(t);
              if (mres.ok) {
                const mj = await mres.json();
                const ids = Array.isArray(mj?.data) ? mj.data.map((d: any) => d?.id).filter(Boolean) : [];
                if (ids.length) {
                  ep.availableModels = ids;
                  modelsInfo = ` (server models: ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? '...' : ''}; copy the exact ID you want into the "model" field for this endpoint)`;
                }
              }
            } catch {}
          }
          const msg = `HTTP ${res.status}${detail ? ` — ${detail}` : ''}${modelsInfo}`;
          ep.lastHealth = { ok: false, message: msg };
          throw new Error(msg);
        }
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sseDone = false;
        let contentRaw = '';
        let reasoningRaw = '';
        currentResponse = '';
        currentThinking = '';
        tokenCount = 0;

        while (!sseDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') { sseDone = true; break; }
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta;
              const reasoningDelta = delta?.reasoning_content;
              const contentDelta = delta?.content;
              if (reasoningDelta) { reasoningRaw += reasoningDelta; tokenCount++; }
              if (contentDelta) { contentRaw += contentDelta; tokenCount++; }
              if (reasoningDelta || contentDelta) {
                const { thinking, answer } = splitThinking(contentRaw);
                currentThinking = reasoningRaw + trimPartialTag(thinking);
                currentResponse = trimPartialTag(answer);
                // Early interrupt: stop streaming as soon as a complete !do/!sh line is seen
                if (extractExecCalls(contentRaw + '\n').length > 0) {
                  sseDone = true;
                }
                onUpdate({ response: currentResponse, thinking: currentThinking, tokens: tokenCount });
              }
            } catch {}
          }
        }
        const { thinking, answer } = splitThinking(contentRaw);
        const fullThinking = (reasoningRaw + thinking).trim();
        const full = answer.trim();
        abortController = null;
        return { full, thinking: fullThinking };
      } catch (e: any) {
        if (e.name === 'AbortError') {
          abortController = null;
          return { full: currentResponse, thinking: currentThinking }; // partial
        }
        lastErr = e.message || 'failed';
        if (!fallback) break;
      } finally {
        abortController = null;
      }
    }
    return { full: '', thinking: '', error: lastErr || 'All endpoints failed' };
  }

  // Full exec approval loop extracted into the agent.
  // This is the key unification: the multi-round think + !sh detection + human approval + result injection
  // now lives here, using the shared context (memory/prompt/SCP).
  // The onExecApproval callback lets the host UI (monolith or modular composer) decide how to surface
  // the approval dialog while the agent drives the loop.
  async function send(
    text: string,
    options: {
      onUpdate?: (partial: {response: string, thinking: string, tokens: number, elapsed?: number}) => void;
      onExecApproval?: (cmd: string) => Promise<boolean>;
      pane?: ChatPane;
      history?: Array<{role: string; content: string; thinking?: string; exec?: any}>;
      extraConfig?: Partial<{endpoints: Endpoint[], activeEndpointId: string|null, temperature: number, maxTokens: number}>;
    } = {}
  ): Promise<{ reply: string; history?: any[] } | string | null> {
    const { onUpdate, onExecApproval, pane, history: providedHistory, extraConfig } = options;
    if (!text) return null;

    const useEndpoints = extraConfig?.endpoints || opts.endpoints || [];
    const useActive = extraConfig?.activeEndpointId ?? opts.activeEndpointId ?? null;
    const useTemp = extraConfig?.temperature ?? opts.chatTemperature ?? 0.7;
    const useMax = extraConfig?.maxTokens ?? opts.chatMaxTokens ?? 4096;

    // Always abort any prior in-flight streamTurn (controller + partials).
    // (Previous `if (streaming)` guard was ineffective as the flag was never set by send/streamTurn.)
    abortCurrentStream();

    // Support both pane-based (dual) and explicit history (for clean extraction)
    let currentHistory: Array<{role: string; content: string; thinking?: string; exec?: any}> = 
      providedHistory 
        ? [...providedHistory]
        : (pane?.messages || []).map(m => ({ role: m.role, content: m.content, thinking: m.thinking, exec: m.exec }));

    // Apply user-controlled sliding context here for internal agent builds too (exec rounds etc.).
    // Respects the setting so the model never receives more than desired, even in multi-round !sh.
    const maxT = appSettings.maxHistoryTurns || 0;
    const maxTools = appSettings.maxToolHistory || 0;
    if (maxT > 0 || maxTools > 0) {
      currentHistory = pruneHistoryForContext(currentHistory, maxT, maxTools);
    }

    // Prevent duplicate user message if the caller already appended it to the provided history (e.g. monolith solo/supervision path)
    // This was causing the model to receive the user input twice in a row and echo/repeat it.
    if (currentHistory.length === 0 || 
        currentHistory[currentHistory.length-1].role !== 'user' || 
        currentHistory[currentHistory.length-1].content !== text) {
      currentHistory.push({ role: 'user', content: text });
    }

    const MAX_EXEC_ROUNDS = 3;

    let finalReply = '';

    // Elapsed timing for pane users (dual/sup): makes pane.elapsed live during the entire send (incl. multi-round exec approvals),
    // analogous to tokens/streaming. This enables StreamingMessage live "● tok · s" in ChatPaneComp without host timers,
    // and ensures post-processing TPS in hosts like App.svelte always has good values for pure-uAgent dual paths.
    // Timer spans the whole turn (including approval waits) for total turn time; per-streamTurn reset would also be valid.
    let turnStart = performance.now();
    let elapsedTimer: ReturnType<typeof setInterval> | null = null;
    if (pane) {
      pane.elapsed = 0;
      elapsedTimer = setInterval(() => {
        if (pane) pane.elapsed = (performance.now() - turnStart) / 1000;
      }, 100);
    }

    try {
      for (let round = 0; round <= MAX_EXEC_ROUNDS; round++) {
        // Re-apply prune before each model call in case exec rounds added turns.
        let hForModel = currentHistory;
        const maxT2 = appSettings.maxHistoryTurns || 0;
        const maxTools2 = appSettings.maxToolHistory || 0;
        if (maxT2 > 0 || maxTools2 > 0) {
          hForModel = pruneHistoryForContext(hForModel, maxT2, maxTools2);
        }
        const apiMessages = buildMessages(hForModel.map(h => ({ role: h.role, content: h.content })));

        if (pane) {
          // keep pane in sync
          pane.messages = currentHistory.map(h => ({role: h.role as any, content: h.content, thinking: h.thinking, exec: h.exec}));
          pane.streaming = true;
          pane.response = '';
          pane.error = '';
          if (onUpdate) onUpdate({ response: '', thinking: '', tokens: pane.tokens || 0, elapsed: pane.elapsed });
        }

        const result = await streamTurn(
          apiMessages,
          (partial) => {
            if (pane) {
              pane.response = partial.response;
              (pane as any).currentThinking = partial.thinking;
              pane.tokens = partial.tokens;
              // elapsed is driven by our turn timer above (or host); include for onUpdate consumers
            }
            if (onUpdate) onUpdate({ ...partial, elapsed: pane?.elapsed });
          },
          useEndpoints,
          useActive,
          useTemp,
          useMax
        );

        if (result.error) {
          if (pane) pane.error = result.error;
          finalReply = '';
          break;
        }

        const fullThinking = result.thinking;
        const full = result.full;
        finalReply = full;

        currentHistory.push({ role: 'assistant', content: full, thinking: fullThinking });

        if (pane) {
          pane.messages = currentHistory.map(h => ({role: h.role as any, content: h.content, thinking: h.thinking, exec: h.exec}));
          pane.streaming = false;
          pane.response = '';
          if (onUpdate) onUpdate({ response: '', thinking: '', tokens: pane.tokens, elapsed: pane.elapsed });
        }

        const calls = extractExecCalls(full);
        if (!calls.length || round === MAX_EXEC_ROUNDS) break;

        for (const cmd of calls.slice(0, 3)) {
          // Do NOT rewrite the assistant content here (in currentHistory).
          // currentHistory is used to build the actual prompts sent to the model on the next round
          // (and is the source for history passed back to the UI layer).
          // Keeping the model's original output (which followed EXEC_AWARENESS / SCP with the !sh line)
          // lets it stay good at the format, the way it was in gemma-code.
          // The UI placeholder "[model requested: !sh ...]" is now applied only in the final
          // messages adoption step in App.svelte (for display + to keep exec cards working).

          if (isDestructiveCmd(cmd)) {
            // Remove any ability to delete files - auto-deny without execution or UI prompt
            const modelResult = '(command denied: deleting files is not allowed)';
            const execUserTurn = { 
              role: 'user', 
              content: `[exec] ${cmd}\n${modelResult}`, 
              exec: { cmd, output: modelResult, approved: false } 
            } as any;
            currentHistory.push(execUserTurn);
            continue;
          }

          // Prevent calling the exact same command twice after a reject (as requested).
          if (rejectedCmds.has(cmd)) {
            const modelResult = '(previously rejected this exact command; do not call the same twice after a reject)';
            const execUserTurn = { 
              role: 'user', 
              content: `[exec] ${cmd}\n${modelResult}`, 
              exec: { cmd, output: modelResult, approved: false } 
            } as any;
            currentHistory.push(execUserTurn);
            continue;
          }

          const approvalResult: ExecApprovalResult = await requestExecApproval(cmd, onExecApproval);
          const approved = approvalResult.approved;
          const feedback = approvalResult.feedback;

          if (!approved) {
            rejectedCmds.add(cmd);
          }

          // Capture result (stdout or denial+feedback). Put the informative text (with "Command results: ..." wrapper
          // to match exactly what EXEC_AWARENESS teaches the model to expect) into BOTH:
          //   - .content (so it is included when buildMessages / buildApiMessages constructs the prompt for the *next model call inside this send loop*)
          //   - .exec.output (for UI exec cards, transcripts, ctx estimation, and so the human sees what was fed back)
          // This ensures the model receives the tool output / human feedback *immediately* for its continuation (the [INSIGHT] or next action or final reply),
          // inside the same agent turn, instead of only on the following human turn.
          let rawForUi = '';
          let modelResult = '';
          if (approved) {
            rawForUi = await runExec(cmd, invoke, true);
            modelResult = `Command results:\n${rawForUi}`;
          } else if (feedback) {
            modelResult = `Command results: The human denied this command and said: ${feedback}. (Follow the exact SCP structure for any future tool use.)`;
            rawForUi = modelResult;  // show the specific feedback in the denied exec card too
          } else {
            modelResult = '(the human denied this command)';
            rawForUi = modelResult;
          }

          const execUserTurn = { 
            role: 'user', 
            content: `[exec] ${cmd}\n${modelResult}`, 
            exec: { cmd, output: rawForUi, approved } 
          } as any;
          currentHistory.push(execUserTurn);

          // No extra meta user turn for feedback anymore (it is already in the result above).
          // The "Say something back" UI option still works perfectly for the human side.
        }
      }
    } finally {
      // Cleanup elapsed timer (pane mode) + finalize value. Spans full agent turn for accurate total elapsed in dual/exec cases.
      // Wrapped in finally so timer always stops and elapsed is finalized even on throws/errors inside the turn.
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
      if (pane) {
        pane.elapsed = (performance.now() - turnStart) / 1000;
      }
    }

    // Return rich result so callers can get the full updated history including exec turns
    if (providedHistory !== undefined) {
      // mutate the provided history in place for convenience
      providedHistory.length = 0;
      providedHistory.push(...currentHistory);
      return { reply: finalReply, history: providedHistory };
    }

    if (pane) {
      pane.messages = currentHistory.map(h => ({role: h.role as any, content: h.content, thinking: h.thinking, exec: h.exec}));
    }

    return finalReply || null;
  }

  await loadAll();

  // Supervision helper: take a primary exchange and run it through supervisor awareness + shared context
  // Can be called with a different endpoint config for the supervisor model.
  async function superviseTurn(
    primaryUser: string,
    primaryAssistant: string,
    supervisorConfig?: { endpoint: string; model: string; temperature?: number }
  ): Promise<string> {
    const supHistory = [
      { role: 'user', content: primaryUser },
      { role: 'assistant', content: primaryAssistant }
    ];
    const baseApi = buildMessages(supHistory);

    // Prepend supervision awareness on top of the rich system context
    const supSystem = [SUPERVISION_AWARENESS, ...baseApi.filter(m => m.role === 'system').map(m => m.content)].join('\n\n');
    const supApi = [
      { role: 'system', content: supSystem },
      ...baseApi.filter(m => m.role !== 'system')
    ];

    if (supervisorConfig) {
      // Standalone fetch for supervisor (bypasses main endpoints for flexibility)
      const supUrl = normalizeToChatCompletions(supervisorConfig.endpoint) || supervisorConfig.endpoint;
      if (!supUrl || !supUrl.startsWith('http')) {
        return { full: '', thinking: '', error: 'invalid supervisor endpoint URL' };
      }
      const res = await fetch(supUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: supervisorConfig.model,
          messages: supApi,
          max_tokens: 1024,
          temperature: supervisorConfig.temperature ?? 0.3,
          stream: false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }
      return '[SUPERVISION] (supervisor call failed)';
    }

    // Fallback: use streamTurn with current config (demo)
    const result = await streamTurn(supApi, () => {}, [], null, 0.3, 1024);
    return result.full || '';
  }

  return {
    config: { promptFile, memoryFile, endpoints: opts.endpoints, activeEndpointId: opts.activeEndpointId },
    systemContext,
    ctxEntries,
    promptText,
    memRaw,
    memCells,
    loadAll,
    buildMessages,
    send,
    prepareApiMessages,
    streamTurn,
    superviseTurn, // new for Supervision mode
    // abortCurrentStream is internal (not on public AgentCore interface)
  };
}

// Convenience: run an exec (SCP) with approval hook. Uses the same invoke.
// Destructive commands are always blocked.
export async function handleExec(
  cmd: string,
  invoke: InvokeFn,
  isTauri: boolean,
  onApprove?: (approved: boolean) => Promise<boolean> | boolean
): Promise<string> {
  if (isDestructiveCmd(cmd)) {
    return '(command denied: deleting files is not allowed)';
  }
  const approved = onApprove ? await onApprove(true) : true;
  if (!approved) return '(exec denied)';
  return runExec(cmd, invoke, isTauri);
}
