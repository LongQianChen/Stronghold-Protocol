// shared/plugins/order.js — which plugins a set holds and in what order (DESIGN §32, docs/PLUGINS.md; the design
// study's §4.8): the plugins a host asked for, with the ones they require switched on too, refused when one conflicts
// with another or needs one that is missing, sorted the same way on every machine. No Node builtin: the server's
// visual sets use it (server/plugins/visualSet.js, P1a), the content sets of the data plugins will (P1b, P1c).
//
//   1. closure    every plugin's `requires` join the set with it (`auto`: switched on because another needs them) when
//                 they may join it (the caller's `lookup`: installed, loaded, of the class and the scope) in the
//                 version range; a requirement that may not join, or is out of range, refuses the set
//                 (PLUGIN_DEPENDENCY)
//   2. conflicts  a plugin whose `conflicts` names another plugin of the set, in its range, refuses the set
//                 (PLUGIN_CONFLICT) — whichever of the two declares it
//   3. order      `requires`, `optional` and `loadAfter` put a plugin after the plugins they name, `loadBefore` before
//                 them (only between plugins of the set); among the plugins free to go next, the highest `priority`
//                 first, then the lower id (UTF-16 code-unit order). A cycle refuses the set (PLUGIN_DEPENDENCY).
// A later plugin wins where two change the same thing (the caller reports it: shared/plugins/visual.js mergePluginOps).

import { appVersionMatches } from './manifest.js';

/**
 * What the order needs of a plugin (the fields of its normalised manifest, shared/plugins/manifest.js).
 * @typedef {{ id: string, version: string, requires: Record<string, string>, optional: Record<string, string>,
 *   conflicts: Record<string, string>, loadAfter: string[], loadBefore: string[], priority: number }} OrderEntry
 * @typedef {{ order: string[], auto: string[] }} PluginOrder
 * @typedef {{ error: 'PLUGIN_UNKNOWN' | 'PLUGIN_DEPENDENCY' | 'PLUGIN_CONFLICT', detail: string }} OrderRefusal
 */

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : []);

/**
 * The set of plugins `wanted` asks for, closed over their requirements and sorted (see the header).
 * @param {string[]} wanted the ids asked for (duplicates are dropped)
 * @param {(id: string) => OrderEntry | null} lookup the plugins that may join the set; null for any other id
 * @returns {PluginOrder | OrderRefusal}
 */
export function resolvePluginOrder(wanted, lookup) {
  /** @type {Map<string, OrderEntry>} */
  const set = new Map();
  const auto = [];
  const queue = [];
  for (const id of wanted) {
    if (set.has(id)) continue;
    const p = lookup(id);
    if (!p) return { error: 'PLUGIN_UNKNOWN', detail: `${String(id).slice(0, 40)} is not a plugin this set may hold` };
    set.set(id, p);
    queue.push(p);
  }
  // 1. closure
  while (queue.length) {
    const p = /** @type {OrderEntry} */ (queue.shift());
    for (const dep of keysOf(p.requires)) {
      const range = p.requires[dep];
      const have = set.get(dep) || lookup(dep);
      if (!have) return { error: 'PLUGIN_DEPENDENCY', detail: `${p.id} requires ${dep} ${range}, which is not available` };
      if (!appVersionMatches(range, have.version)) return { error: 'PLUGIN_DEPENDENCY', detail: `${p.id} requires ${dep} ${range}; the installed one is ${have.version}` };
      if (!set.has(dep)) { set.set(dep, have); auto.push(dep); queue.push(have); }
    }
  }
  // 2. conflicts
  for (const p of set.values()) {
    for (const other of keysOf(p.conflicts)) {
      const o = set.get(other);
      if (o && appVersionMatches(p.conflicts[other], o.version)) return { error: 'PLUGIN_CONFLICT', detail: `${p.id} conflicts with ${other}` };
    }
  }
  // 3. order: edges a → b (a before b), then Kahn's algorithm with the priority / id choice
  /** @type {Map<string, Set<string>>} */
  const after = new Map([...set.keys()].map((id) => [id, new Set()]));   // id → the ids that must come before it
  for (const p of set.values()) {
    for (const dep of [...keysOf(p.requires), ...keysOf(p.optional), ...(p.loadAfter || [])]) if (dep !== p.id && set.has(dep)) after.get(p.id).add(dep);
    for (const next of p.loadBefore || []) if (next !== p.id && set.has(next)) after.get(next).add(p.id);
  }
  const order = [];
  const placed = new Set();
  while (order.length < set.size) {
    const ready = [...set.values()].filter((p) => !placed.has(p.id) && [...after.get(p.id)].every((d) => placed.has(d)));
    if (!ready.length) {
      const left = [...set.keys()].filter((id) => !placed.has(id)).sort(byId);
      return { error: 'PLUGIN_DEPENDENCY', detail: `the load order of ${left.join(', ')} is a cycle` };
    }
    ready.sort((a, b) => (b.priority || 0) - (a.priority || 0) || byId(a.id, b.id));
    order.push(ready[0].id);
    placed.add(ready[0].id);
  }
  return { order, auto: auto.filter((id) => !wanted.includes(id)) };
}
