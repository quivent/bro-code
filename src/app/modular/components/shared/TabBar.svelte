<script lang="ts">
  import type { Tab } from '../../lib/types';
  export let activeTab: Tab;
  export let onTabChange: (tab: Tab) => void;
</script>

<nav>
  {#each ['chat','prompt','memory','tools','transcripts','context','terminal','kv','source','settings'] as t}
    <button class:active={activeTab === t} onclick={() => onTabChange(t as Tab)}>{t}</button>
  {/each}
</nav>

<style lang="postcss">
  /* From original nav styles */
</style>
