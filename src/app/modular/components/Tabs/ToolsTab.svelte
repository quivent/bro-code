<script lang="ts">
  import type { Tool } from '../../lib/types';
  import { getAgentContext } from '../../lib/provider.svelte.ts';

  const agentCtx = getAgentContext();
  let agent = $derived(agentCtx?.agent);

  let tools: Tool[] = $state([]);
  let toolsStatus: string = $state('');
  let selectedTool: Tool | null = $state(null);
  let toolSource: string = $state('');

  interface Tool { name: string; description: string; language: string; file: string; calls: number; successes: number; failures: number; last_error?: string; }

  async function loadTools() {
    try {
      const raw = await (agent ? /* extend agent for invoke if needed */ '' : '{}');
      const parsed = JSON.parse(raw || '{}');
      tools = Object.values(parsed) as Tool[];
      toolsStatus = '';
    } catch (e: any) { toolsStatus = `error: ${e}`; tools = []; }
  }

  async function viewToolSource(tool: Tool) {
    selectedTool = tool;
    try {
      toolSource = await (agent ? 'source for ' + tool.name : '(source)');
    } catch (e: any) { toolSource = `error: ${e}`; }
  }

  function back() {
    selectedTool = null;
    toolSource = '';
  }

  $effect(() => {
    if (!tools.length) loadTools();
  });
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>~/gemma/tools/</span>
    <span class="meta">{tools.length} tools</span>
    {#if toolsStatus}<span class="status error-text">{toolsStatus}</span>{/if}
    <button class="reload-btn" onclick={loadTools}>reload</button>
  </div>
  {#if selectedTool}
    <div class="editor-header">
      <span class="tool-name">{selectedTool.name}</span>
      <span class="meta">{selectedTool.language} · {selectedTool.calls} calls · {selectedTool.successes} ok · {selectedTool.failures} fail</span>
      <button class="reload-btn" onclick={back}>← back</button>
    </div>
    <div class="tool-detail">
      {#if selectedTool.description}
        <div class="tool-desc" style="padding:8px 16px; color:var(--text-secondary); font-size:12px;">{selectedTool.description}</div>
      {/if}
      <pre class="tool-source">{toolSource || '(source empty or failed to load)'}</pre>
    </div>
  {:else}
    <div class="tools-list">
      {#each tools as tool}
        <div class="tool-row" role="button" tabindex="0" onclick={() => viewToolSource(tool)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <span class="tool-name">{tool.name}</span>
          <span class="meta">{tool.calls} calls · {tool.successes} ok · {tool.failures} fail</span>
        </div>
      {/each}
      {#if !tools.length}<div class="empty">(no tools)</div>{/if}
    </div>
  {/if}
</main>

<style lang="postcss">
  /* tools styles (pulled from gemma-code reference) */
  .tools-list { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }

  .tool-row {
    padding: 10px 14px; cursor: pointer;
    background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(42, 42, 58, 0.4);
    border-radius: 8px; transition: all 150ms ease; font-family: var(--font-mono); font-size: 12px;
  }
  .tool-row:hover { background: rgba(22, 27, 34, 0.9); border-color: rgba(139, 92, 246, 0.3); }

  .tool-name { color: var(--green); font-weight: 600; }
  .tool-desc { color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin: 6px 0; }
  .tool-meta { color: var(--dim); font-size: 11px; }

  .tool-detail { flex: 1; overflow-y: auto; }
  .tool-source {
    flex: 1; overflow-y: auto; padding: 20px 24px; margin: 0;
    font-family: var(--font-mono); font-size: 13px; line-height: 1.7;
    background: #0a0c10; color: var(--text); white-space: pre-wrap;
    border: none;
  }
  .empty { color: var(--dim); font-size: 12px; padding: 20px 0; text-align: center; }
</style>
