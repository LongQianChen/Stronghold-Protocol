import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { get } from '../api.js';
import { Select } from './controls.js';
import { DslForm } from './dslForm.js';

export function DslEditor({ draft, onChange, meta = false }) {
  const example = draft.options.example || (meta ? 'lmlee' : 'demo');
  const [source, setSource] = useState(null);
  const [initial, setInitial] = useState(null);
  const choose = async name => {
    const r = await get(`dsl-example?name=${name}&id=${encodeURIComponent(draft.id)}`);
    onChange({ ...draft, options: { ...draft.options, example: name, dsl: r.spec } });
  };
  useEffect(() => {
    let alive = true;
    get(`dsl-example?name=${example}&id=${encodeURIComponent(draft.id)}`).then(async r => {
      if (!alive) return;
      setInitial(r.spec);
      if (r.charId) {
        const d = await get(`authoring?template=operator&target=operator:${r.charId}`);
        if (alive) setSource(d.source?.normal);
      }
    });
    return () => { alive = false; };
  }, [example, draft.id]);
  return html`<div class="st-form">
    <${Select} label=${t('从例子开始')} value=${example} options=${meta ? [{ id: 'lmlee', name: t('老鲤：分回合收入') }] : [
      { id:'demo', name:t('被动：攻击力提升 50%') }, { id:'skgoat', name:t('地灵：持续增益') }, { id:'inside', name:t('隐现：弹药技能') }, { id:'texas', name:t('德克萨斯：剑雨与天赋') },
      { id:'kazema', name:t('风丸：召唤替身') }, { id:'lmlee', name:t('老鲤：分回合收入') }]} onChange=${choose} />
    ${example === 'kazema' ? html`<p class="st-note">${t('此召唤例子不含技能结束时收回替身；适合 20 秒以内对照。')}</p>` : null}
    ${draft.options.dsl || initial ? html`<${DslForm} key=${draft.revision} id=${draft.id} spec=${draft.options.dsl || initial} source=${source} meta=${meta || example === 'lmlee'}
      onChange=${dsl => onChange({ ...draft, options: { ...draft.options, example, dsl } })} />` : t('正在读取…')}
  </div>`;
}
export default { id: 'dsl', Component: DslEditor };
