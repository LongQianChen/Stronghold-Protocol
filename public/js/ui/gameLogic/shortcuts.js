// ui/gameLogic/shortcuts.js — in-match keyboard shortcuts and the player's key map (Settings > Shortcuts,
// community request, 2026-10-07). Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';


// ---- the key map ------------------------------------------------------------------------------------------------

/** The rebindable shortcuts in the settings' order (the ready key also pauses / resumes a solo battle). Esc is fixed. */
export const HOTKEY_ACTIONS = Object.freeze(['buy', 'refresh', 'freeze', 'levelUp', 'retreat', 'sell', 'ready']);

/** Default key of each action (a KeyboardEvent.code), including W to buy the hovered shop card. */
export const DEFAULT_HOTKEYS = Object.freeze({ buy: 'KeyW', refresh: 'KeyR', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space' });

// The keys a shortcut may use → the `key` value each types on a US layout (lower case): letters, digits, Space, the
// punctuation keys, and six named keys whose `key` equals their `code`. Everything else stays with the interface: Esc
// (closes; cancels a rebind), Tab / Enter / the arrows (focus, buttons, the facing wheel, lists), F1–F12 (the browser's),
// the modifiers.
const KEY_OF = new Map([
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => [`Key${c}`, c.toLowerCase()]),
  ...[...'0123456789'].map((c) => [`Digit${c}`, c]),
  ['Space', ' '], ['Backquote', '`'], ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'],
  ['Backslash', '\\'], ['Semicolon', ';'], ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/'],
  ...['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].map((k) => [k, k]),
]);
const CODE_OF = new Map([...KEY_OF].map(([code, key]) => [key, code]));

/** A key press's `key`, lower case when it is one character ('' when absent). */
const keyValue = (e) => {
  const k = e?.key;
  return typeof k !== 'string' ? '' : k.length === 1 ? k.toLowerCase() : k;
};

/**
 * Whether a KeyboardEvent.code may be a shortcut's key.
 * @param {any} code
 * @returns {boolean}
 */
export const isBindableCode = (code) => typeof code === 'string' && KEY_OF.has(code);

/**
 * The label a key is shown with ('KeyQ' → 'Q', 'Digit1' → '1', 'Comma' → ',', 'Space', 'Delete'); '' for any other code.
 * @param {any} code
 */
export function hotkeyLabel(code) {
  if (!isBindableCode(code)) return '';
  if (code === 'Space') return 'Space';
  const k = KEY_OF.get(code);
  return k.length === 1 ? k.toUpperCase() : k;
}

/**
 * Sanitize a persisted key map: each action keeps a saved key that may be a shortcut, else gets its default; a map in
 * which two saved actions would share a key is bad data — the defaults instead. Legacy maps receive an unused buy key.
 * @param {any} raw
 * @returns {Record<'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string>}
 */
export function sanitizeHotkeys(raw) {
  const r = isObj(raw) && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const a of HOTKEY_ACTIONS) out[a] = Object.hasOwn(r, a) && isBindableCode(r[a]) ? r[a] : DEFAULT_HOTKEYS[a];
  // Older profiles have no buy binding. If W is already assigned, preserve their keys and give buy
  // the first free default key; explicit conflicting bindings still fall back to the defaults.
  if (!Object.hasOwn(r, 'buy')) {
    const used = new Set(HOTKEY_ACTIONS.filter((a) => a !== 'buy').map((a) => out[a]));
    out.buy = Object.values(DEFAULT_HOTKEYS).find((code) => !used.has(code));
  }
  return new Set(Object.values(out)).size === HOTKEY_ACTIONS.length ? out : { ...DEFAULT_HOTKEYS };
}

/**
 * Bind `action` to `code`. A key another action holds is swapped, never shared: that action takes the old key of
 * `action`, so every action keeps exactly one key and no key does two things.
 * @param {any} keys the current map
 * @param {string} action
 * @param {string} code
 * @returns {{ keys: Record<string, string>, changed: boolean, swapped: string|null }} swapped: the action that took the old key
 */
export function rebindHotkey(keys, action, code) {
  const cur = sanitizeHotkeys(keys);
  if (!HOTKEY_ACTIONS.includes(action) || !isBindableCode(code) || cur[action] === code) return { keys: cur, changed: false, swapped: null };
  const swapped = HOTKEY_ACTIONS.find((a) => cur[a] === code) ?? null;
  const next = { ...cur, [action]: code };
  if (swapped) next[swapped] = cur[action];
  return { keys: next, changed: true, swapped };
}

/** Whether a map is the default one. @param {any} keys */
export const isDefaultHotkeys = (keys) => {
  const k = sanitizeHotkeys(keys);
  return HOTKEY_ACTIONS.every((a) => k[a] === DEFAULT_HOTKEYS[a]);
};

/**
 * The bindable key a key press names: the character typed — the label on the player's keycap (AZERTY, Dvorak) — else
 * the physical key (a non-Latin layout, an IME, Shift + a digit); null when neither may be a shortcut.
 * @param {{ key?: string, code?: string }} e
 * @returns {string|null}
 */
export function hotkeyOf(e) {
  const typed = CODE_OF.get(keyValue(e));
  if (typed) return typed;
  return isBindableCode(e?.code) ? e.code : null;
}

/**
 * The one lookup of every shortcut handler: the action a key press triggers under the key map — the action bound to the
 * character typed, else the one bound to the physical key (as the fixed keys of 0.1.4 matched `code === 'KeyR' ||
 * key === 'r'`: a Russian layout or an IME still works by position). No modifier or focus checks (shortcutFor).
 * @param {{ key?: string, code?: string }} e
 * @param {any} [keys] the player's map (settings `keys`); the defaults when omitted
 * @returns {'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|null}
 */
export function actionForKey(e, keys = DEFAULT_HOTKEYS) {
  const map = keys === DEFAULT_HOTKEYS ? keys : sanitizeHotkeys(keys);
  const find = (code) => (code ? HOTKEY_ACTIONS.find((a) => map[a] === code) ?? null : null);
  return find(CODE_OF.get(keyValue(e))) ?? find(typeof e?.code === 'string' ? e.code : null);
}

// keys that only modify another (pressed alone while the settings wait for a key: ignored)
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock',
  'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);

/**
 * What a key press does while the settings wait for a new key: Esc cancels (the dialog stays open), Tab leaves (the focus
 * moves on), a lone modifier or an auto-repeat is ignored, a key held with Ctrl / ⌘ / Alt or one the interface keeps is
 * refused (the wait goes on), any other key is the new key.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean }} e
 * @returns {{ kind: 'cancel'|'leave'|'ignore' } | { kind: 'refuse', reason: 'modifier'|'reserved', name: string } | { kind: 'key', code: string }}
 */
export function captureHotkey(e) {
  const key = typeof e?.key === 'string' ? e.key : '';
  if (key === 'Escape') return { kind: 'cancel' };
  if (key === 'Tab') return { kind: 'leave' };
  if (!e || e.repeat || MODIFIER_KEYS.has(key)) return { kind: 'ignore' };
  const name = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key || e.code || '?';
  if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'refuse', reason: 'modifier', name };
  const code = hotkeyOf(e);
  return code ? { kind: 'key', code } : { kind: 'refuse', reason: 'reserved', name };
}


