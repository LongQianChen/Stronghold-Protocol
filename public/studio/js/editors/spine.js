// public/studio/js/editors/spine.js — the editor of the template 「换 Spine 模型」 (server/studio/templates/spine.js).

import { t } from '../../../../shared/i18n.js';

/** @type {import('./index.js').StudioEditor} */
export default {
  id: 'spine',
  previews: () => ['field'],
  accept: () => '.skel,.atlas,.png',
  multiple: () => true,
  hint: () => t('一次拖入 .skel、.atlas 和贴图 .png（Spine 3.8 二进制导出）；动画（待机、攻击、技能、倒下 …）在打包时自动读出'),
};
