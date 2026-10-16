import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { get } from '../api.js';
import { TargetPicker } from '../picker.js';
import { Field, NumberField, TextField, Select, fieldLabel } from './controls.js';
import { DslForm } from './dslForm.js';

export function OperatorEditor({ draft, onChange }) {
  const o = draft.options;
  const [details, setDetails] = useState(null);
  const [specText, setSpecText] = useState(JSON.stringify(o.spec || { kind: 'duration', duration: 10, mods: { atkPct: 0.5 } }, null, 2));
  const [badJson, setBadJson] = useState(false);
  const change = patch => onChange({ ...draft, options: { ...o, ...patch } });
  useEffect(() => {
    let alive = true;
    get(`authoring?template=operator&target=${encodeURIComponent(o.kitRef ? `operator:${o.kitRef}` : draft.target || '')}`).then(r => { if (alive) setDetails(r); });
    return () => { alive = false; };
  }, [draft.target, o.kitRef]);
  const rec = details?.source?.normal;
  const kind = o.kitSource || 'ref';
  return html`<div class="st-form" data-testid="operator-wizard">
    <${TextField} label=${t('干员名字')} value=${o.operatorName || ''} onChange=${operatorName => change({ operatorName })} />
    <${Select} label=${t('职业')} value=${o.profession || rec?.profession || 'PIONEER'} options=${['PIONEER','WARRIOR','TANK','SNIPER','CASTER','MEDIC','SUPPORT','SPECIAL']} onChange=${profession => change({ profession, subProfessionId: details?.branches?.find(b => b.profession === profession)?.id || rec?.subProfessionId, position: ['SNIPER','CASTER','MEDIC','SUPPORT'].includes(profession) ? 'RANGED' : 'MELEE' })} />
    <${Select} label=${t('分支')} value=${o.subProfessionId || rec?.subProfessionId || ''} options=${(details?.branches || []).filter(b => b.profession === (o.profession || rec?.profession))} onChange=${subProfessionId => change({ subProfessionId })} />
    <${NumberField} label=${t('稀有度')} value=${o.rarity ?? rec?.rarity ?? 5} min=${1} max=${6} step=${1} onChange=${rarity => change({ rarity })} />
    <${NumberField} label=${t('商店阶级')} value=${o.tier ?? rec?.tier ?? 1} min=${1} max=${6} step=${1} onChange=${tier => change({ tier })} />
    <p class="st-note">${t('自动生成命名空间 id，以及普通卡 _a 和精锐卡 _b。')}</p>
    ${['normal','elite'].map(form => html`<details open=${form === 'normal'}><summary>${form === 'normal' ? t('普通') : t('精锐（精英二）')}</summary><div class="st-stat-grid">
      ${['maxHp','atk','def','res','cost','bat','aspd','blockCnt','respawnTime'].map(key => html`<${NumberField} key=${key} label=${fieldLabel(key)} value=${o[form]?.[key] ?? details?.source?.[form]?.stats?.[key] ?? 0}
        min=${0} onChange=${v => change({ [form]: { ...o[form], [key]: v } })} />`)}
    </div></details>`)}
    <${Select} label=${t('技能来源')} value=${kind} options=${[{ id:'ref', name:t('借用官方 kit') }, { id:'spec', name:t('JSON 技能规格') }, { id:'dsl', name:t('DSL 技能 / 天赋') }]} onChange=${kitSource => change({ kitSource })} />
    <details open=${kind === 'ref'}><summary>${t('选择技能或属性参考的官方干员')}</summary>
      <p class="st-note">${rec?.name || t('正在读取…')}</p>
      <${TargetPicker} kinds=${['operator']} onPick=${tg => { change({ kitRef: tg.key }); }} />
    </details>
    ${kind === 'spec' ? html`<${Field} label=${t('JSON 技能规格')}><textarea class="st-input st-code" rows="8" value=${specText} onInput=${e => {
      setSpecText(e.currentTarget.value);
      try { const spec = JSON.parse(e.currentTarget.value); setBadJson(false); change({ spec }); } catch { setBadJson(true); change({ spec: null }); }
    }} /><//>${badJson ? html`<p class="st-error">${t('不是有效的 JSON：{why}', { why: t('请检查格式') })}</p>` : null}` : null}
    ${kind === 'dsl' ? html`<${DslForm} key=${draft.revision} id=${draft.id} spec=${o.dsl || { dsl: 1, talents: [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.5 } } }] }] }} source=${rec} onChange=${dsl => change({ dsl })} />` : null}
    <details><summary>${t('借用本安装已有的素材')}</summary><p>${o.artRef || o.kitRef || rec?.charId || ''}</p>
      <${TargetPicker} kinds=${['operator']} onPick=${tg => change({ artRef: tg.key })} />
    </details>
  </div>`;
}
export default { id: 'operator', Component: OperatorEditor };
