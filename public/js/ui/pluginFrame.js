// ui/pluginFrame.js — the host side of an interface plugin (DESIGN §32.8, shared/plugins/ui.js).
// Imported for its effect from screens/game.js (the match already loads the battle runner). It does not import the
// art compositor, the plugin panel or the asset store. With no interface plugin switched on, and on a server that
// reports none, it does not ask for the catalogue.
//
// Each switched-on plugin is one <iframe sandbox="allow-scripts"> (no allow-same-origin: an opaque origin, so it has
// no site storage and no credentials). The same `sandbox allow-scripts` is on the /p/ response (UI_FRAME_CSP), because
// the attribute is not there when the URL is opened at the top level. The parent posts with targetOrigin '*' because
// that origin is the string "null" — 'null' does not tell the entry document from a later opaque one.
// Loads: 1 is the entry (the iframe points straight at it), 2+ destroys the frame and stops the feed. A message is applied on
// the next turn so a load event already queued runs first. A message is accepted only from that iframe's window,
// and only when event.origin is "null".
// The iframe is parked on #sp-ui-park until its slot element exists, then moved into [data-ui-slot]. The slot div
// opts out of Preact's children (dangerouslySetInnerHTML) so a re-render does not drop the frame; if a screen
// unmounts the slot, the frame is moved back to the park in the same mutation.
//
// [ASSUMED] the first declared slot that has an element is granted when the frame is created, otherwise the first
// free declared slot, so the frame has a home before its own `slot` message. One slot per plugin, one plugin per slot.
// Nothing here calls net.send. A match intent is rejected locally.

import { store } from '../store.js';
import { battleRunner } from '../battle/runner.js';
import { catalog, loadCatalog, installedCount, pluginName } from '../content.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { uiPlugins, uiPluginEntries } from './uiPlugins.js';
import {
  UI_ERRORS, UI_LIMITS, UI_SLOTS, battlePayload, checkStorageWrite, clampHeight, clampNotice, createNoticeLimiter,
  createRateLimiter, createSlotTable, frameLoadDecision, framePageUrl, hostLimit, hostRejected, hostState, hostWelcome,
  namespacedStorageKey, validatePluginMessage,
} from '../../../shared/plugins/ui.js';

const SLOT_MS = Math.round(1000 / UI_LIMITS.battleHz);
const STATE_MS = 250;
const LIMIT_MS = 2000;

/** @type {Map<string, FrameRec>} */
const frames = new Map();
/** Plugins stopped for leaving their entry page: not mounted again until this page reloads (no re-mount loop). */
const blocked = new Set();
const slots = createSlotTable();
const limiter = createRateLimiter();
const noticeLimiter = createNoticeLimiter();
const rejected = [];
/** @type {{ last: object | null, rejected: string[], debugBattle: (events: unknown) => void, frames: () => string[] }} */
const api = {
  blocked: () => [...blocked],
  rejected,
  last: null,
  frames: () => [...frames.keys()],
  debugBattle(events) {
    const msg = battlePayload({ fieldId: 'debug', gt: 0, events, snap: null });
    api.last = msg;
    for (const rec of frames.values()) post(rec, msg);
  },
};

/**
 * @typedef {{ id: string, iframe: HTMLIFrameElement, declared: string[], entry: any, ready: boolean,
 *   preview?: any, entries: Record<string, string>, limitAt: number, loads: number, closed: boolean }} FrameRec
 */

let park = null;
let booted = false;
let stateTimer = 0;
let lastState = '';
let battleTimer = 0;
/** @type {unknown[]} */
let battleQueue = [];
let battleField = null;
let battleGt = null;
let lastSnap = null;

function parkEl() {
  if (park && park.isConnected) return park;
  park = document.createElement('div');
  park.id = 'sp-ui-park';
  park.hidden = true;
  park.setAttribute('aria-hidden', 'true');
  document.body.appendChild(park);
  return park;
}

