import { numericFields, jsonText } from '../gameData.js';
import { applyPatches } from '../../../shared/plugins/patch.js';
import { appendOfficialBounds } from '../../../shared/plugins/officialBounds.js';
import { StudioError } from '../files.js';

export default {
  id: 'numbers', class: 'content', kinds: ['operator', 'enemy', 'bond', 'item'], slots: () => [], overlay: () => ({}),
  build({ target, options, data }) {
    const fields = numericFields(data, target || { kind: 'operator', key: 'char_102_texas' });
    const edits = options.edits || (fields.length ? [{ key: fields[0].key, value: fields[0].original }] : []);
    if (!Array.isArray(edits) || edits.length > 256) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'at most 256 numeric edits' });
    const ops = [];
    for (const edit of edits) {
      const f = fields.find(f => f.key === edit.key);
      if (!f || typeof edit.value !== 'number' || !Number.isFinite(edit.value)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'choose a numeric field and a finite value' });
      if (edit.value < f.min || edit.value > f.max) throw new StudioError('PLUGIN_DATA_BOUND', 400, { where: f.key, detail: `value ${edit.value}; range ${f.min}…${f.max}` });
      for (const path of [f.path, ...f.mirrors]) ops.push({ op: 'set', file: f.file, id: f.id, path, value: edit.value });
    }
    const patched = applyPatches(data, ops);
    appendOfficialBounds(patched.data, data, (where, detail, code) => { throw new StudioError(code, 400, { where, detail }); });
    return { manifest: { scope: ['room'], permissions: ['data.patch'], data: ['data/patch.json'] }, files: { 'data/patch.json': jsonText({ patch: 1, ops }) } };
  },
};
