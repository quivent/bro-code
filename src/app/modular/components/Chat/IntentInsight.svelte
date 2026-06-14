<script lang="ts">
  export let content: string;
  export let onChatClick: (e: MouseEvent) => void;
</script>

<div class="sovereign-frame">
  <!-- The content is expected to have the SCP structure with ``` for intent and [INSIGHT] -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="content markdown" onclick={onChatClick}>
    {@html content} <!-- Assume pre-rendered or pass raw and render here -->
  </div>
</div>

<style>
  .sovereign-frame {
    border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    background: rgba(13, 17, 23, 0.4);
  }
  .content {
    color: var(--text);
    font-size: 14px;
    line-height: 1.75;
  }
</style>
