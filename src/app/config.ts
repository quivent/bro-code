/**
 * Model-specific configuration. Replace these values to create a new app.
 * Everything else in App.svelte is shared infrastructure.
 */
export interface ModelConfig {
  name: string;
  endpoint: string;
  model: string;
  label?: string;
  color?: string;
}

export interface BroConfig {
  name: string;           // display name (lowercase): "gemma", "qwen"
  title: string;          // window title: "Gemma", "Qwen"
  endpoint?: string;      // for single-endpoint variants
  model?: string;         // for single-endpoint variants
  endpoints?: ModelConfig[]; // for dual / multi-endpoint variants (enables panes + crosstalk)
  homeDir: string;        // data directory: "~/gemma", "~/qwen"
  tagline: string;        // splash tagline
  logo: string[];         // ASCII art lines
  assistantLabel: string; // "✻ gemma", "✻ qwen"
}

export const config: BroConfig = {
  name: 'bro',
  title: 'Bro',
  // For dual-pane variants, use endpoints array instead of single endpoint/model
  endpoint: 'http://127.0.0.1:8091/v1/chat/completions',
  model: '/Users/joshkornreich/models/gemma-4-31B-it-OptiQ-4bit',
  endpoints: [
    {
      name: 'left',
      endpoint: 'http://127.0.0.1:8091/v1/chat/completions',
      model: '/Users/joshkornreich/models/gemma-4-31B-it-OptiQ-4bit',
      label: '✻ gemma',
      color: '#3fb6b2',
    },
    {
      name: 'right',
      endpoint: 'https://qwen.influx.vision/v1/chat/completions',
      model: 'Qwen3-30B-A3B-Q4_K_M.gguf',
      label: '✻ right',
      color: '#f0883e',
    },
  ],
  homeDir: '~/bro',
  tagline: 'local model · type to begin',
  logo: [
    '██████  ██████   ██████ ',
    '██   ██ ██   ██ ██    ██',
    '██████  ██████  ██    ██',
    '██   ██ ██   ██ ██    ██',
    '██████  ██   ██  ██████ ',
  ],
  assistantLabel: '✻ bro',
};
