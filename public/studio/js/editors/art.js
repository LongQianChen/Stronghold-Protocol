// public/studio/js/editors/art.js — the editor of the template 「换头像 / 立绘 / 图标」 (server/studio/templates/art.js).

import { t } from '../../../../shared/i18n.js';

/** @type {import('./index.js').StudioEditor} */
export default {
  id: 'art',
  previews: () => ['cards'],
  accept: () => '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
  multiple: () => false,
  hint: (slot) => (slot.field === 'portrait' || slot.field === 'portraitE2' ? t('PNG / JPG / WebP，立绘约 1024 × 1024，人物居中靠上') : t('PNG / JPG / WebP，最好和原图一样大小（头像 180 × 180）')),
};
