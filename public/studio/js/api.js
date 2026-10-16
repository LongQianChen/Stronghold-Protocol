// public/studio/js/api.js — the studio page's calls to its API (/studio/api/*, server/studio/index.js). Every call carries
// the header X-SP-Studio with the studio's key (server/studio/key.js: the server prints the studio's address with it,
// …/studio/#key=…; the page keeps it in this browser — a change without it is refused with PLUGIN_STUDIO_KEY, and a page
// of another site cannot send the header at all: server/studio/gate.js); an error answers `{ error: <code>, params,
// detail }`, thrown as a StudioApiError the page explains with the error catalogue (shared/plugins/errors.js).

export const API = '/studio/api/';

/** Where this browser keeps the studio's key (localStorage, the server's origin). */
const KEY_STORE = 'sp.studioKey';
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;
/** The key of this visit when the browser keeps nothing (a private window that refuses storage). */
let memoryKey = '';

/** The studio's key this browser keeps ('' when none). */
export function studioKey() {
  try { return globalThis.localStorage?.getItem(KEY_STORE) || memoryKey; } catch { return memoryKey; }
}

/**
 * Keep a key: a pasted address of the studio (…/studio/#key=…) or the key itself. Whether it looked like one.
 * @param {string} text
 */
export function keepStudioKey(text) {
  const s = String(text || '').trim();
  const m = /[#&?]key=([A-Za-z0-9_-]{22,64})/.exec(s);
  const key = m ? m[1] : KEY_RE.test(s) ? s : '';
  if (!key) return false;
  memoryKey = key;
  try { globalThis.localStorage?.setItem(KEY_STORE, key); } catch { /* this visit only */ }
  return true;
}

/** The key the address brought (#key=…): kept, and taken out of the address bar. Whether there was one. */
export function takeKeyFromAddress() {
  const m = /(?:^#|&)key=([A-Za-z0-9_-]{22,64})/.exec(location.hash);
  if (!m) return false;
  keepStudioKey(m[1]);
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

/** An error the API answered: its catalogue code, params, technical detail and HTTP status. */
export class StudioApiError extends Error {
  constructor(code, params = {}, detail = '', status = 0) {
    super(detail || code);
    this.code = code;
    this.params = params;
    this.detail = detail;
    this.status = status;
  }
}

/**
 * One call. `body`: an object (sent as JSON), a Blob / ArrayBuffer (sent as it is) or nothing.
 * @param {string} method @param {string} path relative to /studio/api/ @param {any} [body]
 */
export async function call(method, path, body) {
  // the key; without one a read sends nothing and a change '-' (the server then answers PLUGIN_STUDIO_KEY, not a 404)
  const key = studioKey();
  const read = method === 'GET' || method === 'HEAD';
  /** @type {Record<string, string>} */
  const headers = key ? { 'X-SP-Studio': key } : read ? {} : { 'X-SP-Studio': '-' };
  let payload;
  if (body !== undefined && body !== null) {
    if (body instanceof Blob || body instanceof ArrayBuffer) payload = body;
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch(API + path, { method, headers, body: payload, cache: 'no-store' }); } catch (e) {
    throw new StudioApiError('PLUGIN_STUDIO_REQUEST', { detail: String(e?.message || e) }, String(e?.message || e), 0);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    // the key is missing or wrong: the page asks for it (main.js KeyBar)
    if (data?.error === 'PLUGIN_STUDIO_KEY') globalThis.dispatchEvent?.(new CustomEvent('studio-key', { detail: key ? 'wrong' : 'missing' }));
    if (data && typeof data.error === 'string') throw new StudioApiError(data.error, data.params || {}, data.detail || '', res.status);
    throw new StudioApiError('PLUGIN_STUDIO_REQUEST', { detail: `HTTP ${res.status}` }, `HTTP ${res.status}`, res.status);
  }
  return data;
}

export const get = (path) => call('GET', path);
export const post = (path, body = {}) => call('POST', path, body);
export const put = (path, body) => call('PUT', path, body);

/** The plugin path of the API. @param {string} id @param {string} [sub] */
export const pluginPath = (id, sub = '') => `plugins/${encodeURIComponent(id)}${sub ? `/${sub}` : ''}`;

/** A file as base64 (a slot's upload). @param {Blob} file */
export function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/**
 * The page's game sessions (localStorage `sp.tokens`, public/js/net.js): the studio names them so that a room this
 * player hosts applies a plugin's changes by itself (POST /studio/api/authors). Never fails the page.
 */
export async function nameAuthor() {
  if (!studioKey()) return 0; // a change: the key first
  let tokens;
  try { const v = JSON.parse(globalThis.localStorage?.getItem('sp.tokens') || '[]'); tokens = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 8) : []; } catch { tokens = []; }
  try { const tok = globalThis.sessionStorage?.getItem('sp.token'); if (tok && !tokens.includes(tok)) tokens.unshift(tok); } catch { /* none */ }
  if (!tokens.length) return 0;
  try { return (await post('authors', { tokens })).players || 0; } catch { return 0; }
}
