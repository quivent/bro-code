// Re-export + extend core types for the unified package.
// These are safe to share across gemma-code, qwen-code, etc.

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  exec?: { cmd: string; output: string; approved: boolean };
}

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  model: string;
  lastHealth?: { ok: boolean; message: string; tps?: number };
  availableModels?: string[];
}

export interface KvSession {
  name: string;
  bytes: number;
  mtime: string;
}

export type Tab = 'chat' | 'context' | 'prompt' | 'memory' | 'tools' | 'transcripts' | 'terminal' | 'kv' | 'source' | 'settings';

export type ChatMode = 'solo' | 'dual' | 'vs' | 'supervision';

export interface ChatPane {
  messages: Message[];
  streaming: boolean;
  response: string;
  tokens: number;
  elapsed: number;
  error: string;
  endpointId: string | null;
}

export type CtxEntry = { kind: 'prompt' | 'memory' | 'file' | 'dir'; path: string };

export interface Tool {
  name: string;
  description: string;
  language: string;
  file: string;
  calls: number;
  successes: number;
  failures: number;
  last_error?: string;
}

export interface TranscriptEntry {
  name: string;
  path: string;
  date: string;
  sessionId?: string;
}

// Re-export AgentConfig (defined in config.ts for the unified createAgentCore / managers) so that
// `import type { ..., AgentConfig } from './lib/types'` (and re-exports via modular/types) works.
export type { AgentConfig } from './config';

// For package consumers (mock or real Tauri)
export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<any>;

export interface MemoryCell {
  key: string;
  value: string;
  tags?: string[];
  pinned?: boolean;
  anchored?: boolean;
  updated?: string;
  reads?: number;
  writes?: number;
}

export interface AgentContext {
  systemContext: string;
  ctxEntries: CtxEntry[];
  promptText: string;
  memCells: MemoryCell[];
  memRaw: Record<string, any>;
}
