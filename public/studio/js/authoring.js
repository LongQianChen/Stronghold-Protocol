import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { get, post } from './api.js';
import { errorText } from './issues.js';
import { validateDraft } from './validateDraft.js';
import { editorOf } from './editors/index.js';

export function Authoring({ state, busy, onSave, onDraft, initialDraft }) {
  const [draft, setDraft] = useState(initialDraft || { ...state.authoring, id: state.id });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const baseline = JSON.stringify(state.authoring);
  useEffect(() => { const next = initialDraft?.revision === state.authoring.revision ? initialDraft : { ...state.authoring, id: state.id }; setDraft(next); onDraft(next); }, [baseline]);
  const Component = editorOf(draft.template).Component;
  const change = next => { setFailure(''); setDraft(next); onDraft(next); };
  const dirty = JSON.stringify({ ...draft, id: undefined }) !== baseline;
  const save = async () => {
    setSaving(true); setFailure('');
    try {
      const result = await validateDraft(draft, { get, post });
      if (!result.ok) { setFailure(t('DSL 规格被拒绝，请修正校验结果后再保存。')); return; }
      const saved = await onSave(draft);
      if (!saved?.check?.ok) setFailure(t('校验或保存未完成，请重试。'));
    } catch (e) { setFailure(t('校验或保存未完成，请重试。') + ' ' + errorText(e)); }
    finally { setSaving(false); }
  };
  return html`<section class="st-authoring" data-testid="authoring">
    ${Component ? html`<${Component} draft=${draft} state=${state} onChange=${change} />` : null}
    ${failure ? html`<p class="st-error" data-testid="authoring-error">${failure}</p>` : null}
    ${draft.template !== 'script' ? html`<${Button} variant="primary" data-testid="save-wizard" disabled=${busy || saving || !dirty} loading=${busy || saving} onClick=${save}>${t('保存修改')}<//>` : null}
  </section>`;
}
