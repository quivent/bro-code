<script lang="ts">
  import type { TranscriptEntry } from '../../lib/types';
  import { getAgentContext } from '../../lib/provider.svelte.ts';

  const agentCtx = getAgentContext();
  let agent = $derived(agentCtx?.agent);

  let {
    transcripts = $bindable<TranscriptEntry[]>([]),
    transcriptsStatus = $bindable(''),
    viewingTranscript = $bindable<string | null>(null),
    transcriptContent = $bindable<any[]>([]),
    onReload = () => {},
    onView = (t: TranscriptEntry) => {},
    onLoadIntoChat = (t: TranscriptEntry) => {},
  } = $props();

  async function loadTranscripts() {
    if (onReload) {
      onReload();
      return;
    }
    // fallback placeholder
    try {
      const raw = await (agent ? '' : '');
      transcripts = raw.trim().split('\n').filter((l: string) => l).map((path: string) => {
        const name = path.split('/').pop()?.replace('.json', '') || path;
        const parts = name.split('_');
        const date = parts[0] || name.slice(0, 10);
        const sid = parts[1] || '';
        return { name, path, date, sessionId: sid };
      });
      transcriptsStatus = '';
    } catch (e: any) { transcriptsStatus = `error: ${e}`; }
  }

  async function viewTranscript(t: TranscriptEntry) {
    if (onView) {
      onView(t);
      return;
    }
    try {
      const raw = await (agent ? '[]' : '[]');
      transcriptContent = JSON.parse(raw);
      viewingTranscript = t.name;
    } catch (e: any) { transcriptContent = []; }
  }

  function loadIntoChat(t: TranscriptEntry) {
    if (onLoadIntoChat) {
      onLoadIntoChat(t);
      return;
    }
    console.log('load into chat', t);
  }

  function back() {
    if (viewingTranscript !== null || transcriptContent.length) {
      viewingTranscript = null;
      transcriptContent = [];
    }
  }

  $effect(() => {
    if (onReload && !transcripts.length) {
      // parent controls load when active
    } else if (!transcripts.length) {
      loadTranscripts();
    }
  });
</script>

<main class="editor-main">
  <div class="editor-header">
    <span>~/gemma/transcripts/</span>
    <span class="meta">{transcripts.length} files</span>
    {#if transcriptsStatus}<span class="status error-text">{transcriptsStatus}</span>{/if}
    <button class="reload-btn" onclick={onReload || loadTranscripts}>reload</button>
    {#if viewingTranscript}
      <button class="save-btn" onclick={() => (onLoadIntoChat || loadIntoChat)({ name: viewingTranscript!, path: '', date: '' })}>↗ load into chat</button>
      <button class="reload-btn" onclick={back}>← back</button>
    {/if}
  </div>
  {#if viewingTranscript}
    <div class="transcript-view">
      <div class="meta" style="padding-bottom:8px;">{transcriptContent.length} messages · click load to bring into active chat (replaces current messages)</div>
      {#each transcriptContent as msg}
        <div class="transcript-msg {msg.role}">
          <div class="transcript-role">{msg.role === 'user' ? '▸ you' : '✻ gemma'}</div>
          {#if msg.role === 'assistant'}
            <div class="markdown">{@html msg.content}</div>
          {:else}
            <div class="transcript-text">{msg.content}</div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="transcript-list">
      {#each transcripts as t}
        <div class="transcript-row" role="button" tabindex="0" onclick={() => (onView || viewTranscript)(t)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <span class="transcript-name">{t.name}</span>
          <span class="transcript-date">{t.date}</span>
        </div>
      {/each}
      {#if !transcripts.length}<div class="empty">(no transcripts yet — they save automatically)</div>{/if}
    </div>
  {/if}
</main>

<style lang="postcss">
  /* Styles from original .editor-main, .transcript-* etc. - can be moved/scoped */
</style>
