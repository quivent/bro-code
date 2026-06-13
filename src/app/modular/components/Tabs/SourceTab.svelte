<script lang="ts">
  let {
    sourceFiles = [],
    currentFile = '',
    sourceText = $bindable(''),
    sourceDirty = false,
    sourceStatus = '',
    srcHighlightEl = $bindable(undefined as any),
    srcHighlighted = '',
    onOpenFile,
    onSave,
    onReload,
    onInjectFile,
    onInjectFolder,
    onInput,
    onRehighlight = () => {},
  } = $props();
</script>

<main class="source-main">
  <aside class="src-files">
    {#each sourceFiles as f}
      <div class="src-file" role="button" tabindex="0" class:active={f === currentFile} onclick={() => onOpenFile(f)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <span class="src-file-name">{f}</span>
        <button class="src-add" onclick={(e) => { e.stopPropagation(); onInjectFile(f); }}>+</button>
      </div>
    {/each}
  </aside>
  <section class="src-editor">
    <div class="editor-header">
      <span>{currentFile}</span>
      {#if sourceDirty}<span class="dirty">● unsaved</span>{/if}
      {#if sourceStatus}<span class="status">{sourceStatus}</span>{/if}
      <button class="save-btn" onclick={onSave} disabled={!sourceDirty}>save</button>
      <button class="reload-btn" onclick={onReload}>reload</button>
      <button class="reload-btn" onclick={() => onInjectFile(currentFile)}>file → ctx</button>
      <button class="reload-btn" onclick={onInjectFolder}>folder → ctx</button>
    </div>
    <div class="src-wrap">
      <pre class="src-highlight" bind:this={srcHighlightEl} aria-hidden="true">{@html srcHighlighted + '\n'}</pre>
      <textarea class="src-input" bind:value={sourceText}
        oninput={(e) => { onInput(); onRehighlight(); /* parent bind:sourceText keeps sourceText in sync with edits */ }}
        onscroll={(e: Event) => { const t = e.target as HTMLElement; if (srcHighlightEl) { srcHighlightEl.scrollTop = t.scrollTop; srcHighlightEl.scrollLeft = t.scrollLeft; } }}
        spellcheck="false"></textarea>
    </div>
  </section>
</main>

<style lang="postcss">
  /* source styles from original */
</style>
