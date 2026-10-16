// server/studio/templates/spine.js — the template 「换 Spine 模型」 (server/studio/templates/index.js): an operator's battle
// model (front, and back for one facing up), a summon's or an enemy's. A model is a Spine 3.8 binary skeleton (.skel),
// its atlas (.atlas, the skeleton's name beside it) and the atlas's page pictures (.png); its files go to
// spine/<key>/<front|back>/ — the clips it plays (idle, attack, skill, die …) are read from it when it is packed
// (server/plugins/pack.js), never written by hand.

import { keyDir, nestEntry } from './art.js';

/** @type {import('./index.js').StudioTemplate} */
export default {
  id: 'spine',
  class: 'cosmetic',
  kinds: ['operator', 'token', 'enemy'],
  slots(target) {
    if (!target) return [];
    const dir = `spine/${keyDir(target.key)}`;
    if (target.kind === 'operator') {
      return ['front', 'back'].map((side) => ({ at: [...target.container, target.key, 'spine', side], kind: 'spine', field: side, dir: `${dir}/${side}`, base: keyDir(target.key) }));
    }
    if (target.kind === 'token' || target.kind === 'enemy') return [{ at: [...target.container, target.key, 'spine'], kind: 'spine', field: 'spine', dir, base: keyDir(target.key) }];
    return [];
  },
  overlay(target) {
    return target ? nestEntry(target.container, target.key, {}) : {};
  },
};
