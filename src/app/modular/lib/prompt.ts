import type { InvokeFn } from './types';

export interface PromptManagerOptions {
  invoke: InvokeFn;
  promptFile: string;
}

export async function loadPrompt(opts: PromptManagerOptions): Promise<string> {
  const { invoke, promptFile } = opts;
  try {
    return (await invoke('read_file', { path: promptFile })) || '';
  } catch {
    return '';
  }
}

export async function savePrompt(opts: PromptManagerOptions, content: string): Promise<void> {
  const { invoke, promptFile } = opts;
  await invoke('write_file', { path: promptFile, content });
}
