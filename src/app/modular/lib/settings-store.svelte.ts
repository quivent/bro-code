// Shared reactive settings store for the modular app.
// Provides cross-cutting state (endpoints, local port, panes modes, appearance, agent prefs, advanced)
// so that SettingsTab can be fully self-contained, while App/chat/send/init can consume live values.
// Uses Svelte 5 runes ($state) at module scope for shared reactivity across importers.
// All persistence via Tauri invoke (safe no-op in browser).

import type { Endpoint } from './types';
import {
  createLocalEndpoint,
  hasLocalEndpoint as libHasLocal,
  syncLocalEndpointPorts as libSyncLocalPorts,
} from './local-serve';
import { measureTps as libMeasureTps, getTpsMessage } from './tps';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type ChatMode = 'solo' | 'dual' | 'vs' | 'supervision';

// Container so re-assignments from any importer (App, tabs) affect the shared object
// and Svelte reactivity tracks it.
export const settings = $state({
  // Endpoints
  endpoints: [] as Endpoint[],
  activeEndpointId: null as string | null,

  // Local serve
  localPort: 8091,

  // Chat behavior
  chatTemperature: 0.7,
  chatMaxTokens: 4096,
  autoFallback: true,

  // Appearance
  uiDensity: 'comfortable' as 'comfortable' | 'compact',
  chatFontSize: 'medium' as 'small' | 'medium' | 'large',
  accentColor: 'lavender' as 'lavender' | 'cyan' | 'green',

  // Agent
  autoReloadPrompt: true,
  maxTranscripts: 50,
  enableToolsByDefault: true,

  // Advanced
  requestTimeoutMs: 30000,
  debugMode: false,
  showRawResponses: false,

  // Panes / multi
  chatMode: 'solo' as ChatMode,
  leftEndpointId: null as string | null,
  rightEndpointId: null as string | null,
  maxVsRounds: 10,
  mainEndpointId: null as string | null,
  supervisorEndpointId: null as string | null,

  // UI transients (used by SettingsTab)
  settingsStatus: '',
  editingId: null as string | null,
  formName: '',
  formUrl: '',
  formModel: '',
  testState: {} as Record<string, 'testing' | 'ok' | 'bad'>,
  draggedIdx: null as number | null,

  // Health (active endpoint)
  healthStatus: 'unknown' as 'unknown' | 'checking' | 'ok' | 'error',
  healthMsg: '',

  // Note: kv-related (kvSessions etc) and terminal state live inside their tabs (self-contained).
});

// Internal invoke (matches App pattern; no dep on host)
const isTauri = '__TAURI_INTERNALS__' in (typeof window !== 'undefined' ? window : {});
async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  if (!isTauri) return null;
  return tauriInvoke(cmd, args);
}

// Helpers (duplicated from monolith for store isolation; keep in sync or move to utils later)
export function normalizeToChatCompletions(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  try {
    const u = new URL(url);
    if (!u.hostname || /\s/.test(u.hostname) || u.hostname.includes(' ') || u.hostname.startsWith('[')) {
      return '';
    }

    // Always strip all trailing slashes from the path first — this is the key
    // to being forgiving with user input like ".../completions/" or ".../v1/".
    let path = u.pathname.replace(/\/+$/, '');

    // Clean any sequence of consecutive /v1/v1... to single /v1. This prevents
    // paths like /v1/v1/chat/completions (and resulting /v1/v1/models) which 404
    // on many servers. The regex handles multiple duplicates in one pass.
    path = path.replace(/\/v1(\/+v1)*/g, '/v1');

    // If the (cleaned) path contains "completions" anywhere, the user pasted (or we previously
    // stored) a specific/full chat completions URL for a remote or custom server.
    // Trust it exactly (after v1 dedup + no trailing slash). This is the key for remote
    // endpoints that don't live at the standard /v1/chat/completions suffix.
    if (/completions/i.test(path)) {
      u.pathname = path;
      return u.toString();
    }

    // Otherwise treat as a base URL and infer the standard OpenAI-compatible path.
    if (!path || path === '/' || path === '/v1' || path === '/api') {
      path = '/v1/chat/completions';
    } else if (!path.includes('/chat/completions') && !path.includes('/v1/')) {
      path = (path.endsWith('/v1') ? path : path + '/v1') + '/chat/completions';
    } else if (!path.endsWith('/chat/completions')) {
      path = path + '/chat/completions';
    }

    u.pathname = path;
    return u.toString();
  } catch {
    return '';
  }
}

