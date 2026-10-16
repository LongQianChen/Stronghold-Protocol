// A number <input> that is not a controlled value (the room panel's plugin settings, the studio's NumberField).
// While a number is typed the browser reports '' for a partial entry such as "0." or "-" (validity.badInput); writing
// the value back then wipes the entry, and Chrome puts the caret at the start, so typing 0.75 left 750 in the box.
// The box follows its value only while it is not focused, and once more when it loses focus.

/**
 * Show `value` in `el` unless the user is typing in it (`force`: on blur). A value that is not a finite number clears it.
 * @param {HTMLInputElement|null} el
 * @param {unknown} value
 * @param {boolean} [force]
 */
export function syncNumberInput(el, value, force = false) {
  if (!el || (!force && el.ownerDocument?.activeElement === el)) return;
  const want = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const has = el.value === '' ? null : Number(el.value);
  if (el.validity?.badInput || has !== want) el.value = want == null ? '' : String(want);
}

/**
 * The number an input event leaves in `el`: undefined while the entry is partial, null when the box is empty.
 * @param {HTMLInputElement} el
 * @returns {number|null|undefined}
 */
export function inputNumber(el) {
  if (el.validity?.badInput) return undefined;
  return el.value === '' ? null : Number(el.value);
}
