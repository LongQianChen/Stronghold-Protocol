// The wizard owns only its generated files. A revision rejects saves over external edits.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createPlugin, templateById, manifestText } from './templates/index.js';
import { createTargetIndex, targetOf } from './targets.js';
import { numericFields, officialOperator, readStudioData } from './gameData.js';
import { dslExample } from './dslExamples.js';
import { validateDsl } from '../sim/content/dsl/validate.js';
import { rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { jsonProblems } from '../../shared/plugins/dataUtils.js';
import { StudioError } from './files.js';

export function authorRevision(files, id) {
  const h = createHash('sha256');
  for (const f of files.list(id).sort((a, b) => a.rel < b.rel ? -1 : 1)) {
    if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
    h.update(f.rel).update('\0').update(fs.readFileSync(files.stat(id, f.rel).abs));
  }
  return h.digest('hex');
}

export function createAuthoring({ files, dataDir }) {
  let data;
  const official = () => (data ||= readStudioData(dataDir));
  const targets = createTargetIndex(dataDir);
  const read = id => {
    let side;
    try { side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}'); } catch { side = {}; }
    return side.authoring ? { ...side.authoring, revision: authorRevision(files, id) } : null;
  };
  const details = (template, target) => {
    const t = targetOf(targets().targets, target);
    const d = official();
    if (template === 'numbers') return { fields: numericFields(d, t || { kind: 'operator', key: 'char_102_texas' }) };
    if (['operator', 'dsl'].includes(template)) {
      const source = officialOperator(d, t?.key || 'char_102_texas');
      return { source, branches: [...new Map(Object.values(d.chess).map(r => [r.subProfessionId, { id: r.subProfessionId, profession: r.profession, name: r.subProfessionName || r.subProfessionId }])).values()], bonds: Object.entries(d.bonds).map(([id, r]) => ({ id, name: r.name })) };
    }
    return { modes: Object.values(d.config.modes).filter(m => m.inScope).map(m => ({ id: m.modeId, name: m.name })) };
  };
  const generate = (id, input, manifest = null) => {
    const tpl = templateById(input.template);
    if (!tpl?.build || !input.options || typeof input.options !== 'object' || Array.isArray(input.options)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'wizard template and options required' });
    const problems = jsonProblems(input.options, 'options');
    if (problems.length) throw new StudioError(problems[0].code, 400, { where: problems[0].path, detail: problems[0].message });
    const target = input.target ? targetOf(targets().targets, input.target) : null;
    if (input.target && (!target || !tpl.kinds.includes(target.kind))) throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: input.target });
    const name = typeof manifest?.name === 'string' ? manifest.name : manifest?.name?.zh || manifest?.name?.en || id;
    return createPlugin(tpl, { id, name, target, options: input.options, data: official() });
  };
  const save = (id, input) => {
    const old = read(id);
    if (!old || old.template === 'script' || input.template !== old.template) throw new StudioError('PLUGIN_STUDIO_REQUEST', 409, { detail: 'this plugin is not editable with this wizard' });
    if (input.revision !== old.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const manifest = JSON.parse(fs.readFileSync(files.stat(id, 'plugin.json').abs, 'utf8'));
    const made = generate(id, input, manifest);
    mergeAuthorManifest(manifest, made.manifest, old.template);
    for (const [rel, text] of Object.entries(made.files)) if (rel !== 'README.md') files.write(id, rel, Buffer.from(text), { generated: true });
    files.write(id, 'plugin.json', Buffer.from(manifestText(manifest)));
    let side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}');
    side = { ...side, authoring: made.authoring };
    files.writeSidecar(id, '.studio.json', Buffer.from(manifestText(side)));
  };
  return { read, save, generate, details,
    example: dslExample,
    // the official caps the build applies (contentSet.js), or a literal over them would pass here and fail on save
    validate: spec => { rememberOfficialBounds(official()); return validateDsl(spec, { bounds: true }); },
    source(id) {
      const manifest = JSON.parse(fs.readFileSync(files.stat(id, 'plugin.json').abs, 'utf8'));
      const rel = manifest.entry?.sim;
      return typeof rel === 'string' ? { rel, text: fs.readFileSync(files.stat(id, rel).abs, 'utf8').slice(0, 100000) } : null;
    },
  };
}

/** Preserve metadata, settings, dependencies and other unowned parts in both save and unsaved trials. */
export function mergeAuthorManifest(manifest, generated, template) {
  const ownedPermissions = ['numbers'].includes(template) ? ['data.patch'] : ['operator','dsl','meta'].includes(template) ? ['data.add','dsl'] : template === 'mode' ? ['data.add'] : ['ui.frame'];
  manifest.permissions = [...new Set([...(manifest.permissions || []).filter(p => !ownedPermissions.includes(p)), ...(generated.permissions || [])])];
  for (const key of ['operators', 'data', 'dsl', 'modes', 'slots', 'entry']) {
    if (Object.hasOwn(generated, key)) manifest[key] = generated[key];
    else if (['dsl', 'operators'].includes(key) && ['dsl', 'meta', 'operator'].includes(template)) delete manifest[key];
  }
  return manifest;
}
