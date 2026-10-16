// P3a owner gates. No plugin module is ever imported here or in the server's main process.
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { nodeSha256 } from './identity.js';
import { isLocalIp, normalizeIp } from '../net.js';
import { checkScript } from '../../shared/plugins/scriptCheck.js';
import { describeIssue } from '../../shared/plugins/errors.js';

export const isScriptClass = cls => cls === 'script' || cls === 'trusted';
/** Snapshot executable entry bytes even when execution is disabled, for check/catalogue. */
export function readScripts(dir, manifest, listed) {
  const sources = {}, files = {}, problems = [];
  for (const rel of new Set(Object.values(manifest.entry))) {
    try {
      const bytes = fs.readFileSync(path.join(dir,rel));
      sources[rel] = bytes.toString('utf8'); files[rel] = nodeSha256(bytes);
      if (rel === manifest.entry.sim || rel === manifest.entry.meta) problems.push(...checkScript(sources[rel]).problems.map(p => ({...p,path:rel+':'+p.path})));
    } catch (e) { problems.push({code:'PLUGIN_SCRIPT_CHECK',path:rel,message:e.message}); }
  }
  let lockHash = null, lockValid = false, lockedFiles = {};
  try {
    const raw = fs.readFileSync(path.join(dir,'plugin.lock.json'));
    lockHash = nodeSha256(raw);
    const lock = JSON.parse(raw);
    lockedFiles = lock.files || {};
    const actual = listed.filter(f => f.rel !== 'plugin.lock.json');
    lockValid = Object.entries(files).every(([rel,hash]) => lockedFiles[rel]?.sha256 === hash) && lock.lock === 1 && lock.id === manifest.id && lock.version === manifest.version &&
      actual.length === Object.keys(lock.files || {}).length && actual.every(f => !f.link &&
        lock.files?.[f.rel]?.bytes === f.bytes && lock.files[f.rel].sha256 === nodeSha256(fs.readFileSync(path.join(dir,f.rel))));
  } catch { /* absent or stale lock: listed but execution refused */ }
  return { sources, files, lockHash, lockValid, lockedFiles, sandboxable: manifest.class === 'script' && !problems.length, problems };
}

/** Parse literals first; normalizeIp expands IPv4-mapped IPv6 and strips the zone id. */
function listeningIp(host) { return isIP(host) ? normalizeIp(host) : ''; }

/** [ASSUMED] All of IPv4 0/8 and every spelling of IPv6 zero are unspecified for this gate. */
export function isUnspecifiedAddress(host) {
  const ip = listeningIp(host);
  if (isIP(ip) === 4) return Number(ip.split('.')[0]) === 0;
  // Empty groups in a valid IPv6 literal are compressed zeros; a dotted tail is also numeric.
  return isIP(ip) === 6 && ip.split(':').every(g => !g || (g.includes('.')
    ? g.split('.').every(n => Number(n) === 0) : parseInt(g, 16) === 0));
}

export const trustedHostAllowed = (host, mode) => mode === 'trusted-force'
  || (isLocalIp(listeningIp(host)) && !isUnspecifiedAddress(host));

/** [ASSUMED] trusted-force explicitly permits a public listening address (not the HTTP peer). */
export function trustDecision(plugin, { mode = process.env.SP_PLUGIN_SCRIPTS, host = '0.0.0.0', pins = {} } = {}) {
  // [ASSUMED] Sandbox needs a valid lock for byte identity, but no owner pin or public-bind gate.
  if (mode === 'sandbox' && plugin.class === 'script') return plugin.script?.lockValid ? null : { code:'PLUGIN_TRUST_PIN' };
  if (!['trusted','trusted-force'].includes(mode)) return { code:'PLUGIN_SCRIPTS_DISABLED' };
  if (!trustedHostAllowed(host, mode)) return { code:'PLUGIN_TRUST_PUBLIC' };
  if (!plugin.script?.lockValid || pins[plugin.id] !== plugin.script.lockHash) return { code:'PLUGIN_TRUST_PIN' };
  return null;
}
export function applyTrust(plugins, { pluginsDir, host, mode, log } = {}) {
  let pins = {};
  try { pins = JSON.parse(fs.readFileSync(path.join(pluginsDir,'config.json'),'utf8')).trusted || {}; } catch { /* fail closed */ }
  const lines = [];
  for (const p of plugins.filter(p => isScriptClass(p.class))) {
    const refusal = trustDecision(p,{host, mode, pins});
    p.status = refusal ? 'disabled' : 'loaded'; p.disabled = refusal;
    if (p.script) p.script.execution = mode === 'sandbox' && p.class === 'script' ? 'sandbox' : 'trusted';
    lines.push(`${p.id}: ${refusal ? describeIssue(refusal,'zh').message : 'loaded'}`);
  }
  if (lines.length) log?.info?.(`[plugins] scripts: ${lines.join('; ')}`);
}
