// server/plugins/visualSet.js — the visual sets of this server (DESIGN §32 P1a, docs/PLUGINS.md §9; the format:
// shared/plugins/visual.js): a set of loaded cosmetic plugins, closed over their requirements and in load order
// (shared/plugins/order.js), named by its visual hash `vs`, and the document it is served as —
//
//   GET /vs/<vs16>/overlay.json   `{ visual: { v, vs, assets, overlays }, writes: [{ id, ops }] }`: the set's composition
//                                 (each plugin's id, version and file table — what `vs` hashes) and each plugin's writes
//                                 (paths of its folder and references, never a URL). A room member's page checks the
//                                 composition against room.state.content.vs and composes the art on the manifest it
//                                 loaded itself, every plugin URL built from the file table (public/js/content.js,
//                                 shared/plugins/visual.js prepareVisualDoc) — no copy of the art manifest goes out. A
//                                 player's personal plugin is the set of that plugin alone (the catalogue's `vs` of it).
//
// It answers `no-cache` with its body's hash as ETag [ASSUMED: like the served manifests; a set's document never changes
// for one vs, but a 304 costs next to nothing]. A set is known once something resolved it — a room's host chose it
// (resolve) or a browser asked for the set of one plugin the catalogue named — and holds the plugins as they were then:
// a plugin changed on disk afterwards is served at its new bytes under the old URL with `no-cache`
// (server/http/static.js), a removed one's files 404 — and once the registry reads the folders again (a served file
// found changed, or the folders' own signature) the rooms holding the set are told, once (onStale: server/lobby.js tells
// each host to apply the room's plugins again, which makes the set of the files as they are now; a page meanwhile falls
// back to the installation's art for what will not load). A set a room uses is held (hold / release:
// server/lobby.js) and never dropped; of the others the 256 most recently used are kept, and the documents of the last
// 8 built, one build of a document at a time [ASSUMED]. A set holds only loaded cosmetic plugins of the scope it is for
// (room / personal), serves VISUAL_LIMITS.setBytes (300 MB) of art at most and copies VISUAL_LIMITS.setCopyBytes (4 MB)
// of the installation's manifest through references at most [ASSUMED]. Nothing here changes a battle: a room's `cs`
// stays the vanilla one whatever its visual set.

import { createHash } from 'node:crypto';
import { ERR } from '../../shared/constants.js';
import { resolvePluginOrder } from '../../shared/plugins/order.js';
import { PLUGIN_CLASSES } from '../../shared/plugins/manifest.js';
import { VISUAL_HASH_VERSION, VISUAL_LIMITS, mergePluginOps, visualHashOf, vsUrlPart } from '../../shared/plugins/visual.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
/** Sets kept by vs16, most recently used last. */
const MAX_SETS = 256;
/** Built documents kept. */
const MAX_DOCS = 8;

const hash16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/**
 * @typedef {import('./registry.js').Plugin} Plugin
 * @typedef {{ id: string, version: string, class: 'cosmetic', hash: string, auto?: true }} SetPlugin
 *   a plugin of a room's set as room.state.content lists it (auto: switched on because another needs it)
 * @typedef {{ code: string, params: Record<string, unknown> }} SetWarning
 *   `override` { path, plugins: [earlier, later] } — two plugins change the same thing, the later applies;
 *   `app` { id, app } — a plugin made for other game versions (a cosmetic one is still allowed: only a warning)
 * @typedef {{ vs: string, plugins: SetPlugin[], warnings: SetWarning[], bytes: number }} VisualSet
 * @typedef {{ vs: string, assets: string, overlays: import('../../shared/plugins/visual.js').VisualOverlay[],
 *   plugins: { id: string, hash: string, ops: import('../../shared/plugins/visual.js').AssetOp[] }[] }} KnownSet
 *   a set as it was resolved: its plugins' writes then and the hash of their composition (a plugin whose hash differs
 *   in the registry now has changed on disk)
 */

/**
 * The visual sets of one server.
 * @param {{ registry: ReturnType<typeof import('./registry.js').createPluginRegistry>, log?: object,
 *   limits?: { setBytes: number, setCopyBytes: number, warnings: number }, maxSets?: number }} opts
 *   registry: the plugin registry (its loaded cosmetic plugins, the installation's art manifest); maxSets: the sets kept
 *   that no room holds (256)
 */