/** @param {FrameRec} rec @param {object} msg */
/** Private feed only while the entry document is the one that finished loading. */
function feeding(rec) {
  return !rec.closed && frames.get(rec.id) === rec && rec.ready && frameLoadDecision(rec.loads) === 'entry';
}

function post(rec, msg) {
  if (rec.closed || frames.get(rec.id) !== rec) return;
  const w = rec.iframe.contentWindow;
  if (!w) return;
  try {
    w.postMessage(msg, '*');
    api.last = msg;
  } catch { /* the frame is gone */ }
}

/** @param {string} id */
function destroy(id) {
  const rec = frames.get(id);
  if (!rec) return;
  rec.closed = true;
  rec.ready = false;
  frames.delete(id);
  slots.release(id);
  limiter.reset(id);
  noticeLimiter.reset(id);
  rec.iframe.remove();
}

/** A frame left its entry document: destroy it and keep the plugin off for the rest of this page. @param {string} id */
function stopForLeaving(id) {
  if (!frames.has(id)) return;
  blocked.add(id);
  destroy(id);
  try { toast(t('界面插件离开了自己的页面，本页已停用它（刷新后恢复）'), 'warn'); } catch { /* the toast host may be absent */ }
}

function destroyAll() {
  for (const id of [...frames.keys()]) destroy(id);
}

/**
 * A slot that left the document took its frame with it. Move that frame back to the park.
 * A frame we just moved ourselves is still connected, so it is left where it is (moving it again would loop).
 * @param {Node} node
 * @returns {boolean}
 */
function rescue(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = /** @type {Element} */ (node);
  if (el.isConnected) return false;
  const frame = el.classList && el.classList.contains('ui-slot__frame') ? el : (el.querySelector ? el.querySelector('.ui-slot__frame') : null);
  if (!frame || frame.isConnected) return false;
  // only a live frame is re-parked: a destroyed one (no record any more) stays removed instead of coming back as an
  // orphan that reloads the plugin's page
  const rec = frames.get(/** @type {HTMLElement} */ (frame).dataset.plugin || '');
  if (!rec || rec.iframe !== frame || rec.closed) return false;
  moveFrame(rec, parkEl());
  return true;
}

/**
 * The host moves a frame. A browser reloads an iframe that changes parent, from its `src` — the entry — so the load
 * count and the handshake start over (the plugin answers the new `welcome` with a new `ready`). A navigation the
 * plugin starts itself still counts past the entry and destroys the frame.
 * @param {FrameRec} rec @param {Element} home
 */
function moveFrame(rec, home) {
  rec.loads = 0;
  rec.ready = false;
  home.appendChild(rec.iframe);
}

/** @param {FrameRec} rec */
function place(rec) {
  const slot = slots.slotOf(rec.id);
  const el = slot ? document.querySelector(`[data-ui-slot="${slot}"]`) : null;
  const home = rec.preview?.host || el || parkEl();
  if (rec.iframe.parentElement !== home) moveFrame(rec, home);
}

function placeAll() {
  for (const rec of frames.values()) place(rec);
}

/**
 * [ASSUMED] grant the first declared slot that currently has an element and is free, else the first free one.
 * @param {string} id @param {string[]} declared
 */
function autoGrant(id, declared) {
  const allowed = declared.filter((s) => UI_SLOTS.includes(s));
  const withEl = allowed.find((s) => document.querySelector(`[data-ui-slot="${s}"]`) && !slots.holder(s));
  const pick = withEl || allowed.find((s) => !slots.holder(s));
  if (!pick) return;
  slots.request(id, pick, allowed);
}