export function getHealthUrl(chatUrl: string): string {
  const fullChat = normalizeToChatCompletions(chatUrl);
  if (!fullChat) return '';
  try {
    const u = new URL(fullChat);
    if (u.pathname.endsWith('/chat/completions')) {
      u.pathname = u.pathname.replace(/\/chat\/completions$/, '/models');
      return u.toString();
    }
    let base = u.pathname.replace(/\/$/, '') || '/v1';
    base = base.replace(/\/v1(\/+v1)*/g, '/v1');
    u.pathname = base + '/models';
    return u.toString();
  } catch {
    return '';
  }
}

export function getActiveEndpoint(): Endpoint | null {
  // Self-healing: always prune bad dev endpoints before returning active (prevents ongoing 404s on /completions from stale config)
  cleanBadEndpoints();
  if (settings.activeEndpointId) {
    const found = settings.endpoints.find(e => e.id === settings.activeEndpointId);
    if (found) return found;
  }
  return settings.endpoints[0] ?? null;
}

export function cleanBadEndpoints() {
  const beforeCount = settings.endpoints.length;
  settings.endpoints = settings.endpoints
    .map((e: Endpoint) => {
      const fixed = normalizeToChatCompletions(e.url);
      return fixed ? { ...e, url: fixed } : e;
    })
    .filter((e: Endpoint) => {
      const fixedUrl = e.url || '';
      if (!fixedUrl || !fixedUrl.startsWith('http')) {
        return false;  // drop anything that didn't normalize to a real absolute http URL (prevents fetch to relative 'completions' or bad hosts)
      }
      const u = fixedUrl.toLowerCase();
      if (u.includes('failed to load resource') || u.includes('not found (completions') || u.includes('[error]')) {
        return false;
      }
      // Prune endpoints that point at the Vite dev server (port 5314) — they 404 on /completions and spam the console relay
      if (u.includes(':5314') || /127\.0\.0\.1:5314|localhost:5314/.test(u)) {
        return false;
      }
      return true;
    });
  if (settings.endpoints.length < beforeCount) {
    void saveEndpoints().catch(() => {});
  }
}

