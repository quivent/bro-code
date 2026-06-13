// Barrel export for the unified agent desktop package (drop-in for qwen-code etc.).
// Re-exports the core for easy import: createAgentCore, managers, TPS helpers, etc.

export * from './agent';
export * from './types';
export * from './config';
export * from './memory';
export * from './prompt';
export * from './context';
export * from './scp';
export * from './supervision';
export * from './tps';
export * from './thinking';
export * from './utils';
export * from './provider.svelte'; // Svelte 5 context (optional for non-Svelte hosts)

// Note: local-serve is monolith-specific for now (KV + Local endpoint); can be extended.
export * from './local-serve';