/** @param {any} entry */
function mount(entry, preview = null) {
  const id = entry.id;
  if (frames.has(id) || frames.size >= UI_LIMITS.maxPlugins) return;
  const rel = typeof entry.entry === 'string' ? entry.entry : null;
  const sha = rel && entry.frameFiles && typeof entry.frameFiles[rel] === 'string' ? entry.frameFiles[rel] : null;
  const src = rel && sha ? framePageUrl(id, rel, sha) : null;
  if (!src) return;
  const declared = Array.isArray(entry.slots) ? entry.slots.filter((s) => typeof s === 'string') : [];
  const iframe = document.createElement('iframe');
  iframe.className = 'ui-slot__frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('credentialless', '');
  iframe.setAttribute('allow', '');
  iframe.title = pluginName(entry) || id;
  iframe.dataset.plugin = id;
  /** @type {FrameRec} */
  const rec = { id, iframe, declared, entry, ready: false, preview, entries: preview ? Object.create(null) : loadEntries(id), limitAt: 0, loads: 0, closed: false };
  frames.set(id, rec);
  autoGrant(id, declared);
  iframe.addEventListener('load', () => {
    if (frames.get(id) !== rec || rec.closed) return;
    rec.loads += 1;
    const decision = frameLoadDecision(rec.loads);
    if (decision === 'destroy') { stopForLeaving(id); return; }
    // The entry document. welcome does not include the private view; ready (accepted only at this count) does.
    if (decision === 'entry') post(rec, hostWelcome(id, declared));
  });
  iframe.src = src;
  place(rec);
}

/** @param {string} id @returns {Record<string, string>} */
function loadEntries(id) {
  /** @type {Record<string, string>} */
  const entries = Object.create(null);
  const prefix = `sp.plugin.${id}.`;
  let ls;
  try { ls = globalThis.localStorage; } catch { return entries; }
  if (!ls) return entries;
  try {
    for (let i = 0; i < ls.length; i++) {
      const full = ls.key(i);
      if (!full || !full.startsWith(prefix)) continue;
      const key = full.slice(prefix.length);
      if (!namespacedStorageKey(id, key)) continue;
      const raw = ls.getItem(full);
      if (raw != null) entries[key] = raw;
    }
  } catch { /* privacy mode */ }
  return entries;
}

function scheduleState() {
  if (stateTimer) return;
  stateTimer = window.setTimeout(() => {
    stateTimer = 0;
    const m = store.get().match;
    const msg = hostState(m && m.public, m && m.private);
    let text = '';
    try { text = JSON.stringify(msg); } catch { return; }
    if (text === lastState) return;
    lastState = text;
    for (const rec of frames.values()) if (feeding(rec)) post(rec, msg);
  }, STATE_MS);
}

function flushBattle() {
  battleTimer = 0;
  const events = battleQueue;
  battleQueue = [];
  const msg = battlePayload({ fieldId: battleField, gt: battleGt, events, snap: lastSnap });
  for (const rec of frames.values()) if (feeding(rec)) post(rec, msg);
}

function scheduleBattle() {
  if (battleTimer) return;
  battleTimer = window.setTimeout(flushBattle, SLOT_MS);
}

/** @param {FrameRec} rec */
function noteLimit(rec) {
  const now = Date.now();
  if (now - rec.limitAt < LIMIT_MS) return;
  rec.limitAt = now;
  post(rec, hostLimit('rate'));
  try { toast(t('界面插件发送得太快，请稍后再试'), 'warn'); } catch { /* the toast host may be absent */ }
}