// ---- keyboard ---------------------------------------------------------------------------------------------------

/**
 * Map a keydown to a game shortcut under the player's key map (defaults: R refresh, F freeze, D level-up, Q retreat,
 * X sell, W buy, Space ready) or Esc (close; fixed). A shortcut key means its action even while a HUD button has focus (a
 * mouse click leaves the shop card / refresh button focused, and Space must not re-trigger it); the caller prevents the button's
 * own activation. Enter still activates buttons (it cannot be a shortcut; behind the facing wheel only its ✕:
 * facingEnter). Nothing while Ctrl / ⌘ / Alt is held or a text field has the focus.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean, target?: any }} e
 * @param {any} [keys] the player's map (settings `keys`)
 * @returns {'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null}
 */
export function shortcutFor(e, keys = DEFAULT_HOTKEYS) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  const tag = t && typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return null;
  if (e.key === 'Escape') return 'escape';
  if (e.repeat) return null;
  return actionForKey(e, keys);
}

/**
 * Whether the facing wheel swallows a key press: no ready / shop action while a facing is chosen — Space (a focused
 * button must not activate either) and every key bound to a shortcut.
 * @param {{ key?: string, code?: string }} e
 * @param {any} [keys] the player's map
 */
export const facingSwallows = (e, keys = DEFAULT_HOTKEYS) => e?.key === ' ' || actionForKey(e, keys) != null;

