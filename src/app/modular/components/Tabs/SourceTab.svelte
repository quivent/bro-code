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

<style>
  /* source styles (ported/fixed referencing gemma-code worktree monolithic implementation for the correct layout, colors, hover/active states, and syntax highlight overlay).
     Placed inside this component for proper Svelte scoping (bro-code uses modular <SourceTab> unlike some inlined tabs).
     Shared bits like .editor-header, .save-btn etc. are also in ContextTab/App. */
  .source-main { flex: 1; display: flex; min-height: 0; }

  .src-files {
    width: 250px; flex-shrink: 0; overflow-y: auto; padding: 10px 0;
    border-right: 1px solid rgba(42, 42, 58, 0.5); background: rgba(13, 17, 23, 0.6);
    font-family: var(--font-mono); font-size: 11px;
  }

  .src-file {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 14px; color: var(--text-secondary); cursor: pointer;
  }

  .src-file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .src-add {
    visibility: hidden; background: transparent; border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 5px; color: #2dd4bf; font-size: 11px; line-height: 1;
    padding: 1px 6px; cursor: pointer; flex-shrink: 0;
  }

  .src-file:hover .src-add { visibility: visible; }

  .src-add:hover { background: rgba(45, 212, 191, 0.12); }

  .src-file:hover { color: var(--text); background: rgba(255, 255, 255, 0.04); }

  .src-file.active { color: #2dd4bf; background: rgba(45, 212, 191, 0.08); }

  .src-editor { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  .src-wrap { flex: 1; position: relative; overflow: hidden; background: #0d1117; }

  .src-highlight, .src-input {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    padding: 16px 20px; margin: 0;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.5;
    white-space: pre; tab-size: 2; letter-spacing: 0;
    border: none; border-radius: 0; outline: none; overflow: auto; box-shadow: none;
  }

  .src-highlight { color: #c9d1d9; pointer-events: none; background: #0d1117; z-index: 0; }

  .src-input {
    color: transparent; caret-color: #2dd4bf; background: transparent;
    -webkit-text-fill-color: transparent; resize: none; z-index: 1;
  }

  .src-input:focus { border: none; box-shadow: none; }

  /* Shared editor header + buttons (duplicated here for self-contained scoping in this modular tab,
     matching the gemma reference and the pattern used in ContextTab). */
  .editor-header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono); border-bottom: 1px solid rgba(42, 42, 58, 0.4);
  }

  .save-btn {
    background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4);
    color: #34d399; padding: 4px 12px; border-radius: 5px; cursor: pointer;
    font-size: 11px; font-family: var(--font-mono);
  }
  .reload-btn {
    background: rgba(28, 33, 40, 0.6); border: 1px solid rgba(42, 42, 58, 0.5);
    color: var(--text-secondary); padding: 4px 12px; border-radius: 5px;
    cursor: pointer; font-size: 11px; font-family: var(--font-mono);
    transition: all 150ms ease;
  }
  .dirty { color: var(--warn); font-size: 11px; }
  .status { color: var(--green); font-size: 11px; transition: opacity 300ms; }
</style>