/** @param {FrameRec} rec @param {Record<string, unknown>} msg */
function onStorage(rec, msg) {
  const op = msg.op;
  const key = typeof msg.key === 'string' ? msg.key : '';
  if (op === 'keys') {
    post(rec, { v: 1, t: 'storage', op: 'keys', keys: Object.keys(rec.entries), ok: true });
    return;
  }
  const full = namespacedStorageKey(rec.id, key);
  if (!full) {
    post(rec, { v: 1, t: 'storage', op, key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    return;
  }
  if (op === 'get') {
    const text = rec.entries[key];
    if (text == null) {
      post(rec, { v: 1, t: 'storage', op: 'get', key, value: null, ok: true });
      return;
    }
    try {
      post(rec, { v: 1, t: 'storage', op: 'get', key, value: JSON.parse(text), ok: true });
    } catch {
      post(rec, { v: 1, t: 'storage', op: 'get', key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    }
    return;
  }
  if (op === 'delete') {
    delete rec.entries[key];
    try { if (!rec.preview) globalThis.localStorage?.removeItem(full); } catch { /* ignore */ }
    post(rec, { v: 1, t: 'storage', op: 'delete', key, ok: true });
    return;
  }
  const checked = checkStorageWrite(rec.entries, key, msg.value);
  if (!checked.ok) {
    post(rec, { v: 1, t: 'storage', op: 'set', key, ok: false, error: checked.error });
    return;
  }
  rec.entries[key] = checked.text;
  try { if (!rec.preview) globalThis.localStorage?.setItem(full, checked.text); } catch {
    delete rec.entries[key];
    post(rec, { v: 1, t: 'storage', op: 'set', key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    return;
  }
  post(rec, { v: 1, t: 'storage', op: 'set', key, ok: true });
}

/** @param {FrameRec} rec @param {Record<string, unknown>} msg */
function handle(rec, msg) {
  if (msg.t === 'ready') {
    // Load 1 is the redirect. Load 2 is the entry. A later document must not receive the private view.
    // welcome is posted from the load handler, not from here, so a plugin that answers welcome cannot loop.
    if (frameLoadDecision(rec.loads) !== 'entry') return;
    rec.ready = true;
    const m = rec.preview?.state || store.get().match;
    post(rec, hostState(m && m.public, m && m.private));
    return;
  }
  if (msg.t === 'slot') {
    const r = slots.request(rec.id, /** @type {string} */ (msg.slot), rec.declared);
    post(rec, { v: 1, t: 'slot', slot: msg.slot, ok: r.ok === true, ...(r.ok ? {} : { error: r.error }) });
    if (r.ok) place(rec);
    return;
  }
  if (msg.t === 'resize') {
    const h = clampHeight(/** @type {number} */ (msg.height));
    if (h == null) { post(rec, hostRejected('shape')); return; }
    rec.iframe.style.height = `${h}px`;
    return;
  }
  if (msg.t === 'notice') {
    const text = clampNotice(msg.text);
    if (!text) { post(rec, hostRejected('shape')); return; }
    // A different line waits 2s. The same line still reaches the toast host, which merges it. No toast on the limit
    // itself (the token-bucket warning already has its own 2s debounce).
    if (!noticeLimiter.allow(rec.id, text)) { post(rec, hostLimit('notice')); return; }
    try { toast(text, 'info'); } catch { /* ignore */ }
    return;
  }
  if (msg.t === 'stats') {
    const unitId = /** @type {number} */ (msg.unitId);
    const fieldId = typeof msg.fieldId === 'string' ? msg.fieldId : null;
    let stats = null;
    try {
      stats = rec.preview ? { dmg: 120, heal: 0, taken: 0 } : battleRunner && typeof battleRunner.unitStats === 'function' ? battleRunner.unitStats(unitId, fieldId) : null;
    } catch { stats = null; }
    post(rec, { v: 1, t: 'stats', unitId, fieldId, stats: stats && typeof stats === 'object' ? stats : null });
    return;
  }
  if (msg.t === 'storage') onStorage(rec, msg);
}

function onWindowMessage(ev) {
  let rec = null;
  for (const item of frames.values()) {
    if (item.iframe.contentWindow && item.iframe.contentWindow === ev.source) { rec = item; break; }
  }
  if (!rec) return;
  if (ev.origin !== 'null') return;
  const verdict = validatePluginMessage(ev.data);
  const allowed = limiter.allow(rec.id);
  if (!verdict.ok && verdict.reason === 'intent') {
    if (rejected.length < 50) rejected.push('intent');
    post(rec, hostRejected('intent'));
  }
  if (!allowed) { noteLimit(rec); return; }
  if (!verdict.ok) {
    if (verdict.reason !== 'intent') post(rec, hostRejected(verdict.reason));
    return;
  }
  const msg = verdict.msg;
  // The child's script runs before the parent's load event, and postMessage is queued before that load.
  // Applying the message on the next turn lets a navigation that already queued its load destroy the frame first,
  // so ready on the new document does not pull state. A task that was queued even earlier can still post once
  // (DESIGN §32.8 [ASSUMED]).
  setTimeout(() => {
    if (frames.get(rec.id) !== rec || rec.closed) return;
    if (frameLoadDecision(rec.loads) === 'destroy') { stopForLeaving(rec.id); return; }
    handle(rec, msg);
  }, 0);
}

function sync() {
  const ids = uiPlugins.get().ids;
  if (!ids.length) { destroyAll(); return; }
  if (!installedCount(store.get())) return;
  const cat = catalog.get();
  if (cat.status !== 'ready') {
    if (cat.status !== 'loading') loadCatalog();
    return;
  }
  const entries = uiPluginEntries(cat.plugins);
  const want = [];
  for (const id of ids) {
    if (want.length >= UI_LIMITS.maxPlugins) break;
    if (blocked.has(id)) continue;
    if (entries.some((p) => p.id === id)) want.push(id);
  }
  const keep = new Set(want);
  for (const id of [...frames.keys()]) if (!keep.has(id)) destroy(id);
  for (const id of want) {
    if (!frames.has(id)) mount(entries.find((p) => p.id === id));
  }
  placeAll();
}

function boot() {
  if (booted || typeof window === 'undefined' || typeof document === 'undefined') return;
  booted = true;
  globalThis.__SP_UI_PLUGINS__ = api;
  window.addEventListener('message', onWindowMessage);
  const obs = new MutationObserver((records) => {
    let changed = false;
    for (const rec of records) {
      for (const node of rec.removedNodes) if (rescue(node)) changed = true;
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = /** @type {Element} */ (node);
        if ((el.getAttribute && el.getAttribute('data-ui-slot')) || (el.querySelector && el.querySelector('[data-ui-slot]'))) changed = true;
      }
    }
    if (changed) placeAll();
  });
  const arm = () => {
    if (!document.body) return;
    parkEl();
    obs.observe(document.body, { childList: true, subtree: true });
    sync();
  };
  if (document.body) arm();
  else document.addEventListener('DOMContentLoaded', arm, { once: true });
  uiPlugins.subscribe(() => sync());
  catalog.subscribe(() => sync());
  store.subscribe((s, prev) => {
    if (!prev || s.installedPlugins !== prev.installedPlugins) sync();
    if (!prev || s.match !== prev.match) scheduleState();
  });
  if (battleRunner && typeof battleRunner.on === 'function') {
    battleRunner.on('ev', (payload) => {
      const list = payload && Array.isArray(payload.ev) ? payload.ev : [];
      for (const ev of list) battleQueue.push(ev);
      while (battleQueue.length > UI_LIMITS.battleBatch) battleQueue.shift();
      if (payload && typeof payload.fieldId === 'string') battleField = payload.fieldId;
      if (payload && typeof payload.gt === 'number') battleGt = payload.gt;
      scheduleBattle();
    });
    battleRunner.on('snap', (frame) => {
      lastSnap = frame;
      if (frame && typeof frame.fieldId === 'string') battleField = frame.fieldId;
      if (frame && typeof frame.gt === 'number') battleGt = frame.gt;
      scheduleBattle();
    });
  }
}

/** Studio preview through the exact game host. [ASSUMED] Only fake state and volatile storage; never gameplay data. */
export function mountPluginPreview(entry, host) {
  if (!host || !entry || entry.class !== 'ui') return null;
  destroy(entry.id);
  const preview = { host, state: { public: { phase: 'COMBAT', round: 1, players: [] }, private: { playerId: 'preview', funds: 10 } } };
  mount(entry, preview);
  const rec = frames.get(entry.id);
  if (!rec) return null;
  let gt = 0;
  const timer = setInterval(() => {
    if (!feeding(rec)) return;
    gt += 1;
    post(rec, battlePayload({ fieldId: 'preview', gt, events: [['dmg', 1, 120, 'phys']], snap: null }));
  }, 1000);
  return { close() { clearInterval(timer); if (frames.get(entry.id) === rec) destroy(entry.id); } };
}

boot();
