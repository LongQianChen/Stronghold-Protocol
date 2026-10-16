import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { get } from '../api.js';
import { TargetPicker } from '../picker.js';
import { NumberField, fieldLabel } from './controls.js';

export function NumbersEditor({ draft, onChange }) {
  const [fields, setFields] = useState([]);
  const [filter, setFilter] = useState('');
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let alive = true;
    get(`authoring?template=numbers&target=${encodeURIComponent(draft.target || '')}`).then(r => { if (alive) setFields(r.fields || []); }).catch(() => { if (alive) setFailure(t('读取插件失败')); });
    return () => { alive = false; };
  }, [draft.target]);
  const edits = draft.options.edits || [];
  const set = (field, value) => onChange({ ...draft, options: { ...draft.options, edits: [...edits.filter(e => e.key !== field.key), { key: field.key, value }] } });
  return html`<div class="st-form st-numbers">
    <${TargetPicker} kinds=${['operator', 'enemy', 'bond', 'item']} onPick=${tg => onChange({ ...draft, target: `${tg.kind}:${tg.key}`, options: { edits: [] } })} />
    <p class="st-note">${t('黑板数值上限为原版同键最大值的 10 倍，至少允许到 64；完整校验还会检查步长与引用。')}</p>
    <input class="st-input" type="search" placeholder=${t('筛选字段')} value=${filter} onInput=${e => setFilter(e.currentTarget.value)} />
    ${failure ? html`<p class="st-error">${failure}</p>` : null}
    <div class="st-number-list">${fields.filter(f => `${f.name} ${f.path.join('.')} ${fieldLabel(f.path.at(-1))}`.includes(filter)).map(f => html`<div key=${f.key} class="st-number-field">
      <${NumberField} label=${`${f.name} · ${fieldLabel(f.path.at(-1))} (${f.id.endsWith('_b') ? t('精锐（精英二）') : t('普通')})`} value=${edits.find(e => e.key === f.key)?.value ?? f.original} min=${f.min} max=${f.max} onChange=${v => set(f, v)} />
      ${f.positiveMin ? html`<small>${t('正数不能小于 {min}；0 表示关闭。', { min: f.positiveMin })}</small>` : null}
      <small>${t('原版值：{value}；上限：{max}', { value: f.original, max: f.max })} · ${f.path.join('.')}</small>
    </div>`)}</div>
  </div>`;
}
export default { id: 'numbers', Component: NumbersEditor };
