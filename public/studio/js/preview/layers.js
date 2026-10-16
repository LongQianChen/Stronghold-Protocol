// public/studio/js/preview/layers.js — the art the studio's preview draws (DESIGN §32.9): the installation's manifest as the
// page loaded it (/data/assets.json) and, beside each entry the plugin changes, the same entry with the plugin's writes
// laid over it under a key of its own (`<key>~plugin`), so one renderer and one interface draw the original and the
// plugin side by side — the game's own field view (render/app.js, its asset store public/js/assets.js createAssets) and
// its own components (ui/detailPanel.js, ui/gameComponents.js through data.js's view of `assets`).
//
// The plugin's writes come from GET /studio/api/plugins/<id>/preview (server/studio/preview.js): a value with the studio's
// URLs of the plugin's files, a reference copied out of the page's own manifest, a local-client model taken away. The
// layer object has the interface the asset store reads (apply / subscribe / fail — public/js/cosmetics.js), so a new
// preview re-draws what is shown at once (the views re-resolve their art: render/units.js retryAssets).

import { applyOps, getPath } from '../../../../shared/plugins/visual.js';

/** The suffix of a plugin entry's key. */
export const PLUGIN_SUFFIX = '~plugin';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The containers whose entries the preview mirrors for a target (its own entry, an operator's voices and unit sounds).
 * @param {{ kind: string, key: string, container: string[] }} target
 * @returns {string[][]} paths of entries
 */
export function mirroredPaths(target) {
  if (!target) return [];
  const own = [...target.container, target.key];
  if (['operator', 'token', 'enemy'].includes(target.kind)) {
    return [own, ['audio', 'voice', target.key], ['audio', 'voiceJp', target.key], ['audio', 'sfx', 'units', target.key]];
  }
  return [own];
}

/**
 * The preview layers (see the header): `set(ops, targets)` takes a new preview and the targets shown; `apply(base)` → the
 * manifest to draw (the same object while nothing changed); `subscribe(fn)` hears every change; `fail(url)` notes a file
 * that would not load (the page says so).
 */
export function createPreviewLayers() {
  let ops = [];
  let targets = [];
  let gen = 0;
  let memo = new WeakMap();
  const listeners = new Set();
  const failed = new Set();
  return {
    /** @param {any[]} nextOps @param {any[]} nextTargets */
    set(nextOps, nextTargets) {
      ops = Array.isArray(nextOps) ? nextOps : [];
      targets = Array.isArray(nextTargets) ? nextTargets.filter(Boolean) : [];
      failed.clear();
      gen++;
      memo = new WeakMap();
      for (const fn of [...listeners]) { try { fn(); } catch (e) { console.warn('[studio] preview listener failed', e); } }
    },
    apply(base) {
      const key = isObj(base) ? base : {};
      const hit = memo.get(key);
      if (hit && hit.gen === gen) return hit.value;
      // the plugin's writes over the installation's art
      const resolved = ops.map((op) => (Array.isArray(op.from) ? { at: op.at, value: getPath(key, op.from) } : op.clear ? { at: op.at, value: undefined } : { at: op.at, value: op.value }))
        .filter((op) => Array.isArray(op.at));
      const withPlugin = applyOps(key, resolved);
      // each mirrored entry under its own key, beside the original
      const mirror = [];
      for (const t of targets) {
        for (const p of mirroredPaths(t)) {
          const v = getPath(withPlugin, p);
          if (v !== undefined) mirror.push({ at: [...p.slice(0, -1), `${p[p.length - 1]}${PLUGIN_SUFFIX}`], value: v });
        }
      }
      const value = applyOps(key, mirror);
      memo.set(key, { gen, value });
      return value;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** A file of the preview that would not load (the asset store reports it). Whether it was one of the plugin's. */
    fail(url) {
      const u = String(url || '');
      if (!u.includes('/studio/api/plugins/') || failed.has(u)) return false;
      failed.add(u);
      for (const fn of [...listeners]) { try { fn(); } catch { /* the listener's own trouble */ } }
      return true;
    },
    get failed() { return [...failed]; },
    get active() { return true; },
  };
}

/**
 * The record a plugin entry is drawn with: a chess / token / enemy record of the game data whose art keys name the plugin
 * entry (`<key>~plugin`) — the field view and the detail card look art up by these keys.
 * @param {any} rec the game record (a chess, a token, an enemy) @param {string} key the target's art key
 */
export function pluginRecord(rec, key) {
  if (!rec) return null;
  const pk = `${key}${PLUGIN_SUFFIX}`;
  const golden = !!rec.isGolden;
  const assets = isObj(rec.assets) ? { ...rec.assets } : {};
  if ('portrait' in assets || rec.charId) assets.portrait = `${pk}${golden ? '_2' : '_1'}`;
  assets.avatar = golden ? `${pk}_2` : pk;
  assets.spine = pk;
  return { ...rec, ...(rec.charId ? { charId: pk } : {}), assets };
}
