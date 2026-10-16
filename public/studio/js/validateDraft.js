// The save gate is independent of the editor's debounced explanation.
export async function validateDraft(draft, { get, post }) {
  const o = draft.options || {};
  let spec;
  if (draft.template === 'dsl' || draft.template === 'meta') {
    spec = o.dsl !== undefined ? o.dsl : (await get(`dsl-example?name=${encodeURIComponent(o.example || (draft.template === 'meta' ? 'lmlee' : 'demo'))}&id=${encodeURIComponent(draft.id)}`)).spec;
  } else if (draft.template === 'operator' && o.kitSource === 'dsl') {
    spec = o.dsl !== undefined ? o.dsl : { dsl: 1, talents: [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.5 } } }] }] };
  } else return { ok: true };
  return post('validate-dsl', { spec });
}