// Load all persisted settings into the shared state (called once from App root)
export async function loadSettings() {
  if (!isTauri) return;

  try {
    const endpointsJson = await invoke('get_setting', { key: 'endpoints' });
    if (endpointsJson) {
      settings.endpoints = JSON.parse(endpointsJson).map((e: Endpoint) => ({
        ...e,
        url: normalizeToChatCompletions(e.url)
      }));
    }

    // On load, for any endpoints that have cached availableModels from prior Test,
    // auto-correct their model to a full server ID if the stored one is a friendly label
    // or otherwise not in the list. This ensures "Gemma" etc. get replaced by the real
    // ID like "RedHatAI/gemma-4-31B-it-FP8-dynamic" without requiring manual intervention.
    for (const ep of settings.endpoints) {
      if (ep.availableModels && ep.availableModels.length && !ep.availableModels.includes(ep.model)) {
        ep.model = ep.availableModels[0];
      }
    }

    const savedActive = await invoke('get_setting', { key: 'activeEndpointId' });
    if (savedActive) {
      settings.activeEndpointId = savedActive;
    } else if (settings.endpoints.length > 0) {
      settings.activeEndpointId = settings.endpoints[0].id;
    }

    // Ensure bad dev endpoints are pruned even on this load path (HMR safety)
    cleanBadEndpoints();

    const savedLocalPort = await invoke('get_setting', { key: 'localPort' });
    if (savedLocalPort) {
      const p = parseInt(savedLocalPort, 10);
      if (p > 0 && p < 65536 && p !== 5314) {
        settings.localPort = p;
      } else {
        settings.localPort = 8091;
        // avoid dev server port; persist reset so it doesn't stick
        void invoke('set_setting', { key: 'localPort', value: '8091' }).catch(() => {});
      }
    }

    // Legacy migration (same as before)
    if (settings.endpoints.length === 0) {
      const oldEp = await invoke('get_setting', { key: 'endpoint' });
      const oldModel = await invoke('get_setting', { key: 'model' });
      if (oldEp) {
        const legacy: Endpoint = {
          id: 'legacy-' + Date.now(),
          name: 'Migrated Endpoint',
          url: normalizeToChatCompletions(oldEp),
          model: oldModel || 'gemma-3-27b-it-Q4_K_M.gguf'
        };
        settings.endpoints = [legacy];
        settings.activeEndpointId = legacy.id;
        await saveEndpoints();
      }
    }

    // Clean garbage
    const beforeCount = settings.endpoints.length;
    settings.endpoints = settings.endpoints
      .map((e: Endpoint) => {
        const fixed = normalizeToChatCompletions(e.url);
        return fixed ? { ...e, url: fixed } : e;
      })
      .filter((e: Endpoint) => {
        const fixedUrl = e.url || '';
        if (!fixedUrl || !fixedUrl.startsWith('http')) {
          return false;  // drop anything that didn't normalize to a real absolute http URL
        }
        const u = fixedUrl.toLowerCase();
        if (u.includes('failed to load resource') || u.includes('not found (completions') || u.includes('[error]')) {
          return false;
        }
        // Prune endpoints that point at the Vite dev server (port 5314) — they 404 on /completions and spam the console relay
        if (u.includes(':5314') || /127\.0\.0\.1:5314|localhost:5314/.test(u)) {
          return false;
        }
        return true;
      });
    if (settings.endpoints.length < beforeCount) {
      void saveEndpoints();
    }

    // Chat
    const temp = await invoke('get_setting', { key: 'chatTemperature' });
    if (temp) settings.chatTemperature = parseFloat(temp);
    const maxTok = await invoke('get_setting', { key: 'chatMaxTokens' });
    if (maxTok) settings.chatMaxTokens = parseInt(maxTok);
    const fallback = await invoke('get_setting', { key: 'autoFallback' });
    if (fallback !== null) settings.autoFallback = fallback === 'true';

    // Appearance
    const density = await invoke('get_setting', { key: 'uiDensity' });
    if (density) settings.uiDensity = density as any;
    const fontSize = await invoke('get_setting', { key: 'chatFontSize' });
    if (fontSize) settings.chatFontSize = fontSize as any;
    const accent = await invoke('get_setting', { key: 'accentColor' });
    if (accent) settings.accentColor = accent as any;

    // Agent
    const reloadPrompt = await invoke('get_setting', { key: 'autoReloadPrompt' });
    if (reloadPrompt !== null) settings.autoReloadPrompt = reloadPrompt === 'true';
    const maxTrans = await invoke('get_setting', { key: 'maxTranscripts' });
    if (maxTrans) settings.maxTranscripts = parseInt(maxTrans);
    const toolsDefault = await invoke('get_setting', { key: 'enableToolsByDefault' });
    if (toolsDefault !== null) settings.enableToolsByDefault = toolsDefault === 'true';

    // Advanced
    const timeout = await invoke('get_setting', { key: 'requestTimeoutMs' });
    if (timeout) settings.requestTimeoutMs = parseInt(timeout);
    const debug = await invoke('get_setting', { key: 'debugMode' });
    if (debug !== null) settings.debugMode = debug === 'true';
    const raw = await invoke('get_setting', { key: 'showRawResponses' });
    if (raw !== null) settings.showRawResponses = raw === 'true';

    // Panes
    const savedMode = await invoke('get_setting', { key: 'chatMode' });
    if (savedMode) settings.chatMode = savedMode as ChatMode;
    const lId = await invoke('get_setting', { key: 'leftEndpointId' });
    if (lId) settings.leftEndpointId = lId;
    const rId = await invoke('get_setting', { key: 'rightEndpointId' });
    if (rId) settings.rightEndpointId = rId;
    const mId = await invoke('get_setting', { key: 'mainEndpointId' });
    if (mId) settings.mainEndpointId = mId;
    const sId = await invoke('get_setting', { key: 'supervisorEndpointId' });
    if (sId) settings.supervisorEndpointId = sId;
    const maxR = await invoke('get_setting', { key: 'maxVsRounds' });
    if (maxR) settings.maxVsRounds = parseInt(maxR);

    // Defaults for panes
    if (settings.endpoints.length > 0) {
      if (!settings.leftEndpointId) settings.leftEndpointId = settings.endpoints[0].id;
      if (!settings.rightEndpointId) settings.rightEndpointId = settings.endpoints.length > 1 ? settings.endpoints[1].id : settings.endpoints[0].id;
      if (!settings.mainEndpointId) settings.mainEndpointId = settings.endpoints[0].id;
      if (!settings.supervisorEndpointId) settings.supervisorEndpointId = null;
    }

    applyAppearance();
  } catch (e) {
    console.warn('Failed to load settings (store)', e);
  }
}

