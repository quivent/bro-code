<script lang="ts">
  export let uiDensity = 'comfortable';
  export let chatFontSize = 'medium';
  export let accentColor = 'lavender';
  export let onChange = (key: string, val: any) => {};
</script>

<div>
  <div class="setting">
    <div class="setting-label">UI Density</div>
    <div class="segmented">
      <button class:active={uiDensity==='comfortable'} onclick={() => onChange('uiDensity', 'comfortable')}>Comfortable</button>
      <button class:active={uiDensity==='compact'} onclick={() => onChange('uiDensity', 'compact')}>Compact</button>
    </div>
  </div>

  <div class="setting">
    <div class="setting-label">Chat Font Size</div>
    <div class="segmented">
      <button class:active={chatFontSize==='small'} onclick={() => onChange('chatFontSize', 'small')}>Small</button>
      <button class:active={chatFontSize==='medium'} onclick={() => onChange('chatFontSize', 'medium')}>Medium</button>
      <button class:active={chatFontSize==='large'} onclick={() => onChange('chatFontSize', 'large')}>Large</button>
    </div>
  </div>

  <div class="setting">
    <div class="setting-label">Accent Color</div>
    <div class="segmented">
      <button class:active={accentColor==='lavender'} onclick={() => onChange('accentColor', 'lavender')}>Lavender</button>
      <button class:active={accentColor==='cyan'} onclick={() => onChange('accentColor', 'cyan')}>Cyan</button>
      <button class:active={accentColor==='green'} onclick={() => onChange('accentColor', 'green')}>Green</button>
    </div>
  </div>
</div>