export function createVisualSets({ registry, log = noopLog, limits = VISUAL_LIMITS, maxSets = MAX_SETS }) {
  /** @type {Map<string, KnownSet>} */
  const sets = new Map();
  /** @type {Map<string, number>} vs16 → how many rooms hold the set (never dropped while held) */
  const held = new Map();
  /** @type {Map<string, { body: Buffer, hash: string }>} */
  const docs = new Map();
  /** @type {Map<string, Promise<{ body: Buffer, hash: string } | null>>} documents being built (one build each) */
  const building = new Map();
  /** @type {Set<(vs: string, ids: string[]) => void>} told when a held set's plugins changed on disk (onStale) */
  const staleListeners = new Set();
  /** @type {Set<string>} held sets (vs16) already told stale */
  const staleTold = new Set();

  /**
   * Keep a set (most recently used last); of the sets no room holds, keep the `maxSets` most recently used — never
   * dropping the one just kept (a room's host is about to hold it: server/lobby.js setPlugins).
   */
  const remember = (key, set) => {
    sets.delete(key);
    sets.set(key, set);
    let free = 0;
    for (const k of sets.keys()) if (!held.has(k)) free++;
    for (const k of [...sets.keys()]) {
      if (free <= maxSets) break;
      if (k === key || held.has(k)) continue;
      sets.delete(k);
      free--;
    }
  };
  const snapshot = (p) => ({ id: p.id, hash: p.visual.hash, ops: p.visual.ops });
  /**
   * Is `p` a loaded cosmetic plugin with an overlay (of `scope`, when given)? A room's set also takes a content plugin's
   * own art (its `assets`, read like a cosmetic overlay — DESIGN §32.5 / §32.6: server/plugins/roomSets.js); never a
   * player's personal set (a content plugin is a room's only).
   */
  const usable = (p, scope) => !!p && (p.class === 'cosmetic' || (['content','script','trusted'].includes(p.class) && scope !== 'personal')) && p.status === 'loaded'
    && !!p.visual && (!scope || p.manifest.scope.includes(scope));

  /**
   * The set of the plugins `ids` asks for, as a room (or a player) would use it: each a loaded cosmetic plugin of
   * `scope`, their requirements switched on, in load order, within the size limit; remembered by its vs16.
   * @param {string[]} ids
   * @param {{ scope?: 'room' | 'personal' }} [opts]
   * @returns {{ ok: true, set: VisualSet } | { error: string, detail: string }}
   */
  function resolve(ids, { scope = 'room' } = {}) {
    const art = registry.vanillaAssets();
    if (!art || !art.sha256) return { error: ERR.PLUGIN_UNKNOWN, detail: 'this server has no art manifest (data/assets.json)' };
    for (const id of ids) {
      const p = registry.plugin(id);
      if (!p) return { error: ERR.PLUGIN_UNKNOWN, detail: `${String(id).slice(0, 40)} is not installed` };
      if (!usable(p, scope)) return { error: ERR.PLUGIN_BLOCKED, detail: `${id} is not a cosmetic plugin of scope ${scope} this version loads${p.class === 'content' ? ' (a content plugin\'s art is a room\'s only)' : ''}` };
    }
    const lookup = (id) => { const p = registry.plugin(id); return usable(p, scope) ? { id: p.id, ...p.manifest } : null; };
    const r = resolvePluginOrder(ids, lookup);
    if ('error' in r) return { error: ERR[r.error] || ERR.BAD_MSG, detail: r.detail };
    const list = r.order.map((id) => /** @type {Plugin} */ (registry.plugin(id)));
    const bytes = list.reduce((n, p) => n + p.visual.bytes, 0);
    if (bytes > limits.setBytes) return { error: ERR.PLUGIN_LIMIT, detail: `${Math.ceil(bytes / 1048576)} MB of art, more than ${Math.floor(limits.setBytes / 1048576)} MB` };
    const copied = list.reduce((n, p) => n + (p.visual.copyBytes || 0), 0);
    if (copied > limits.setCopyBytes) return { error: ERR.PLUGIN_LIMIT, detail: `its references copy ${(copied / 1048576).toFixed(1)} MB of the art manifest, more than ${limits.setCopyBytes / 1048576} MB` };
    const merged = mergePluginOps(list.map((p) => ({ id: p.id, ops: p.visual.ops })));
    /** @type {SetWarning[]} */
    const warnings = [
      ...list.filter((p) => !p.manifest.compatible).map((p) => ({ code: 'app', params: { id: p.id, app: p.manifest.app } })),
      ...merged.warnings,
    ].slice(0, limits.warnings);
    const overlays = list.map((p) => p.visual.composition);
    const vs = visualHashOf({ assets: art.sha256, overlays });
    remember(vsUrlPart(vs), { vs, assets: art.sha256, overlays, plugins: list.map(snapshot) });
    return {
      ok: true,
      set: {
        vs,
        plugins: list.map((p) => ({ id: p.id, version: p.manifest.version, class: p.class, hash: p.visual.hash, ...(r.auto.includes(p.id) ? { auto: true } : {}) })),
        warnings,
        bytes,
      },
    };
  }

  /** The set a vs16 names: a remembered one, or the set of one loaded cosmetic plugin alone (the catalogue's `vs`). */
  function known(vs16) {
    const hit = sets.get(vs16);
    if (hit) { remember(vs16, hit); return hit; }
    const art = registry.vanillaAssets();
    for (const p of registry.plugins('cosmetic')) {
      if (!usable(p) || !p.visual.vs || vsUrlPart(p.visual.vs) !== vs16 || !art?.sha256) continue;
      const set = { vs: p.visual.vs, assets: art.sha256, overlays: [p.visual.composition], plugins: [snapshot(p)] };
      remember(vs16, set);
      return set;
    }
    return null;
  }

  /**
   * A set's document (see the header), built on first request — once: a request while it is being built waits for it.
   * @param {string} vs16 the first 16 hex digits of its vs
   * @returns {Promise<{ body: Buffer, hash: string } | null>} null for a set this server does not know
   */
  async function doc(vs16) {
    const set = known(vs16);
    if (!set) return null;
    const hit = docs.get(vs16);
    if (hit) { docs.delete(vs16); docs.set(vs16, hit); return hit; }
    const pending = building.get(vs16);
    if (pending) return pending;
    const p = Promise.resolve().then(() => build(set, vs16)).finally(() => building.delete(vs16));
    building.set(vs16, p);
    return p;
  }

  /** Build a document (doc) and keep it: the composition and each plugin's writes, in load order. */
  function build(set, vs16) {
    const visual = { v: VISUAL_HASH_VERSION, vs: set.vs, assets: set.assets, overlays: set.overlays };
    const body = Buffer.from(JSON.stringify({ visual, writes: set.plugins.map((p) => ({ id: p.id, ops: p.ops })) }));
    const built = { body, hash: hash16(body) };
    docs.set(vs16, built);
    while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value);
    return built;
  }

  /**
   * The held sets whose plugins are no longer what the registry has (a file changed, the plugin gone or not loaded any
   * more): each told once to the onStale listeners with the ids that changed. Run after every rescan of the registry.
   */
  function checkStale() {
    for (const k of held.keys()) {
      const set = sets.get(k);
      if (!set || staleTold.has(k)) continue;
      const changed = set.plugins.filter((p) => { const now = registry.plugin(p.id); return !usable(now) || now.visual.hash !== p.hash; }).map((p) => p.id);
      if (!changed.length) continue;
      staleTold.add(k);
      log.info?.(`[plugins] set ${k} in use: ${changed.join(', ')} changed on disk — its rooms are asked to apply their plugins again`);
      for (const fn of [...staleListeners]) { try { fn(set.vs, changed); } catch (e) { log.error?.('[plugins] stale listener failed', e); } }
    }
  }
  const offScan = typeof registry.onScan === 'function' ? registry.onScan(checkStale) : null;

  return {
    resolve,
    doc,
    /** A room uses the set of `vs` (server/lobby.js): it is never dropped until every holder released it. @param {string} vs */
    hold(vs) { const k = vsUrlPart(vs); held.set(k, (held.get(k) || 0) + 1); },
    /** A room no longer uses the set of `vs`. @param {string} vs */
    release(vs) {
      const k = vsUrlPart(vs);
      const n = (held.get(k) || 0) - 1;
      if (n > 0) held.set(k, n);
      else { held.delete(k); staleTold.delete(k); }
    },
    /**
     * `fn(vs, ids)` when a set a room holds turns out to have changed on disk (the plugins `ids`), once per set (see the
     * header; server/lobby.js tells the hosts). Returns the unsubscribe.
     * @param {(vs: string, ids: string[]) => void} fn
     */
    onStale(fn) {
      if (typeof fn !== 'function') return () => {};
      staleListeners.add(fn);
      return () => staleListeners.delete(fn);
    },
    /** Look for held sets that changed now (normally after each rescan; tests). */
    checkStale,
    /**
     * How many unofficial plugins this server has — every class but a language, whatever its status: what the
     * catalogue marks `unofficial` and the title screen counts (server/lobby.js welcomeInfo).
     */
    unofficial: () => registry.plugins().filter((p) => PLUGIN_CLASSES[p.class]?.unofficial).length,
    /** Stop listening to the registry. */
    close() { offScan?.(); staleListeners.clear(); },
    /** A file a loaded cosmetic plugin serves (registry pluginFile). @param {string} id @param {string} rel */
    file: (id, rel) => registry.pluginFile(id, rel),
    /** A served file was found changed on disk: the registry reads the folders again (at most every 5 s). */
    noteChanged: (() => {
      let at = -Infinity;
      return () => {
        const now = Date.now();
        if (now - at < 5000) return;
        at = now;
        setImmediate(() => { try { registry.rescan?.(); } catch (e) { log.error?.('[plugins] rescan failed', e); } });
      };
    })(),
    stats: () => ({ sets: sets.size, held: held.size, docs: docs.size }),
  };
}