export async function saveEndpoints() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'endpoints', value: JSON.stringify(settings.endpoints) });
    await invoke('set_setting', { key: 'activeEndpointId', value: settings.activeEndpointId || '' });
  } catch (e) {
    console.warn('Failed to save endpoints', e);
  }
}

export async function saveLocalPort() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'localPort', value: String(settings.localPort) });
  } catch (e) {
    console.warn('Failed to save localPort', e);
  }
}

export async function saveChatSettings() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'chatTemperature', value: settings.chatTemperature.toString() });
    await invoke('set_setting', { key: 'chatMaxTokens', value: settings.chatMaxTokens.toString() });
    await invoke('set_setting', { key: 'autoFallback', value: settings.autoFallback.toString() });
  } catch (e) {
    console.warn('Failed to save chat settings', e);
  }
}

export function applyAppearance() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-density', settings.uiDensity);
  root.setAttribute('data-font-size', settings.chatFontSize);
  root.setAttribute('data-accent', settings.accentColor);
}

export async function saveAppearance() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'uiDensity', value: settings.uiDensity });
    await invoke('set_setting', { key: 'chatFontSize', value: settings.chatFontSize });
    await invoke('set_setting', { key: 'accentColor', value: settings.accentColor });
    applyAppearance();
  } catch (e) {
    console.warn('Failed to save appearance', e);
  }
}

export async function saveAgentSettings() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'autoReloadPrompt', value: settings.autoReloadPrompt.toString() });
    await invoke('set_setting', { key: 'maxTranscripts', value: settings.maxTranscripts.toString() });
    await invoke('set_setting', { key: 'enableToolsByDefault', value: settings.enableToolsByDefault.toString() });
  } catch (e) {
    console.warn('Failed to save agent settings', e);
  }
}

export async function saveAdvancedSettings() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'requestTimeoutMs', value: settings.requestTimeoutMs.toString() });
    await invoke('set_setting', { key: 'debugMode', value: settings.debugMode.toString() });
    await invoke('set_setting', { key: 'showRawResponses', value: settings.showRawResponses.toString() });
  } catch (e) {
    console.warn('Failed to save advanced settings', e);
  }
}

export async function savePanesSettings() {
  if (!isTauri) return;
  try {
    await invoke('set_setting', { key: 'chatMode', value: settings.chatMode });
    await invoke('set_setting', { key: 'leftEndpointId', value: settings.leftEndpointId || '' });
    await invoke('set_setting', { key: 'rightEndpointId', value: settings.rightEndpointId || '' });
    await invoke('set_setting', { key: 'mainEndpointId', value: settings.mainEndpointId || '' });
    await invoke('set_setting', { key: 'supervisorEndpointId', value: settings.supervisorEndpointId || '' });
    await invoke('set_setting', { key: 'maxVsRounds', value: settings.maxVsRounds.toString() });
  } catch (e) {
    console.warn('Failed to save panes settings', e);
  }
}

export async function clearSettingsState() {
  // Only the settings-owned portion; caller (clearAllData) handles chat/agent state.
  settings.endpoints = [];
  settings.activeEndpointId = null;
  settings.leftEndpointId = null;
  settings.rightEndpointId = null;
  settings.mainEndpointId = null;
  settings.supervisorEndpointId = null;
  settings.chatTemperature = 0.7;
  settings.chatMaxTokens = 4096;
  settings.autoFallback = true;
  settings.chatMode = 'solo';
  settings.uiDensity = 'comfortable';
  settings.chatFontSize = 'medium';
  settings.accentColor = 'lavender';
  settings.maxTranscripts = 50;
  settings.autoReloadPrompt = true;
  settings.enableToolsByDefault = true;
  settings.requestTimeoutMs = 30000;
  settings.debugMode = false;
  settings.showRawResponses = false;
  settings.settingsStatus = 'In-memory settings cleared (NO on-disk files touched).';
  setTimeout(() => { settings.settingsStatus = ''; }, 8000);
  applyAppearance();
}

