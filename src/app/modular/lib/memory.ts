import type { InvokeFn, MemoryCell } from './types';
import { defaultConfig } from './config';

export interface MemoryManagerOptions {
  invoke: InvokeFn;
  memoryFile: string;
}

export async function loadMemory(opts: MemoryManagerOptions): Promise<{
  memoryJson: string;
  memRaw: Record<string, any>;
  memCells: MemoryCell[];
}> {
  const { invoke, memoryFile } = opts;
  try {
    const raw = await invoke('read_file', { path: memoryFile });
    const json = raw || '{}';
    const parsed = JSON.parse(json);
    const memCells: MemoryCell[] = Object.entries(parsed).map(([key, val]: [string, any]) => {
      const tags: string[] = val.tags || [];
      return {
        key,
        value: typeof val.value === 'string' ? val.value : JSON.stringify(val.value ?? ''),
        tags,
        pinned: val.pinned || tags.includes('pin'),
        anchored: val.anchored || tags.includes('anchor'),
        updated: val.updated,
        reads: val.reads,
        writes: val.writes,
      };
    });
    return { memoryJson: json, memRaw: parsed, memCells };
  } catch (e: any) {
    return { memoryJson: '{}', memRaw: {}, memCells: [] };
  }
}

export async function persistMemory(
  opts: MemoryManagerOptions,
  memRaw: Record<string, any>
): Promise<void> {
  const { invoke, memoryFile } = opts;
  const canonical: Record<string, any> = {};
  for (const [key, v] of Object.entries(memRaw)) {
    const val: any = v ?? {};
    const tags: string[] = Array.isArray(val.tags) ? [...val.tags] : [];
    if (val.pinned && !tags.includes('pin')) tags.push('pin');
    if (val.anchored && !tags.includes('anchor')) tags.push('anchor');
    canonical[key] = {
      key,
      value: typeof val.value === 'string' ? val.value : JSON.stringify(val.value ?? ''),
      tags,
      updated: val.updated || new Date().toISOString(),
      reads: typeof val.reads === 'number' ? val.reads : 0,
      writes: typeof val.writes === 'number' ? val.writes : 0,
    };
  }
  await invoke('write_file', {
    path: memoryFile,
    content: JSON.stringify(canonical, null, 2) + '\n',
  });
}

export function addMemCell(memRaw: Record<string, any>, key: string, initialValue = '') {
  if (!key || memRaw[key]) return memRaw;
  return {
    ...memRaw,
    [key]: {
      key,
      value: initialValue,
      tags: [],
      updated: new Date().toISOString(),
      reads: 0,
      writes: 0,
    },
  };
}

// Simple helper to get the memory section for context injection
export function getMemorySection(memRaw: Record<string, any>): string {
  if (!memRaw || Object.keys(memRaw).length === 0) return '';
  return `MEMORY CELLS (key-value store with tags/stats):\n${JSON.stringify(memRaw, null, 2)}`;
}
