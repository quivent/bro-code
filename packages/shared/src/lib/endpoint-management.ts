import type { ModelConfig } from '../types';

export interface Endpoint extends ModelConfig {
  id: string;
  lastHealth?: { ok: boolean; message: string };
}

export function createEndpoint(name: string, url: string, model: string): Endpoint {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : 'ep-' + Date.now().toString(36),
    name: name.trim(),
    endpoint: normalizeToChatCompletions(url),
    model: model.trim()
  };
}

export function normalizeToChatCompletions(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/$/, '');
    if (path.endsWith('/chat/completions')) return u.toString();
    if (path === '' || path === '/v1') u.pathname = '/v1/chat/completions';
    else if (path.endsWith('/v1')) u.pathname = path + '/chat/completions';
    else if (!path.includes('/chat')) u.pathname = (path || '') + '/v1/chat/completions';
    else u.pathname = path + '/chat/completions';
    return u.toString();
  } catch { return input; }
}

export function getHealthUrl(chatUrl: string): string {
  const full = normalizeToChatCompletions(chatUrl);
  try {
    const u = new URL(full);
    if (u.pathname.endsWith('/chat/completions')) {
      u.pathname = u.pathname.replace(/\/chat\/completions$/, '/models');
      return u.toString();
    }
    const base = u.pathname.replace(/\/$/, '') || '/v1';
    u.pathname = base + '/models';
    return u.toString();
  } catch {
    return full.replace(/\/chat\/completions.*/, '/v1/models');
  }
}

export async function testEndpointHealth(ep: Endpoint): Promise<Endpoint> {
  const target = getHealthUrl(ep.endpoint);
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(target, { method: 'GET', signal: controller.signal });
    clearTimeout(t);
    return {
      ...ep,
      lastHealth: { ok: res.ok, message: res.ok ? 'healthy' : `HTTP ${res.status}` }
    };
  } catch (e: any) {
    const msg = e.name === 'AbortError' ? 'timeout' : (e.message || 'connection failed');
    return { ...ep, lastHealth: { ok: false, message: msg } };
  }
}

export function moveEndpoint(list: Endpoint[], id: string, direction: number): Endpoint[] {
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) return list;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= list.length) return list;
  const newList = [...list];
  const [moved] = newList.splice(idx, 1);
  newList.splice(newIdx, 0, moved);
  return newList;
}

export function setActiveEndpoint(list: Endpoint[], id: string): string | null {
  return list.some(e => e.id === id) ? id : (list[0]?.id ?? null);
}