export async function addLocalEndpoint() {
  if (libHasLocal(settings.endpoints)) {
    settings.settingsStatus = 'Local endpoint already registered';
    setTimeout(() => { settings.settingsStatus = ''; }, 2500);
    return;
  }
  const newEp = createLocalEndpoint(settings.localPort);
  settings.endpoints = [...settings.endpoints, newEp];
  if (!settings.activeEndpointId) settings.activeEndpointId = newEp.id;
  await saveEndpoints();
  settings.settingsStatus = 'Local gemma added to endpoints';
  setTimeout(() => { settings.settingsStatus = ''; }, 2500);
}

export async function syncLocalEndpointPorts() {
  if (libHasLocal(settings.endpoints)) {
    settings.endpoints = libSyncLocalPorts(settings.endpoints, settings.localPort);
    await saveEndpoints();
    settings.settingsStatus = `Local endpoint port(s) synced to ${settings.localPort}`;
    setTimeout(() => { settings.settingsStatus = ''; }, 2500);
  } else {
    settings.settingsStatus = 'No local 127.0.0.1 endpoints needed syncing';
    setTimeout(() => { settings.settingsStatus = ''; }, 1500);
  }
}

export async function saveLocalPortAndSync() {
  await saveLocalPort();
  await syncLocalEndpointPorts();
}

export async function refreshAllHealth() {
  settings.settingsStatus = 'Testing endpoints...';
  for (const ep of settings.endpoints) {
    await testEndpoint(ep);
    await new Promise(r => setTimeout(r, 120));
  }
  settings.settingsStatus = 'Health checks complete';
  setTimeout(() => { settings.settingsStatus = ''; }, 1200);
}

// CRUD + form + drag + test (ported from monolith)
export async function setActive(id: string) {
  settings.activeEndpointId = id;
  settings.healthStatus = 'unknown';
  settings.healthMsg = '';
  await saveEndpoints();
  const ep = getActiveEndpoint();
  if (ep) {
    // If this endpoint was previously tested and has the real model list,
    // but the stored model is not one of them (e.g. old friendly "Gemma"),
    // auto-correct to the first valid full model ID before using for chat.
    // This ensures chat always uses an ID the server actually knows.
    if (ep.availableModels && ep.availableModels.length && !ep.availableModels.includes(ep.model)) {
      ep.model = ep.availableModels[0];
      settings.endpoints = [...settings.endpoints];
      await saveEndpoints();
      settings.settingsStatus = `Auto-corrected model to server's exact ID: ${ep.model}`;
      setTimeout(() => { settings.settingsStatus = ''; }, 2500);
    }
    testEndpoint(ep);
  }
}

export function moveEndpoint(id: string, direction: number) {
  const idx = settings.endpoints.findIndex(e => e.id === id);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= settings.endpoints.length) return;
  const [moved] = settings.endpoints.splice(idx, 1);
  settings.endpoints.splice(newIdx, 0, moved);
  settings.endpoints = [...settings.endpoints];
  saveEndpoints();
}

export async function deleteEndpoint(id: string) {
  settings.endpoints = settings.endpoints.filter(e => e.id !== id);
  if (settings.activeEndpointId === id) {
    settings.activeEndpointId = settings.endpoints[0]?.id ?? null;
  }
  await saveEndpoints();
}

export function startEdit(ep: Endpoint) {
  settings.editingId = ep.id;
  settings.formName = ep.name;
  settings.formUrl = ep.url;
  settings.formModel = ep.model;
}

export function cancelEdit() {
  settings.editingId = null;
  settings.formName = '';
  settings.formUrl = '';
  settings.formModel = '';
}

