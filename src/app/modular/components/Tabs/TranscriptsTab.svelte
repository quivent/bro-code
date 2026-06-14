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
    // Robust parser matching the canonical naming schema used by save + regressive migration:
    // YYYY-MM-DD_sessionId.json (or bare sessionId.json for legacy). Always populates sessionId.
    try {
      // NOTE: real impl is usually provided by parent (App) via onReload prop.
      // This is a defensive fallback.
      const raw = ''; // parent should supply via prop-driven reload
      transcripts = raw.trim().split('\n').filter((l: string) => l).map((path: string) => {
        const bn = path.split('/').pop() || '';
        const name = bn.replace(/\.json$/, '');
        let date = '';
        let sid = name;

        if (/^\d{4}-\d{2}-\d{2}_/.test(name)) {
          const parts = name.split('_');
          date = parts[0];
          sid = parts.slice(1).join('_') || name;
        } else if (/^\d{4}-\d{2}-\d{2}/.test(name)) {
          date = name.slice(0, 10);
          sid = name.slice(11) || name;
        }

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
    <span>~/bro/transcripts/</span>
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
          <!-- Pure English descriptive names (Origin, The Journey, The Synthesis, etc.).
               Generated from conversation context / first message. No dates or sids. -->
        </div>
      {/each}
      {#if !transcripts.length}<div class="empty">(no transcripts yet — they save automatically)</div>{/if}
    </div>
  {/if}
</main>

<style>
  /* transcript styles (safely pulled from gemma-code reference) */
  .transcript-list { flex: 1; overflow-y: auto; padding: 8px 20px; }

  .transcript-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; cursor: pointer;
    border-bottom: 1px solid rgba(42, 42, 58, 0.3);
    transition: background 150ms ease;
  }
  .transcript-row:hover { background: rgba(167, 139, 250, 0.04); }

  .transcript-name { color: var(--lavend); font-size: 13px; font-family: var(--font-mono); }
  .transcript-date { color: var(--dim); font-size: 11px; }

  .transcript-view { flex: 1; overflow-y: auto; padding: 16px 24px; }

  .transcript-msg { margin-bottom: 16px; max-width: 780px; }
  .transcript-msg.user .transcript-role { color: var(--blue); font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  .transcript-msg.assistant .transcript-role { color: var(--hotpink); font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  .transcript-text { color: var(--text); font-size: 14px; line-height: 1.6; padding: 8px 12px; background: var(--bg-secondary); border-radius: 8px; }
</style>
