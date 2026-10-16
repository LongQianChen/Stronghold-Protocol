// render/vfx/tier.js — 设置「官方特效」 (settings `officialFx`): 'auto' | 'off' | 'lite' | 'full' → the tier the
// official battle effects run at. 'auto' (the default) is 完整 on a desktop and 精简 on a touch device; nothing runs
// when no effects were extracted from the local client (the setting is hidden then, ui/settings.js).

export const OFFICIAL_FX = Object.freeze(['auto', 'off', 'lite', 'full']);

/** A touch-first device (coarse pointer, no fine one): the light tier by default. */
export function touchDevice() {
  try {
    const mm = globalThis.matchMedia;
    if (typeof mm !== 'function') return false;
    return mm('(pointer: coarse)').matches && !mm('(any-pointer: fine)').matches;
  } catch { return false; }
}

/** The effective tier of a setting value ('off' | 'lite' | 'full'). */
export function resolveOfficialFx(value, available = true, touch = touchDevice()) {
  if (!available) return 'off';
  if (value === 'off' || value === 'lite' || value === 'full') return value;
  return touch ? 'lite' : 'full';
}
