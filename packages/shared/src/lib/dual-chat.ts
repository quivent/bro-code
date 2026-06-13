import type { ModelConfig } from '../types';

export interface ChatPaneState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  streaming: boolean;
  response: string;
  tokens: number;
  elapsed: number;
  error: string;
}

export interface DualChatState {
  left: ChatPaneState;
  right: ChatPaneState;
  vsThread: Array<{ side: 'left' | 'right'; content: string }>;
  vsRunning: boolean;
  vsRound: number;
  vsSeed: string;
  maxVsRounds: number;
  vsAbort: boolean;
}

export function createInitialPane(): ChatPaneState {
  return {
    messages: [],
    streaming: false,
    response: '',
    tokens: 0,
    elapsed: 0,
    error: ''
  };
}

export function createInitialDualState(maxRounds = 10): DualChatState {
  return {
    left: createInitialPane(),
    right: createInitialPane(),
    vsThread: [],
    vsRunning: false,
    vsRound: 0,
    vsSeed: '',
    maxVsRounds: maxRounds,
    vsAbort: false
  };
}

export async function streamToPane(
  pane: ChatPaneState,
  mc: ModelConfig,
  apiMessages: Array<{ role: string; content: string }>,
  onUpdate: () => void,
  // New for unified: allow pre-built system context (e.g. from agent.prepareApiMessages or memory/prompt)
  // If first message is system, it will be respected; otherwise can pass systemContext to prepend.
  systemContext?: string
): Promise<string> {
  pane.error = '';
  pane.streaming = true;
  pane.response = '';
  pane.tokens = 0;
  const start = performance.now();
  pane.elapsed = 0;

  const timer = setInterval(() => {
    pane.elapsed = (performance.now() - start) / 1000;
    onUpdate();
  }, 100);

  try {
    let finalMessages = apiMessages;
    if (systemContext && !apiMessages.some(m => m.role === 'system')) {
      finalMessages = [{ role: 'system', content: systemContext }, ...apiMessages];
    }
    const res = await fetch(mc.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: mc.model,
        messages: finalMessages,
        max_tokens: 4096,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        const t = await res.text();
        detail = JSON.parse(t)?.error?.message || t.slice(0, 200);
      } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sseDone = false;

    while (!sseDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          sseDone = true;
          break;
        }
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            pane.response += delta;
            pane.tokens++;
            onUpdate();
          }
        } catch {}
      }
    }

    const full = pane.response;
    pane.messages = [...pane.messages, { role: 'assistant', content: full }];
    return full;
  } catch (e: any) {
    pane.error = e.message || 'Connection failed';
    return '';
  } finally {
    clearInterval(timer);
    pane.elapsed = (performance.now() - start) / 1000;
    pane.streaming = false;
    pane.response = '';
    onUpdate();
  }
}

export async function startCrosstalk(
  state: DualChatState,
  leftConfig: ModelConfig,
  rightConfig: ModelConfig,
  seed: string,
  onUpdate: () => void
) {
  state.vsSeed = seed;
  state.vsThread = [];
  state.vsRound = 0;
  state.vsRunning = true;
  state.vsAbort = false;

  state.left.messages = [{ role: 'user', content: seed }];
  state.right.messages = [];

  let currentSide: 'left' | 'right' = 'left';

  while (!state.vsAbort && state.vsRound < state.maxVsRounds) {
    const pane = currentSide === 'left' ? state.left : state.right;
    const mc = currentSide === 'left' ? leftConfig : rightConfig;
    const apiMsgs = pane.messages.map(m => ({ role: m.role, content: m.content }));

    const response = await streamToPane(pane, mc, apiMsgs, onUpdate);
    if (state.vsAbort || !response) break;

    state.vsThread = [...state.vsThread, { side: currentSide, content: response }];
    state.vsRound++;
    onUpdate();

    const otherSide: 'left' | 'right' = currentSide === 'left' ? 'right' : 'left';
    const otherPane = otherSide === 'left' ? state.left : state.right;
    otherPane.messages = [...otherPane.messages, { role: 'user', content: response }];

    currentSide = otherSide;
  }

  state.vsRunning = false;
  onUpdate();
}

export function stopCrosstalk(state: DualChatState) {
  state.vsAbort = true;
}

export function clearDual(state: DualChatState) {
  state.left = createInitialPane();
  state.right = createInitialPane();
  state.vsThread = [];
  state.vsRound = 0;
  state.vsSeed = '';
}