async function saveFormInternal() {
  const trimmedName = settings.formName.trim();
  const trimmedModel = settings.formModel.trim();
  const normalizedUrl = normalizeToChatCompletions(settings.formUrl);

  if (!trimmedName || !normalizedUrl || !trimmedModel) {
    settings.settingsStatus = 'Name, valid URL and model are required';
    setTimeout(() => { settings.settingsStatus = ''; }, 2000);
    return;
  }

  // If this endpoint (or the one we're editing) has known availableModels from a prior Test,
  // require the model to be an exact ID the server reported. Prevents "Gemma" friendly names
  // that produce "The model `Gemma` does not exist." on chat completions.
  const targetEp = settings.editingId ? endpoints.find(e => e.id === settings.editingId) : null;
  if (targetEp?.availableModels?.length && !targetEp.availableModels.includes(trimmedModel)) {
    settings.settingsStatus = `Model must be an exact ID from the server (use one of the chips or re-Test the endpoint): ${targetEp.availableModels.slice(0, 3).join(', ')}`;
    setTimeout(() => { settings.settingsStatus = ''; }, 4000);
    return;
  }
  try {
    const u = new URL(normalizedUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad proto');
  } catch {
    settings.settingsStatus = 'Invalid URL (must be a real http/https address)';
    setTimeout(() => { settings.settingsStatus = ''; }, 2500);
    return;
  }

  if (settings.editingId) {
    const idx = settings.endpoints.findIndex(e => e.id === settings.editingId);
    if (idx >= 0) {
      settings.endpoints[idx] = {
        ...settings.endpoints[idx],
        name: trimmedName,
        url: normalizedUrl,
        model: trimmedModel
      };
    }
  } else {
    const newEp: Endpoint = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'ep-' + Date.now().toString(36)),
      name: trimmedName,
      url: normalizedUrl,
      model: trimmedModel
    };
    settings.endpoints = [...settings.endpoints, newEp];
  }

  await saveEndpoints();
  cancelEdit();
  settings.settingsStatus = settings.editingId ? 'Endpoint updated' : 'Endpoint added';
  setTimeout(() => { settings.settingsStatus = ''; }, 1500);
}

export function handleEndpointFormSubmit(e: Event) {
  e.preventDefault();
  void saveFormInternal();
}

