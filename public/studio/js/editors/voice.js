// public/studio/js/editors/voice.js — the editor of the template 「换语音」 (server/studio/templates/voice.js).

import { t } from '../../../../shared/i18n.js';

/** @type {import('./index.js').StudioEditor} */
export default {
  id: 'voice',
  previews: () => ['sound'],
  accept: () => '.mp3,.ogg,audio/mpeg,audio/ogg',
  multiple: () => true,
  hint: () => t('.mp3 或 .ogg；一次放几个，就轮流播放'),
};
