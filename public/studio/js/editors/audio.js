// public/studio/js/editors/audio.js — the editor of the template 「换音乐 / 音效」 (server/studio/templates/audio.js).

import { t } from '../../../../shared/i18n.js';

/** @type {import('./index.js').StudioEditor} */
export default {
  id: 'audio',
  previews: () => ['sound'],
  accept: () => '.mp3,.ogg,audio/mpeg,audio/ogg',
  multiple: () => false,
  hint: (slot) => (slot.kind === 'track' ? t('.mp3 或 .ogg：循环播放的部分；前奏（只播一次）另外放') : t('.mp3 或 .ogg')),
};
