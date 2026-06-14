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
  memoryFile: '~/gemma/memory/memory.json',
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

/**
 * Web / browser-friendly invoke implementation.
 * Uses localStorage for settings + a virtual in-memory + LS-backed "filesystem"
 * for prompt.md, memory.json, context files, transcripts, etc.
 *
 * This lets the pure Vite web app (served from the Gemma inference server host,
 * or anywhere) have usable persistence and core features without Tauri.
 *
 * Paths are virtualized (~/ stripped to a key prefix). Real server-side FS/tools
 * require a small companion backend (see web-backend/ idea below).
 *
 * PICKUP NOTE FOR OTHER SIDE / SERVER WORK:
 * See the big "Web / Remote Server Frontend Mode" section in modular/README.md
 * for full setup steps, limitations, and next actions (especially the companion
 * backend for real run_shell + server FS).
 * This function + the invoke() wrapper in App.svelte are the main entry points.
 */
export function createWebInvoke(): InvokeFn {
  const LS_PREFIX = 'bro-web:';
  const FS_PREFIX = LS_PREFIX + 'fs:';
  const SETTING_PREFIX = LS_PREFIX + 'setting:';

  function normalizePath(p: string): string {
    if (!p) return 'unknown';
    return p.replace(/^~\/+/, '').replace(/^\/+/, '').replace(/\s+/g, '_');
  }

  return async (cmd: string, args?: Record<string, unknown>) => {
    const path = (args?.path as string) || '';
    const key = (args?.key as string) || '';
    const value = args?.value as string | undefined;
    const cmdStr = (args?.cmd as string) || '';

    if (cmd === 'read_file') {
      const norm = normalizePath(path);
      const stored = localStorage.getItem(FS_PREFIX + norm);
      if (stored !== null) return stored;

      // Sensible defaults for core files so the app is immediately usable
      if (norm.includes('memory') || norm.endsWith('memory.json')) {
        return JSON.stringify({}); // empty memory
      }
      if (norm.includes('prompt') || norm.endsWith('prompt.md')) {
        return '# Bro Web Prompt\n\nYou are a helpful local agent running in the browser.';
      }
      return ''; // empty for other context files
    }

    if (cmd === 'write_file') {
      const norm = normalizePath(path);
      const content = (args?.content as string) || '';
      localStorage.setItem(FS_PREFIX + norm, content);
      return;
    }

    if (cmd === 'run_shell') {
      // In pure web mode we can't (and shouldn't) run arbitrary shell on the client.
      // Return a friendly message. For real execution when co-located with Gemma,
      // run a tiny companion backend on the server and point a future `webShellEndpoint`.
      console.warn('[web] run_shell requested (demo only):', cmdStr);
      if (cmdStr.includes('gemma kv')) {
        return 'KV operations require the native desktop app or a server-side backend.';
      }
      return `(web demo) would have run: ${cmdStr}\n\nTip: For real tools, serve the web app from the Gemma host + add a small /api/shell proxy.`;
    }

    if (cmd === 'get_setting') {
      if (!key) return null;
      const v = localStorage.getItem(SETTING_PREFIX + key);
      return v !== null ? v : null;
    }

    if (cmd === 'set_setting') {
      if (key && value !== undefined) {
        localStorage.setItem(SETTING_PREFIX + key, value);
      }
      return;
    }

    // For any other Tauri command (e.g. dialog, specific plugins) just no-op in web.
    return null;
  };
}

/**
 * Helper for when you wire the real backend fetch (see WEB_MODE_PICKUP.md and web-backend/server.js).
 * Usage example in your fetch to /api/invoke:
 *
 * const token = localStorage.getItem('bro-web:auth-token');
 * const res = await fetch(`${webBackendUrl}/api/invoke`, {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     ...(token ? { Authorization: `Bearer ${token}` } : {})
 *   },
 *   body: JSON.stringify({ cmd, args })
 * });
 *
 * Store the token after a successful /api/login call (username/password -> {token}).
 * This fits the existing localStorage + webInvoke pattern used for everything else in web mode.
 */