// what a focused element is when Enter would activate it (a button, a link, a form field, an ARIA control)
const CONTROL = 'button, a[href], input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], '
  + '[role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';

/**
 * What Enter does while the facing wheel is open (GitHub #394, PR #395): on the wheel's own ✕ button it cancels; on
 * any other control (ready, refresh, settings, guide, a shop card — Tab reaches them behind the wheel) nothing happens — the
 * wheel holds the keyboard as it holds Space and the shortcuts; with the focus anywhere else (the wheel itself, the
 * page) it confirms the previewed direction, and does nothing while none is previewed. null: not Enter.
 * @param {{ key?: string, target?: any }} e @param {boolean} chosen a direction is previewed
 * @returns {'cancel'|'commit'|'swallow'|null}
 */
export function facingEnter(e, chosen) {
  if (e?.key !== 'Enter') return null;
  const t = e.target;
  const closest = (sel) => (t && typeof t.closest === 'function' ? t.closest(sel) : null);
  if (closest('.fwheel__cancel')) return 'cancel';
  if (closest(CONTROL)) return 'swallow';
  return chosen ? 'commit' : 'swallow';
}

/**
 * Whether a press on the field closes the open detail card: a card opened from the field itself (an own piece — tap,
 * right-click or long press — or a battle / teammate unit). Shop, reward, bond-member and intel (enemy) cards stay.
 * @param {{ kind?: string }|null|undefined} detail
 */
// a card opened BY a field press (a piece, a unit, a special terrain tile: issue #184, a stage device: #228) closes on the
// next press of the field; the ones opened from the shop / hand / HUD stay until their own close button (or the flow that
// opened them)
export const closesOnFieldPress = (detail) => detail?.kind === 'piece' || detail?.kind === 'unit' || detail?.kind === 'terrain' || detail?.kind === 'device';

/**
 * Whether an open overlay swallows a game shortcut: a modal / the guide own the keyboard (Esc included — they close
 * themselves); the match-info / enemy-intel drawer is a dialog too — only Esc (it closes the drawer) passes, the other
 * shortcuts never act behind it.
 * @param {'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null} act shortcutFor
 * @param {{ modal?: boolean, drawer?: boolean }} open
 */
export function shortcutBlocked(act, { modal = false, drawer = false } = {}) {
  if (!act) return true;
  if (modal) return true;
  return !!drawer && act !== 'escape';
}

/**
 * Prep shortcuts (buy, refresh, freeze, level-up, retreat, sell, ready) stay idle for a spectator, an eliminated
 * player, someone watching another board, or a seat on AI autopilot (local 暂离 or the server's autoplay). Esc, and
 * a living solo player's battle pause, are the caller's and are not decided here. A missing flag is not that state.
 * @param {{ spectator?: boolean, alive?: boolean, watchingOther?: boolean, away?: boolean, autoplay?: boolean }|null|undefined} s
 * @returns {boolean}
 */
export function prepShortcutsSuspended(s) {
  if (!s || typeof s !== 'object') return false;
  return s.spectator === true || s.alive === false || s.watchingOther === true || s.away === true || s.autoplay === true;
}
