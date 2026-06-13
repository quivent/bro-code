import type { Message } from './types';

// Sovereign Communication Protocol (SCP) helpers
export const EXEC_AWARENESS = `You operate under the Sovereign Communication Protocol (SCP). When you need to use a shell tool (!sh or !do), you MUST structure your output as follows for clarity and separation:

1. Open with a markdown code block that boxes your Intent:
\`\`\`
[Clear English description of the goal, what you intend to accomplish, and why this command serves the task.]
!sh [the exact raw command to execute - this line must be raw and alone for the system to parse]
\`\`\`

The !sh line is the raw action the system will detect and execute (after human approval). Do not add extra text inside the code block after the command.

2. After the system executes the command and feeds the result back to you (as "Command results: ..." or similar), in your next response provide the Insight framed as:
[INSIGHT] [Your English reaction, analysis of the result, what it means, and how it advances the task.]

Always use this exact SCP structure for every tool call. The code block creates a visual "box" for Intent; the [INSIGHT] label creates the container for your reflection. This ensures precise communication between you and the Architect.

You are strictly forbidden from deleting any files or data. Commands containing rm, rmdir, unlink, or other destructive operations (e.g. > /dev/null in a destructive way, dd if=) will be automatically detected and denied without execution. Only non-destructive commands are allowed.`;

export function extractExecCalls(text: string): string[] {
  const calls: string[] = [];
  for (const raw of text.split('\n')) {
    const s = raw.trim().replace(/^`+|`+$/g, '');
    if ((s.startsWith('!do ') || s.startsWith('!sh ')) && s.length > 4) calls.push(s.slice(4).trim());
  }
  return calls;
}

export function isDestructiveCmd(cmd: string): boolean {
  const c = cmd.toLowerCase();
  // Block common file deletion or destructive overwrite patterns
  if (/\b(rm|rmdir|unlink|shred|wipe|del|erase)\b/.test(c)) return true;
  if (/rm\s+(-[a-z]*r|-rf|--recursive)/.test(c)) return true;
  if (/>\s*\/dev\/(null|zero)/.test(c)) return true;
  if (/\bdd\s+if=/.test(c)) return true; // dd can destroy data
  if (/\bmv\s+.*\s+\/dev\/null/.test(c)) return true;
  return false;
}

// Global pending exec approval state (for UI approval dialog)
export let pendingExec: { cmd: string } | null = null;
export let execResolver: ((result: ExecApprovalResult) => void) | null = null;
export let execAlwaysAllow = false;

export function requestApproval(cmd: string): Promise<ExecApprovalResult> {
  if (execAlwaysAllow) return Promise.resolve({approved: true});
  return new Promise((resolve) => {
    pendingExec = { cmd };
    execResolver = resolve;
  });
}

export function answerExec(ok: boolean, always = false, feedback?: string) {
  if (always && ok) execAlwaysAllow = true;
  const r = execResolver;
  pendingExec = null;
  execResolver = null;
  r?.({approved: ok, feedback});
}

export interface ExecApprovalResult {
  approved: boolean;
  feedback?: string;  // user message to inject, e.g. "Do not run ls ~ as it hangs forever. Do not repeat rejected commands."
}

// For unified AgentCore: pass a callback instead of using global state.
// This allows the agent to drive the full loop while the UI layer (monolith or modular composer)
// decides how to prompt the human (e.g. via pendingExec state + dialog, or auto-approve, etc.).
export async function requestExecApproval(cmd: string, onApproval?: (cmd: string) => Promise<boolean | ExecApprovalResult>): Promise<ExecApprovalResult> {
  if (execAlwaysAllow) return {approved: true};
  if (onApproval) {
    const res = await onApproval(cmd);
    if (typeof res === 'boolean') return {approved: res};
    return res;
  }
  // fallback to global pending state
  return requestApproval(cmd);
}

export async function runExec(cmd: string, invokeFn: Function, isTauri: boolean): Promise<string> {
  if (!isTauri) return '(cannot run — desktop app required)';
  try {
    const out: string = await invokeFn('run_shell', { cmd });
    const trimmed = (out || '').trim();
    return trimmed ? trimmed.slice(0, 4000) : '(no output)';
  } catch (e: any) {
    return `(failed: ${e?.message || e})`;
  }
}
