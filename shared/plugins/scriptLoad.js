// Native ESM loading for trusted P3a. P3b replaces the evaluator, keeping setup(sp) and the descriptors.
// URL/import.meta are supplied by both ESM hosts; the shared checkJs slice intentionally has no DOM/Node lib.
const URL = /** @type {any} */ (globalThis).URL;
const moduleUrl = /** @type {any} */ (import.meta).url;
let generation = 0;
import { sha256Hex } from '../sha256.js';
import { linkScript } from './scriptCheck.js';
import { csUrlPart } from './identity.js';

/** Mode is part of the hashed descriptors. Mixed native/sandbox descriptors fail closed. */
export function scriptExecution(scripts) {
  if (!scripts.length) return null;
  const mode = scripts[0].execution || 'trusted';
  if (!['sandbox', 'trusted'].includes(mode) || scripts.some(p => (p.execution || 'trusted') !== mode
    || (mode === 'sandbox' && p.class !== 'script'))) throw new Error('script execution mode mismatch');
  return mode;
}

/** The browser snapshot links only the SDK alias; page/server code retains its exact original bytes. */
export function browserScriptSources(p) {
  const m = JSON.parse(p.manifestSource);
  return Object.fromEntries(Object.entries(p.sources).map(([rel, source]) => [rel,
    rel === m.entry?.sim || rel === m.entry?.meta ? linkScript(source, '/shared/plugins/sdk.js') : source]));
}

export const scriptUrl = (cs, id, rel) => `/cs/${csUrlPart(cs)}/scripts/${id}/${rel}`;

/** Page-side byte check before native import; Workers use this already checked, immutable snapshot. */
export async function checkBrowserScripts(scripts, cs, fetchFn = (...args) => globalThis.fetch(...args)) {
  for (const p of scripts) {
    const m = JSON.parse(p.manifestSource);
    for (const rel of new Set([m.entry?.sim, m.entry?.meta, m.entry?.client].filter(Boolean))) {
      const url = scriptUrl(cs, p.id, rel), response = await fetchFn(url, { cache: 'default' });
      if (!response?.ok) throw new Error('script response unavailable: ' + url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (sha256Hex(bytes) !== sha256Hex(p.browserSources?.[rel] ?? '')) throw new Error('script response hash mismatch: ' + url);
    }
  }
}

/** An immutable text snapshot -> a fresh native module, with only SDK specifiers linked for sim/meta. */
export async function importScript(source, { sdkUrl = new URL('./sdk.js',moduleUrl).href, checked = true, nonce = '' } = {}) {
  const text = checked ? linkScript(source,sdkUrl) : source;
  // data URLs work in Node and modern browsers; all bytes were checked before reaching this function.
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(text + '\n//# sourceURL=plugin-' + nonce.replace(/[^a-z0-9-]/gi,'') + '.js'));
}

/** Verify the actual manifest and each entry against the composition, not untrusted index metadata. */
export function verifyScripts(scripts, hashInput) {
  scriptExecution(scripts);
  const expected = hashInput.plugins.filter(p => p.files?.['@script']).map(p => p.id);
  if (JSON.stringify(scripts.map(p => p.id)) !== JSON.stringify(expected)) throw new Error('script order or membership mismatch');
  for (const p of scripts) {
    const pinned = hashInput.plugins.find(x => x.id === p.id);
    if (!pinned || sha256Hex(JSON.stringify(p)) !== pinned.files['@script']) throw new Error('script descriptor hash mismatch');
    if (!pinned || sha256Hex(p.manifestSource) !== pinned.files['plugin.json']) throw new Error('plugin manifest hash mismatch');
    const m = JSON.parse(p.manifestSource);
    if ((m.class !== 'script' && m.class !== 'trusted') || m.class !== p.class || m.id !== p.id) throw new Error('not a matching script manifest');
    for (const rel of new Set(Object.values(m.entry || {}))) {
      if (typeof p.sources[rel] !== 'string' || sha256Hex(p.sources[rel]) !== pinned.files[rel]) throw new Error('plugin entry hash mismatch: '+rel);
    }
    if (p.browserSources && JSON.stringify(p.browserSources) !== JSON.stringify(browserScriptSources(p))) throw new Error('browser script snapshot mismatch');
  }
}

/** Setup runs in resolved content order, once per entry even when sim and meta share it. */
export async function loadScripts(scripts, { hashInput = null, sdkUrl = new URL('./sdk.js',moduleUrl).href,
  extensionsUrl = null, log = (..._args) => {}, cs = null, nativeVerified = false } = {}) {
  verifyScripts(scripts,hashInput);
  if (scriptExecution(scripts) === 'sandbox') throw new Error('sandbox scripts require SES');
  const sdk = await import(sdkUrl);
  const root = new URL('../../', sdkUrl);
  const ext = await import(extensionsUrl || new URL(root.protocol === 'file:' ? 'server/sim/content/extensions.js' : 'sim/content/extensions.js',root).href);
  ext.resetExtensions();
  const instance = ++generation;
  try {
    for (const p of scripts) {
      const m = JSON.parse(p.manifestSource);
      const sp = sdk.createSDK({id:p.id,overrides:m.overrides || [],permissions:m.permissions || []}, {settings:hashInput.settings[p.id] || {},log});
      for (const rel of new Set([m.entry?.sim,m.entry?.meta].filter(Boolean))) {
        let mod;
        if (root.protocol !== 'file:') {
          if (!cs || !nativeVerified || !p.browserSources?.[rel]) throw new Error('native script bytes must be checked by the page');
          // One installation per dedicated Worker: its fresh module realm isolates plugin state.
          // Import the exact URL whose bytes the page checked, with no query/URL substitution.
          mod = await import(scriptUrl(cs,p.id,rel));
        } else mod = await importScript(p.sources[rel],{sdkUrl,nonce:p.id+'-'+pinnedHash(hashInput,p.id)+'-'+instance});
        if (typeof mod.default !== 'function') throw new Error(`${p.id}: export default setup(sp) required`);
        const result = mod.default(sp);
        if (result?.then) throw new Error(`${p.id}: setup must be synchronous`);
      }
    }
    ext.sealExtensions();
    return ext.extensionRegistrations();
  } catch (e) { ext.resetExtensions(); throw e; }
}
const pinnedHash = (input,id) => sha256Hex(JSON.stringify(input.plugins.find(p => p.id === id)));
