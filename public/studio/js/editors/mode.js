import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { get } from '../api.js';
import { Select, NumberField } from './controls.js';
export function ModeEditor({ draft, onChange }) {
  const [modes, setModes] = useState([]);
  useEffect(() => { let alive = true; get('authoring?template=mode').then(r => { if (alive) setModes(r.modes); }); return () => { alive = false; }; }, []);
  const o = draft.options;
  const change = patch => onChange({ ...draft, options: { ...o, ...patch } });
  return html`<div class="st-form">
    <${Select} label=${t('原版模式')} value=${o.base || 'mode_single_normal'} options=${modes} onChange=${base => change({ base })} />
    <${NumberField} label=${t('每回合基础收入')} min=${0} max=${120} step=${1} value=${o.incomePerRound ?? 12} onChange=${incomePerRound => change({ incomePerRound })} />
    <${NumberField} label=${t('刷新价格')} min=${0} max=${64} step=${1} value=${o.refreshPrice ?? 0} onChange=${refreshPrice => change({ refreshPrice })} />
    <${NumberField} label=${t('战前确认时长（秒）')} min=${1} max=${600} step=${1} value=${o.infoCheck ?? 10} onChange=${infoCheck => change({ infoCheck })} />
    <${NumberField} label=${t('准备时长（秒）')} min=${1} max=${600} step=${1} value=${o.prepTime ?? 60} onChange=${prepTime => change({ prepTime })} />
    <${NumberField} label=${t('初始部署费用')} min=${0} max=${99} step=${1} value=${o.dpInit ?? 10} onChange=${dpInit => change({ dpInit })} />
    <p class="st-note">${t('未修改的字段继承原版模式。')}</p>
  </div>`;
}
export default { id: 'mode', Component: ModeEditor };
