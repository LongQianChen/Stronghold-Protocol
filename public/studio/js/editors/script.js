import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
export function ScriptEditor({ state }) {
  return html`<div class="st-form"><p>${t('请用编辑器打开插件文件夹；浏览器只读展示代码。')}</p>
    <code>plugins/${state.id}/</code><p class="st-note">${t('生成的 test/ 文件可用 tools/plugin.mjs test 运行。脚本执行仍需服主开关与哈希许可。')}</p>
    <pre class="st-code st-source" data-testid="script-source">${state.source?.text || ''}</pre>
  </div>`;
}
export default { id: 'script', Component: ScriptEditor };
