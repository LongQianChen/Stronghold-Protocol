// server/studio/templates/audio.js — the template 「换音乐 / 音效」 (server/studio/templates/index.js): a music track (the
// lobby, preparation, battle, joint defence or Final Assault music, a leader's own music — a loop and an optional intro
// played once before it, replaced as a whole), an interface or battle sound, or the sounds of one unit (attack, hit,
// skill, death, deployment). Its files go to music/<key>/, sound/<group>/<key>/ or sound/units/<key>/.

import { keyDir, nestEntry } from './art.js';

/** A unit's own sounds (audio.sfx.units[id]). */
const UNIT_SOUNDS = ['attack', 'hit', 'skill', 'die', 'born'];

/** @type {import('./index.js').StudioTemplate} */
export default {
  id: 'audio',
  class: 'cosmetic',
  kinds: ['music', 'sound', 'operator', 'token', 'enemy'],
  slots(target) {
    if (!target) return [];
    if (target.kind === 'music') return [{ at: [...target.container, target.key], kind: 'track', field: 'track', dir: `music/${keyDir(target.key)}`, base: 'loop' }];
    if (target.kind === 'sound') return [{ at: [...target.container, target.key], kind: 'audio', field: 'sound', dir: `sound/${target.group || 'ui'}/${keyDir(target.key)}`, base: keyDir(target.key) }];
    if (['operator', 'token', 'enemy'].includes(target.kind)) {
      return UNIT_SOUNDS.map((field) => ({ at: ['audio', 'sfx', 'units', target.key, field], kind: 'audio', field, dir: `sound/units/${keyDir(target.key)}`, base: field }));
    }
    return [];
  },
  overlay(target) {
    if (!target) return {};
    if (['operator', 'token', 'enemy'].includes(target.kind)) return nestEntry(['audio', 'sfx', 'units'], target.key, {});
    // a track or a sound is written once a file fills it
    return nestEntry(target.container, null, null);
  },
};