export async function testEndpoint(ep: Endpoint) {
  settings.testState[ep.id] = 'testing';

  // Clean the URL upfront (strip trailing slashes etc.) so both the health check
  // *and* the TPS ping use a consistent, correct endpoint path.
  // This fixes cases where an old/stored URL with trailing / would make /models succeed
  // (via getHealthUrl which normalizes) but the completions POST in measureTps would fail
  // (using raw ep.url), resulting in "healthy" but no numeric TPS.
  const normalized = normalizeToChatCompletions(ep.url);
  if (normalized) {
    ep.url = normalized;
  }

  const target = getHealthUrl(ep.url);
  if (!target || !target.startsWith('http')) {
    ep.lastHealth = { ok: false, message: 'invalid URL' };
    settings.endpoints = [...settings.endpoints];
    settings.testState[ep.id] = 'bad';
    setTimeout(() => {
      delete settings.testState[ep.id];
      settings.testState = { ...settings.testState };
    }, 4000);
    if (ep.id === settings.activeEndpointId || (!settings.activeEndpointId && ep === settings.endpoints[0])) {
      settings.healthStatus = 'error';
      settings.healthMsg = ep.lastHealth.message;
    }
    return;
  }

  let healthOk = false;
  let isRealModelServer = false;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(target, { method: 'GET', signal: controller.signal });
    clearTimeout(t);

    if (!res.ok) {
      ep.lastHealth = { ok: false, message: `HTTP ${res.status}` };
    } else {
      try {
        const text = await res.clone().text();
        if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
          const j = JSON.parse(text);
          if (Array.isArray(j?.data) || j?.object === 'list') {
            isRealModelServer = true;
            ep.availableModels = Array.isArray(j.data) ? j.data.map((d: any) => d.id || d.name).filter(Boolean) : [];
          }
        }
      } catch {}
      if (isRealModelServer) {
        healthOk = true;
      } else {
        ep.lastHealth = { ok: false, message: 'not a model server (wrong response)' };
      }
    }
  } catch (e: any) {
    ep.lastHealth = {
      ok: false,
      message: e.name === 'AbortError' ? 'timeout' : (e.message || 'connection failed')
    };
  }

  const tps = await libMeasureTps(ep);

  // Prefer the completions ping result for marking the endpoint usable for chat.
  // If the completions POST itself 404'd, do NOT claim "healthy" just because /models worked.
  // This makes the "Test" button in settings honest: healthy means the chat completions path the agent will actually use is likely to succeed.
  if (tps != null) {
    ep.lastHealth = {
      ok: true,
      message: `healthy · ${tps.toFixed(0)} tok/s`,
      tps,
    };
  } else {
    const lastMsg = (ep.lastHealth && ep.lastHealth.message) || '';
    if (/404|not found.*completions|failed to load resource/i.test(lastMsg)) {
      ep.lastHealth = {
        ok: false,
        message: 'completions 404 (the chat path the agent uses returned 404 — this endpoint will not work for real chat)',
      };
    } else if (healthOk) {
      // models list was reachable, but completions test ping did not produce a usable rate.
      // Chat may still work (client-side TPS will be computed during real sends), but the dedicated test ping didn't.
      ep.lastHealth = {
        ok: true,
        message: 'healthy (models ok; completions test gave no rate — real chat will show client tok/s)',
      };
    } else {
      ep.lastHealth = { ok: false, message: 'test failed (completions ping 404/no rate and /models not a valid model server)' };
    }
  }

  settings.endpoints = [...settings.endpoints];

  // Persist the (possibly cleaned) URL and the health/TPS result so bad
  // entries (duplicate v1, trailing slash, etc.) get fixed on disk.
  // This runs even if the health/TPS test itself 404'd, so the URL itself
  // gets corrected for future chat and tests.
  saveEndpoints().catch(() => {});

  settings.testState[ep.id] = ep.lastHealth?.ok ? 'ok' : 'bad';
  setTimeout(() => {
    delete settings.testState[ep.id];
    settings.testState = { ...settings.testState };
  }, 4000);

  if (ep.id === settings.activeEndpointId || (!settings.activeEndpointId && ep === settings.endpoints[0])) {
    settings.healthStatus = ep.lastHealth.ok ? 'ok' : 'error';
    settings.healthMsg = ep.lastHealth.message;
  }

  // If we now know the server's real model IDs and the current model for this ep (or the form if editing it)
  // is not one of them, auto-select the first real one. This prevents saving/using friendly names like "Gemma"
  // that the server will reject with "model does not exist".
  if (ep.availableModels && ep.availableModels.length) {
    const currentModel = settings.editingId === ep.id ? settings.formModel : ep.model;
    if (!currentModel || !ep.availableModels.includes(currentModel)) {
      const firstReal = ep.availableModels[0];
      if (settings.editingId === ep.id) {
        settings.formModel = firstReal;
      } else {
        ep.model = firstReal;
        settings.endpoints = [...settings.endpoints]; // trigger reactivity
      }
      // Update status to inform user we auto-corrected the model ID.
      if (ep.lastHealth.ok) {
        settings.settingsStatus = `Auto-selected exact model ID from server: ${firstReal}`;
        setTimeout(() => { settings.settingsStatus = ''; }, 2500);
      }
    }
  }

  // Also ensure that when we have the list, the model on the ep itself is always a full/valid one
  // (for cases where the endpoint is active and used for chat without going through edit form).
  if (ep.availableModels && ep.availableModels.length && !ep.availableModels.includes(ep.model)) {
    ep.model = ep.availableModels[0];
    settings.endpoints = [...settings.endpoints];
  }
}

export function handleDragStart(idx: number, e: DragEvent) {
  settings.draggedIdx = idx;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

export function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

export function handleDrop(toIdx: number) {
  if (settings.draggedIdx === null || settings.draggedIdx === toIdx) {
    settings.draggedIdx = null;
    return;
  }
  const [moved] = settings.endpoints.splice(settings.draggedIdx, 1);
  settings.endpoints.splice(toIdx, 0, moved);
  settings.endpoints = [...settings.endpoints];
  settings.draggedIdx = null;
  saveEndpoints();
}

export function handleDragEnd() {
  settings.draggedIdx = null;
}

export async function onAddEndpointClick() {
  settings.editingId = null;
  settings.formName = '';
  settings.formUrl = '';
  settings.formModel = '';
}

export function onSection(s: string) {
  // SettingsTab owns section locally or we can store it; for now lightweight signal via status if needed.
  // Actual current section lives in tab component to avoid store pollution for pure UI.
}

// Exported for consumers that want a direct health refresh of active.
export async function checkActiveHealth() {
  const ep = getActiveEndpoint();
  if (ep) await testEndpoint(ep);
}
