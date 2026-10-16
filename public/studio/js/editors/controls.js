import { useLayoutEffect, useRef } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { inputNumber, syncNumberInput } from '../../../js/ui/numberInput.js';
import { t, N_ } from '../../../../shared/i18n.js';

const LABELS = { maxHp: N_('生命值'), atk: N_('攻击力'), def: N_('防御力'), res: N_('法术抗性'), cost: N_('部署费用'), bat: N_('攻击间隔'), aspd: N_('攻击速度'), blockCnt: N_('阻挡数'), respawnTime: N_('再部署时间'), atkPct: N_('攻击力比例'), hpPct: N_('生命值比例'), defPct: N_('防御力比例') };
export const fieldLabel = key => LABELS[key] ? t(LABELS[key]) : key;
export function Field({ label, children }) { return html`<label class="st-field-row"><span>${label}</span>${children}</label>`; }
export function Select({ value, options, onChange, label, disabled = false }) {
  return html`<${Field} label=${label}><select class="st-input" value=${value} disabled=${disabled} onChange=${e => onChange(e.currentTarget.value)}>
    ${options.map(o => html`<option value=${typeof o === 'string' ? o : o.id}>${typeof o === 'string' ? o : o.name}</option>`)}
  </select><//>`;
}
// Not a controlled value (js/ui/numberInput.js): a partial entry such as "0." is left alone while it is typed.
export function NumberField({ label, value, onChange, min = -1e9, max = 1e9, step = 'any' }) {
  const ref = useRef(null), latest = useRef(value);
  latest.current = value;
  useLayoutEffect(() => syncNumberInput(ref.current, value), [value]);
  return html`<${Field} label=${label}><input ref=${ref} class="st-input" type="number" min=${min} max=${max} step=${step}
    onInput=${e => { const n = inputNumber(e.currentTarget); if (n !== undefined) onChange(n); }} onBlur=${e => syncNumberInput(e.currentTarget, latest.current, true)} /><//>`;
}
export function TextField({ label, value, onChange }) { return html`<${Field} label=${label}><input class="st-input" value=${value || ''} maxLength="80" onInput=${e => onChange(e.currentTarget.value)} /><//>`; }
export const setKey = (obj, key, value) => ({ ...obj, [key]: value });
export const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
