import type { InvokeFn } from './types';

export interface AgentConfig {
  /** Tauri invoke or mock for desktop APIs (run_shell, read_file, write_file, get/set_setting, etc.) */
  invoke: InvokeFn;
  /** Full path (~/ supported) for the starting document / system prompt */
  promptFile: string;
  /** Full path (~/ supported) for the memory cells JSON */
  memoryFile: string;
  /** Whether to automatically include EXEC_AWARENESS / SCP in system context */
  includeExecAwareness?: boolean;
  /** Max tokens cap for injected context (per entry) */
  injectCap?: number;
}

export const defaultConfig: Partial<AgentConfig> = {
  promptFile: '~/gemma/prompt.md',
  memoryFile: '~/lithos/gemma/memory/memory.json',
  includeExecAwareness: true,
  injectCap: 24000,
};

export function createDefaultInvoke(): InvokeFn {
  // Fallback mock for non-Tauri / demo use in unified package
  return async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'read_file') {
      const p = (args?.path as string) || '';
      if (p.includes('memory')) return JSON.stringify({});
      if (p.includes('prompt')) return '# Starting prompt (demo)\nYou are a helpful agent.';
      return '(demo file content)';
    }
    if (cmd === 'write_file') {
      console.log('[demo] write_file', args);
      return;
    }
    if (cmd === 'run_shell') {
      return `(demo shell result for: ${args?.cmd})`;
    }
    if (cmd === 'get_setting' || cmd === 'set_setting') {
      return null; // demo: no persistence
    }
    return null;
  };
}
