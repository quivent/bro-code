import type { InvokeFn, CtxEntry } from './types';
import type { AgentConfig } from './config';
import { defaultConfig, createDefaultInvoke } from './config';
import { getMemorySection } from './memory';
import { EXEC_AWARENESS } from './scp';  // re-use from scp

export interface ContextManagerOptions extends Partial<AgentConfig> {
  invoke?: InvokeFn;
  // Optional: pass rich ctx list (incl. user files + dirs) from host (monolith ctx state or ContextTab).
  // If provided (and non-empty), used instead of the minimal [prompt, memory] seed.
  // This makes modular agent context consistent with monolith's full ctx (dirs, extra files, etc.).
  ctxEntries?: CtxEntry[];
}

export async function loadContext(opts: ContextManagerOptions = {}): Promise<{
  systemContext: string;
  ctxEntries: CtxEntry[];
}> {
  const cfg: AgentConfig = {
    invoke: opts.invoke || createDefaultInvoke(),
    promptFile: opts.promptFile || defaultConfig.promptFile!,
    memoryFile: opts.memoryFile || defaultConfig.memoryFile!,
    includeExecAwareness: opts.includeExecAwareness ?? defaultConfig.includeExecAwareness,
    injectCap: opts.injectCap || defaultConfig.injectCap,
  } as AgentConfig;

  const { invoke, promptFile, memoryFile, injectCap = 24000, includeExecAwareness } = cfg;
  const parts: string[] = [];

  // Load configured ctxEntries or defaults.
  // Now supports passing full list (from monolith ContextTab / persisted state) for parity:
  // extra files + dirs get injected into the system prompt used by unified agent.send paths.
  let ctxEntries: CtxEntry[] = (opts.ctxEntries && opts.ctxEntries.length > 0)
    ? [...opts.ctxEntries]
    : [
        { kind: 'prompt', path: promptFile },
        { kind: 'memory', path: memoryFile },
      ];

  for (const en of ctxEntries) {
    if (en.kind === 'dir') {
      // Real dir listing via run_shell + find (full parity with monolith App.svelte loadContext).
      // Adapted exactly: prunes heavy dirs (node_modules/dist/.git/target/gen), caps to 500 files, sorted.
      // No dir stub remains; this is the real expanded listing for systemContext injection.
      const listing = ((await invoke('run_shell', { cmd:
        `cd ${en.path.replace(/'/g, '')} 2>/dev/null && find . \\( -name node_modules -o -name dist -o -name .git -o -name target -o -name gen \\) -prune -o -type f -print | sed 's|^\\./||' | sort | head -500` }).catch(() => '')) as string) || '';
      parts.push(`── FOLDER: ${en.path} (file listing) ──\n${listing.trim() || '(empty or unreadable)'}`);
    } else {
      try {
        const content: string = await invoke('read_file', { path: en.path });
        const capped = content.length > injectCap ? content.slice(0, injectCap) + '\n…[truncated]' : content;
        if (en.kind === 'prompt') {
          if (capped.trim() && !capped.startsWith('(unreadable')) parts.push(capped.trim());
        } else {
          const label = en.kind === 'memory' ? `MEMORY: ${en.path}` : `FILE: ${en.path}`;
          parts.push(`── ${label} ──\n${capped.trim()}`);
        }
      } catch (e: any) {
        const errStr = `(unreadable: ${e})`;
        if (en.kind === 'prompt') {
          // do not inject unreadable prompt as raw
        } else {
          const label = en.kind === 'memory' ? `MEMORY: ${en.path}` : `FILE: ${en.path}`;
          parts.push(`── ${label} ──\n${errStr}`);
        }
      }
    }
  }

  if (includeExecAwareness) {
    parts.push(EXEC_AWARENESS);
  }

  const systemContext = parts.filter(Boolean).join('\n\n');
  return { systemContext, ctxEntries };
}

export function buildApiMessages(
  history: Array<{ role: string; content: string }>,
  systemContext: string,
  extraSystem?: string
): Array<{ role: string; content: string }> {
  const sysParts = [systemContext, extraSystem].filter(Boolean);
  const sys = sysParts.length ? [{ role: 'system', content: sysParts.join('\n\n') }] : [];
  return [...sys, ...history];
}

/**
 * Client-side sliding context control.
 * Keeps the most recent N turns (a turn ~ user message + following assistant).
 * Additionally keeps the most recent M tool usage / exec results ( !sh calls and their outputs ),
 * even if they fall outside the regular turn window. This gives the model continued awareness
 * of recent tool usage without keeping the entire history (addressing the "keep some component
 * of tool usage" request).
 *
 * Older non-tool turns are dropped before building apiMessages. System context is always kept.
 *
 * maxTurns: number of recent turns to retain (0 or negative = keep all for turns).
 * maxTools: number of most recent tool/exec messages to always retain (0 = none).
 */
export function pruneHistoryForContext<T extends { role: string; content?: string; exec?: any }>(
  history: T[],
  maxTurns: number,
  maxTools: number = 0
): T[] {
  if (history.length === 0) return history;
  if ((!maxTurns || maxTurns <= 0) && (!maxTools || maxTools <= 0)) return history;

  let pruned: T[] = [];

  if (maxTurns && maxTurns > 0) {
    const keep = Math.max(2, maxTurns * 2);
    if (history.length <= keep) {
      pruned = [...history];
    } else {
      pruned = history.slice(-keep);
    }
  } else {
    pruned = [...history];
  }

  if (maxTools && maxTools > 0) {
    // Collect the most recent tool/exec messages from the *original* history.
    const recentTools: T[] = [];
    for (let i = history.length - 1; i >= 0 && recentTools.length < maxTools; i--) {
      const h = history[i];
      if (h && (h.exec || (h.content && h.content.includes('[exec]')))) {
        recentTools.unshift(h);  // unshift to keep chronological order
      }
    }

    // Merge recent tools that aren't already in the pruned list (by reference or content match).
    const existing = new Set(pruned);
    const toAdd: T[] = [];
    for (const toolMsg of recentTools) {
      if (!existing.has(toolMsg)) {
        // Fallback check by content for safety (if objects differ).
        if (!pruned.some(p => p.content === toolMsg.content)) {
          toAdd.push(toolMsg);
        }
      }
    }

    if (toAdd.length > 0) {
      // Merge and re-sort by original order to preserve chronology.
      const combined = [...pruned, ...toAdd];
      const indexMap = new Map(history.map((h, idx) => [h, idx]));
      combined.sort((a, b) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0));
      pruned = combined;
    }
  }

  return pruned;
}
