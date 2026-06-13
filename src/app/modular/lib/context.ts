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
