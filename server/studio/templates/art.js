// server/studio/templates/art.js — the template 「换头像 / 立绘 / 图标」 (server/studio/templates/index.js): pictures of an
// operator (avatar, E2 avatar, portrait, E2 portrait), a summon's avatar, an enemy's icon, and the icon of an item, a
// bond, a strategy or an interface picture — every image place of a cosmetic plugin's overlay (shared/plugins/visual.js
// ASSET_CONTAINERS). Its files go to art/<key>/<field>.<ext>.

/** @type {Record<string, string[]>} an operator's / summon's / enemy's picture fields */
const FIELDS = { operator: ['avatar', 'avatarE2', 'portrait', 'portraitE2'], token: ['avatar'], enemy: ['icon'] };
/** The kinds whose entry is the picture itself (a record of one image). */
const WHOLE = ['item', 'bond', 'band', 'ui'];

/** A folder name for a key ('group/key' of an interface picture → 'group_key'). @param {string} key */
export const keyDir = (key) => String(key).replace(/[^A-Za-z0-9._-]+/g, '_');

/** @type {import('./index.js').StudioTemplate} */
export default {
  id: 'art',
  class: 'cosmetic',
  kinds: ['operator', 'token', 'enemy', 'item', 'bond', 'band', 'ui'],
  slots(target) {
    if (!target) return [];
    const dir = `art/${keyDir(target.key)}`;
    if (FIELDS[target.kind]) return FIELDS[target.kind].map((field) => ({ at: [...target.container, target.key, field], kind: 'image', field, dir, base: field }));
    if (WHOLE.includes(target.kind)) return [{ at: [...target.container, target.key], kind: 'image', field: 'icon', dir, base: 'icon' }];
    return [];
  },
  overlay(target) {
    if (!target) return {};
    // a record of fields gets its (empty) entry; a picture-only entry is written once a file fills it
    return FIELDS[target.kind] ? nestEntry(target.container, target.key, {}) : nestEntry(target.container, null, null);
  },
};

/** `{ c1: { c2: { [key]: value } } }`, or the containers alone (key null). */
export function nestEntry(container, key, value) {
  const out = {};
  let node = out;
  container.forEach((k, i) => { node = node[k] = (i === container.length - 1 && key !== null ? { [key]: value } : {}); });
  return out;
}
