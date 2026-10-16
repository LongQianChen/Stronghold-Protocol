// server/studio/watch.js — hot reload of plugins (DESIGN §32.9, docs/PLUGINS.md §15; the design study's §8.3): while the
// studio is in use, a change in plugins/ (the studio's own writes, or an author saving from Spine, an image editor, a
// text editor) is seen within a moment: fs.watch over the folder (recursive), the events of DEBOUNCE_MS gathered into one,
// then the registry reads the folders again (registry.rescan — its listeners follow: the visual sets look at the sets
// rooms hold, server/plugins/visualSet.js onStale → server/lobby.js re-applies them where the studio says so, else tells
// the host) and the plugins whose state changed are told to `onChange` (the studio's page reloads its view of them).
// Started on the studio's first request (a server whose owner never opens the studio watches nothing — exactly as
// before), stopped with the server. Dot files (the studio's temporary files, editors' swap files) never count.
// [ASSUMED: 300 ms; a platform whose fs.watch cannot watch a tree falls back to the registry's own check on every page
// load (at most once a second), which P0 already does.]

import fs from 'node:fs';

/** How long change events are gathered before the folders are read again (ms) [ASSUMED]. */
export const DEBOUNCE_MS = 300;

/**
 * The most entries plugins/ may hold (links not followed) for fs.watch to watch it as a tree: Node walks the tree itself
 * on Linux and watches every file of it — a tree larger than this (an archive of countless folders unpacked into
 * plugins/) would take the server's time and the system's watches, so the studio then follows its own writes and the
 * registry's checks only [ASSUMED].
 */
export const WATCH_MAX_ENTRIES = 100000;

/**
 * Whether the tree at `dir` holds at most `max` entries (links not followed; read only until the count is passed).
 * @param {string} dir @param {number} max
 */
export function treeWithin(dir, max) {
  let left = max;
  const walk = (abs) => {
    let handle;
    try { handle = fs.opendirSync(abs); } catch { return true; }
    const folders = [];
    try {
      for (let d = handle.readSync(); d; d = handle.readSync()) {
        if (--left < 0) return false;
        if (d.isDirectory()) folders.push(d.name);
      }
    } catch { /* what could be read */ } finally { try { handle.closeSync(); } catch { /* closed */ } }
    for (const name of folders) if (!walk(`${abs}/${name}`)) return false;
    return true;
  };
  return walk(dir);
}

/**
 * What says a plugin's state: its version, status and composition (a cosmetic plugin's overlay hash), or why it was
 * skipped — a change of it is a change the page shows.
 * @param {ReturnType<typeof import('../plugins/registry.js').createPluginRegistry>} registry
 * @returns {Map<string, string>} id → its state
 */
export function pluginStates(registry) {
  const out = new Map();
  for (const p of registry.plugins()) {
    if (p.source !== 'plugins') continue;
    out.set(p.id, `ok|${p.manifest.version}|${p.status}|${p.visual?.hash ?? ''}|${p.ui?.vs ?? ''}|${p.content?.hash ?? ''}|${p.script?.lockHash ?? ''}|${p.bytes ?? ''}|${p.count ?? ''}`);
  }
  for (const k of registry.report().skipped) {
    const m = /^plugins\/([^/]+)\/$/.exec(k.where);
    if (m) out.set(m[1], `skipped|${k.problems.join('|')}`);
  }
  for (const w of registry.report().warnings) {
    const m = /^plugins\/([^/]+)\/$/.exec(w.where);
    if (m && out.has(m[1])) out.set(m[1], `${out.get(m[1])}|w:${w.warning}`);
  }
  return out;
}

/**
 * The watcher of a plugins folder (see the header).
 * @param {{ pluginsDir: string, registry: ReturnType<typeof import('../plugins/registry.js').createPluginRegistry>,
 *   log?: { info?: Function, warn?: Function }, debounceMs?: number, onChange?: (ids: string[]) => void,
 *   watch?: typeof fs.watch, maxEntries?: number }} opts watch: fs.watch (tests); maxEntries: WATCH_MAX_ENTRIES (tests)
 */
export function createPluginWatcher({ pluginsDir, registry, log = {}, debounceMs = DEBOUNCE_MS, onChange = () => {}, watch = fs.watch, maxEntries = WATCH_MAX_ENTRIES }) {
  /** @type {import('node:fs').FSWatcher | null} */
  let watcher = null;
  let timer = null;
  let states = null;
  let started = false;

  /** Read the folders again now and tell what changed (also after a write of the studio: no need to wait for the event). */
  function rescan() {
    if (timer) { clearTimeout(timer); timer = null; }
    const before = states || pluginStates(registry);
    try { registry.rescan(); } catch (e) { log.warn?.(`[studio] rescan failed: ${e?.message || e}`); }
    const after = pluginStates(registry);
    states = after;
    const ids = [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id)).sort();
    if (ids.length) { try { onChange(ids); } catch (e) { log.warn?.(`[studio] change listener failed: ${e?.message || e}`); } }
    return ids;
  }

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, debounceMs);
    timer.unref?.();
  };

  return {
    /** Start watching (idempotent; creates plugins/ when it is missing). Whether a watch runs. */
    start() {
      if (started) return !!watcher;
      started = true;
      states = pluginStates(registry);
      try {
        fs.mkdirSync(pluginsDir, { recursive: true });
        if (!treeWithin(pluginsDir, maxEntries)) {
          log.warn?.(`[studio] ${pluginsDir} holds more than ${maxEntries} entries: not watched (the studio's own changes still show at once)`);
          return false;
        }
        watcher = watch(pluginsDir, { recursive: true, persistent: false }, (_event, name) => {
          const rel = typeof name === 'string' ? name : name ? String(name) : '';
          // dot files (temporary files, swap files) never count; a folder starting with '_' (templates, moved files) neither
          if (rel && rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return;
          if (rel && /^_/.test(rel)) return;
          schedule();
        });
        watcher.on?.('error', (e) => { log.warn?.(`[studio] watching ${pluginsDir} stopped: ${e?.message || e}`); try { watcher?.close(); } catch { /* closed */ } watcher = null; });
        log.info?.(`[studio] watching ${pluginsDir} for changes (hot reload)`);
      } catch (e) {
        watcher = null;
        log.warn?.(`[studio] cannot watch ${pluginsDir} (${e?.code || e?.message || e}); changes show on the next page load`);
      }
      return !!watcher;
    },
    rescan,
    /** Whether a watch runs. */
    get active() { return !!watcher; },
    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { watcher?.close(); } catch { /* closed */ }
      watcher = null;
      started = false;
    },
  };
}
