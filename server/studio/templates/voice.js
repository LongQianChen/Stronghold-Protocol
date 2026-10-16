// server/studio/templates/voice.js — the template 「换语音」 (server/studio/templates/index.js): an operator's battle lines,
// one place per line the installation has for it (audio.voice[charId] — 部署, 选中, 技能 …; the Japanese dub
// audio.voiceJp too), each a sound or a list of 1–16 played in turn (shared/plugins/visual.js). Its files go to
// voice/<charId>/<cn|jp>/<line>.<ext>.

import { keyDir, nestEntry } from './art.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @type {import('./index.js').StudioTemplate} */
export default {
  id: 'voice',
  class: 'cosmetic',
  kinds: ['operator'],
  slots(target, manifest) {
    if (!target || target.kind !== 'operator') return [];
    const out = [];
    for (const [book, dub] of [['voice', 'cn'], ['voiceJp', 'jp']]) {
      const lines = manifest?.audio?.[book]?.[target.key];
      // the installation's lines of this operator (a new operator of the installation: the usual battle lines)
      const keys = isObj(lines) ? Object.keys(lines) : book === 'voice' ? ['start', 'select', 'place', 'skill1', 'skill2', 'skill3', 'die'] : [];
      for (const line of keys) out.push({ at: ['audio', book, target.key, line], kind: 'audioList', field: `${book}.${line}`, dir: `voice/${keyDir(target.key)}/${dub}`, base: line });
    }
    return out;
  },
  overlay(target) {
    return target ? nestEntry(['audio', 'voice'], target.key, {}) : {};
  },
};
