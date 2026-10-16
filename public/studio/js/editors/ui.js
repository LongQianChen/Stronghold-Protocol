import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { Select, TextField } from './controls.js';
export function UiEditor({ draft, onChange, state }) {
  const host = useRef(null);
  const [failed, setFailed] = useState(false);
  const o = draft.options;
  useEffect(() => {
    let alive = true, preview = null;
    const entry = state.frame;
    if (!entry?.frameFiles) return undefined;
    import('../../../js/ui/pluginFrame.js').then(({ mountPluginPreview }) => {
      if (!alive) return;
      preview = mountPluginPreview(entry, host.current);
      if (!preview) setFailed(true);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; preview?.close(); };
  }, [state.vs, state.text]);
  return html`<div class="st-form">
    <${Select} label=${t('界面插槽')} value=${o.slot || state.manifest.slots?.[0] || 'hud.right'} options=${['hud.right','result.tab','stats.tab','room.panel']} onChange=${slot => onChange({ ...draft, options: { ...o, slot } })} />
    <${TextField} label=${t('标题')} value=${o.title || ''} onChange=${title => onChange({ ...draft, options: { ...o, title } })} />
    <p class="st-note">${t('保存后更新沙箱预览；下面只使用演示数据。')}</p>
    <div class="st-ui-preview" data-testid="ui-sandbox-preview" ref=${host} dangerouslySetInnerHTML=${{ __html: '' }} />
    ${failed ? html`<p class="st-error">${t('预览未能启动')}</p>` : null}
  </div>`;
}
export default { id: 'ui', Component: UiEditor };
