// server/plugins/policy.js — the server owner's plugin policy (DESIGN §32.6, P1c; the design study's §2.2 / 附录 A):
// an optional plugins/config.json next to the plugin folders (the registry never reads a file at the top of plugins/ as a
// plugin) [ASSUMED format]:
//
//   {
//     "rooms": "host",              "host": a room's host chooses its plugins (default) · "fixed": every room plays the
//                                   `default` set and its host cannot change it · "off": rooms play the original game
//                                   (a player's personal cosmetic plugins still work: they never reach a room)
//     "default": [],                plugin ids a new room starts with (default: none — the original game)
//     "allow": ["*"],               the plugins rooms may use: "*" every one, or a list of ids
//     "classes": { "cosmetic": true, "content": true },   a class switched off here is never offered to rooms, and a
//                                   class not listed (script, ui, trusted …) is denied too; the file's list is laid over
//                                   these two defaults
//     "limits": { "maxSets": 4 },   content sets with gameplay plugins rooms may hold at once (each running match of one
//                                   is a worker: server/match/host/)
//     "allowIncompatible": false    a gameplay plugin made for other game versions or another plugin API: refused
//                                   (PLUGIN_INCOMPATIBLE) unless true (a cosmetic one is only a warning, P1a)
//   }
//
// The environment wins over the file for `rooms`: SP_PLUGINS=off | host | fixed. A missing file is the defaults above; a
// broken one is reported once in the log and its readable fields used (a field of the wrong type keeps the default).
// The file is read again when its size or mtime changes (looked at, at most once a second, when a room asks).
// `allowDownloadHosts` is not a policy field. server/plugins/install.js reads it from this same file (the https
// download allowlist). An unknown key is ignored here on purpose.

import fs from 'node:fs';
import path from 'node:path';
import { isPluginId } from '../../shared/plugins/manifest.js';
import { DEFAULT_MAX_SETS } from './contentSets.js';

/** The policy file's name, at the top of plugins/. */
export const POLICY_FILE = 'config.json';
const ROOMS = ['host', 'fixed', 'off'];
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** The defaults (no file). */
export const DEFAULT_POLICY = Object.freeze({
  rooms: 'host', default: Object.freeze([]), allow: Object.freeze(['*']),
  classes: Object.freeze({ cosmetic: true, content: true }), maxSets: DEFAULT_MAX_SETS, allowIncompatible: false,
});

/**
 * A policy object out of the file's JSON (and the environment's SP_PLUGINS): every field checked, a bad one kept at its
 * default with a problem.
 * @param {unknown} json @param {{ env?: Record<string, string | undefined> }} [opts]
 * @returns {{ policy: typeof DEFAULT_POLICY, problems: string[] }}
 */
export function readPolicy(json, { env = process.env } = {}) {
  const problems = [];
  const o = json && typeof json === 'object' && !Array.isArray(json) ? /** @type {Record<string, any>} */ (json) : {};
  if (json != null && o !== json) problems.push('not a JSON object');
  const p = { ...DEFAULT_POLICY, classes: { ...DEFAULT_POLICY.classes, ...(['trusted','trusted-force'].includes(env.SP_PLUGIN_SCRIPTS) ? {script:true,trusted:true} : env.SP_PLUGIN_SCRIPTS === 'sandbox' ? {script:true} : {}) } };
  if (o.rooms !== undefined) { if (ROOMS.includes(o.rooms)) p.rooms = o.rooms; else problems.push(`"rooms" must be one of ${ROOMS.join(', ')}`); }
  if (o.default !== undefined) {
    if (Array.isArray(o.default) && o.default.length <= 32 && o.default.every(isPluginId)) p.default = [...new Set(o.default)];
    else problems.push('"default" must be a list of plugin ids');
  }
  if (o.allow !== undefined) {
    if (Array.isArray(o.allow) && o.allow.every((x) => x === '*' || isPluginId(x))) p.allow = [...o.allow];
    else problems.push('"allow" must be ["*"] or a list of plugin ids');
  }
  if (o.classes !== undefined) {
    if (o.classes && typeof o.classes === 'object' && !Array.isArray(o.classes)) {
      for (const [k, v] of Object.entries(o.classes)) {
        if (typeof v === 'boolean') p.classes[k] = v;
        else problems.push(`"classes.${k}" must be true or false`);
      }
    } else problems.push('"classes" must be { "<class>": true | false }');
  }
  if (o.limits !== undefined) {
    const n = o.limits && typeof o.limits === 'object' ? o.limits.maxSets : undefined;
    if (n === undefined) { /* other limits are the plugins' own (P0 / P1a) */ } else if (Number.isInteger(n) && n >= 0 && n <= 64) p.maxSets = n;
    else problems.push('"limits.maxSets" must be an integer 0–64');
  }
  if (o.allowIncompatible !== undefined) { if (typeof o.allowIncompatible === 'boolean') p.allowIncompatible = o.allowIncompatible; else problems.push('"allowIncompatible" must be true or false'); }
  const e = String(env?.SP_PLUGINS ?? '').trim().toLowerCase();
  if (e) { if (ROOMS.includes(e)) p.rooms = e; else problems.push(`SP_PLUGINS=${e} is not one of ${ROOMS.join(', ')}`); }
  return { policy: Object.freeze({ ...p, default: Object.freeze(p.default), allow: Object.freeze(p.allow), classes: Object.freeze(p.classes) }), problems };
}

/**
 * The policy of one server: plugins/config.json, read when it changes (see the header).
 * @param {{ pluginsDir: string | null, log?: object, env?: Record<string, string | undefined>, recheckMs?: number }} opts
 */
export function createPluginPolicy({ pluginsDir, log = noopLog, env = process.env, recheckMs = 1000 }) {
  const file = pluginsDir ? path.join(pluginsDir, POLICY_FILE) : null;
  let sig = null;
  let at = -Infinity;
  let current = readPolicy(null, { env }).policy;
  const told = new Set();
  const look = () => {
    const now = Date.now();
    if (now - at < recheckMs) return current;
    at = now;
    const st = (() => { try { return file ? fs.statSync(file) : null; } catch { return null; } })();
    const s = st && st.isFile() ? `${st.size}:${st.mtimeMs}` : 'none';
    if (s === sig) return current;
    sig = s;
    let json = null;
    let problems = [];
    if (s !== 'none') {
      try { json = JSON.parse(fs.readFileSync(/** @type {string} */ (file), 'utf8')); } catch (e) { problems.push(`not JSON (${e?.message || e})`); }
    }
    const r = readPolicy(json, { env });
    current = r.policy;
    problems = [...problems, ...r.problems];
    for (const pr of problems) { const line = `[plugins] plugins/${POLICY_FILE}: ${pr}`; if (!told.has(line)) { told.add(line); log.warn?.(line); } }
    if (s !== 'none' || current.rooms !== DEFAULT_POLICY.rooms) log.info?.(`[plugins] policy: rooms ${current.rooms}, default [${current.default.join(', ')}], allow [${current.allow.join(', ')}], at most ${current.maxSets} content sets${current.allowIncompatible ? ', incompatible plugins allowed' : ''}`);
    return current;
  };
  return {
    /** The policy now. */
    get: look,
    /** May rooms use the plugin `id` of class `cls`? A class `classes` does not switch on (true) is denied. */
    allows(id, cls) {
      const p = look();
      if (p.rooms === 'off') return false;
      if (!Object.hasOwn(p.classes, cls) || p.classes[cls] !== true) return false;
      return p.allow.includes('*') || p.allow.includes(id);
    },
  };
}
