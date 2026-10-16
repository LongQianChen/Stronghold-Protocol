// render/vfx/available.js — the official battle effects' file list (data/local-fx.json, DESIGN §33.1), fetched once per
// page and shared by the effects layer (render/vfx/library.js) and 设置「官方特效」 (ui/settings.js shows the setting only
// when effects were extracted). The served view answers `{ groups: {} }` on an install without effects; a server
// without the view (an older one, a static host) may answer 404 — both mean "none".

export const FX_LIST_URL = '/data/local-fx.json';

let listPromise = null;

/** The file list (null when absent or unreadable). */
export function loadFxList(fetchFn = globalThis.fetch) {
  if (!listPromise) {
    listPromise = (async () => {
      if (typeof fetchFn !== 'function') return null;
      try {
        const res = await fetchFn(FX_LIST_URL);
        if (!res || !res.ok) return null;
        const j = await res.json();
        return j && typeof j === 'object' ? j : null;
      } catch { return null; }
    })();
  }
  return listPromise;
}

/** True when the file list names effect prefabs. */
export function listHasEffects(list) {
  const g = list && list.groups && list.groups['fx/prefabs'];
  return !!(g && typeof g === 'object' && Object.keys(g).length);
}

/** Resolves to whether effects were extracted (the file list, else the local-art manifest's Phase 1a fx groups). */
export async function fxAvailable(assets) {
  if (listHasEffects(await loadFxList())) return true;
  try {
    const local = assets?.local ? await assets.local() : null;
    return listHasEffects(local);
  } catch { return false; }
}

/** Forget the cached list (tests, a re-extraction while the page is open). */
export function resetFxList() { listPromise = null; }
