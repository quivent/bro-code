// Svelte 5 context provider for the unified agent core.
// Call setAgentContext() synchronously at the TOP of a component's <script>
// during initialization (not inside async, effects, or .then()).
//
// The returned object has a reactive .agent property (using $state).
// Consumers call getAgentContext() also at their component init time and use $derived(ctx.agent).

import { getContext, setContext } from 'svelte';
import type { AgentCore } from './agent';

const AGENT_KEY = Symbol('unified-agent-core');

export function setAgentContext() {
  const ctx = $state({ agent: null as AgentCore | null });
  setContext(AGENT_KEY, ctx);
  return ctx;
}

export function getAgentContext() {
  return getContext(AGENT_KEY) as { agent: AgentCore | null } | undefined;
}
