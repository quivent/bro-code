import type { Endpoint } from './types';

// Central module for local MLX serve port management (extracted from monolith for unified package).
// Provides functions to compute origins/URLs, sync "Local" endpoints, add them, and health checks.
// Used by monolith and can be used by modular tabs / other apps (qwen etc.).
// Addresses port mismatch issues for TPS (chat streams and measureTps use ep.url which must match actual server).

export function getLocalOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function getLocalChatURL(port: number): string {
  return `${getLocalOrigin(port)}/v1/chat/completions`;
}

export const LOCAL_MODEL = 'mlx-community/gemma-4-31b-it-4bit';
export const LOCAL_AGENT = 'com.mlx.gemma4-31b';

export function hasLocalEndpoint(endpoints: Endpoint[], port: number): boolean {
  const origin = getLocalOrigin(port);
  return endpoints.some(e => e.url.startsWith(origin));
}

export function createLocalEndpoint(port: number): Endpoint {
  return {
    id: 'local-' + Date.now(),
    name: 'Local (MTP, 64k)',
    url: getLocalChatURL(port),
    model: LOCAL_MODEL
  };
}

/**
 * Sync any 127.0.0.1:* "Local" endpoints to the given port.
 * Returns { endpoints: updatedList, changed: boolean }
 * Caller should persist if changed.
 */
export function syncLocalEndpointPorts(
  endpoints: Endpoint[],
  port: number,
  normalizeToChatCompletions: (url: string) => string = (u) => u // fallback if not provided
): { endpoints: Endpoint[]; changed: boolean } {
  const newOrigin = getLocalOrigin(port);
  let changed = false;
  const updated = endpoints.map(e => {
    if (/^https?:\/\/127\.0\.0\.1:\d+/.test(e.url)) {
      const updatedUrl = e.url.replace(/^(https?:\/\/127\.0\.0\.1):\d+/, `$1:${port}`);
      if (updatedUrl !== e.url) {
        changed = true;
        return { ...e, url: normalizeToChatCompletions(updatedUrl) };
      }
    }
    return e;
  });
  return { endpoints: updated, changed };
}

/**
 * KV / local health helpers (pure where possible).
 * These use the port for direct /v1/models and /cache on the local serve.
 * Note: separate from chat ep.url (use for TPS/chat streams).
 */
export function getLocalModelsURL(port: number): string {
  return `${getLocalOrigin(port)}/v1/models`;
}

export function getLocalCacheStatsURL(port: number): string {
  return `${getLocalOrigin(port)}/v1/cache/stats`;
}

export function getLocalCacheResetURL(port: number): string {
  return `${getLocalOrigin(port)}/v1/cache/reset`;
}

// Example usage in host (monolith or qwen):
// const { endpoints: synced, changed } = syncLocalEndpointPorts(endpoints, currentPort, normalizeFn);
// if (changed) save...
// For health: fetch(getLocalModelsURL(localPort))
