import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { computeVanillaContent, nodeSha256 } from '../../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { fixture, guard, bondPatch } from '../helpers/contentFixtures.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { ROOT, getData } from '../../server/data.js';
import { Grid } from '../../server/sim/grid.js';
import { computeGroundPaths } from '../../server/sim/groundPaths.js';
const build = f => buildContentSet({ registry: f.registry, ids: ['data-demo'] });
test('vanilla identity and index are exactly P0; original data bytes are preserved', t => {
  const f = fixture(t), s = buildContentSet({ registry: f.registry });
  const p0 = computeVanillaContent({ simDir: 'server/sim', sharedDir: 'shared', dataDir: 'data', shim: DATA_SHIM_JS });
  assert.equal(s.cs, p0.cs); assert.deepEqual(s.index, p0.index); assert.equal(s.vanilla, true);
  for (const [rel, file] of contentSetFiles(s)) if (rel.startsWith('data/')) assert.ok(file.body.equals(fs.readFileSync(rel)), rel);
});
test('loaded content, deterministic hashes, frozen snapshot, raw-byte hashing and reload', t => {
  const f = fixture(t), root = f.put('data-demo', { data: ['patch.json'] }, { 'patch.json': bondPatch() });
  assert.equal(f.registry.plugin('data-demo').status, 'loaded');
  const s = build(f); assert.deepEqual(s.problems, []); assert.equal(s.data.bonds.deputShip.bb.base_def, 0.3);
  assert.equal(build(f), s); assert.ok(Object.isFrozen(s.data.bonds.deputShip));
  assert.equal(contentHashOf({ ...s.index, data: Object.fromEntries(Object.entries(s.index.data).map(([k,v]) => [k,v.sha256])) }), s.cs);
  for (const [rel, file] of contentSetFiles(s)) { assert.equal(nodeSha256(file.body), file.sha256, rel); assert.equal(file.body.length, file.bytes); }
  fs.appendFileSync(root + '/patch.json', ' '); f.registry.rescan(); const next = build(f);
  assert.notEqual(next.cs, s.cs, 'one whitespace byte changes the plugin identity');
  assert.equal(s.data.bonds.deputShip.bb.base_def, 0.3);
  const files = contentSetFiles(s); files.get('data/bonds.json').body.fill(0);
  assert.notEqual(contentSetFiles(s).get('data/bonds.json').body[0], 0);
});
test('settings normalize into cs, and dependency order is stable', t => {
  const f = fixture(t);
  f.put('base-pack', { data: ['base.json'] }, { 'base.json': bondPatch(0.4) });
  f.put('data-demo', { data: ['patch.json'], requires: { 'base-pack': '*' }, settings: { def: { type: 'number', min: 0, max: 1, default: 0.5 } } }, { 'patch.json': bondPatch({ $setting: 'def' }) });
  const s = build(f); assert.deepEqual(s.problems, []); assert.deepEqual(s.plugins.map(p => p.id), ['base-pack', 'data-demo']);
  assert.equal(s.data.bonds.deputShip.bb.base_def, 0.5); assert.equal(s.warnings[0].code, 'PLUGIN_PATCH_OVERRIDE');
  const changed = buildContentSet({ registry: f.registry, ids: [{ id: 'data-demo', settings: { def: 0.7 } }] });
  assert.notEqual(changed.cs, s.cs); assert.equal(changed.data.bonds.deputShip.bb.base_def, 0.7);
});
test('template, mode inheritance and plugin stage ground paths compose together', t => {
  const f = fixture(t);
  f.put('data-demo', { operators: ['op.json'], data: ['records.json'] }, { 'op.json': guard(), 'records.json': { records: 1, entries: [
    { file: 'stages', id: 'stage_x_data_demo_one', base: 'act1autochess_m01' },
    { file: 'modes', id: 'mode_x_data_demo_one', base: 'mode_single_normal', set: { stages: ['stage_x_data_demo_one'], economy: { refreshPrice: 0 } } },
  ] } });
  const s = build(f); assert.deepEqual(s.problems, []);
  assert.ok(Object.keys(s.data.stages.stage_x_data_demo_one.groundPaths).length > 0);
  assert.ok(s.modes.some(m => m.modeId === 'mode_x_data_demo_one')); assert.ok(s.kitted.includes('char_x_data_demo_guard'));
});
test('translations get current source hashes, retain unrelated language text, stay out of sim data', t => {
  const f = fixture(t);
  f.put('data-demo', { operators: ['op.json'], i18n: { en: 'i18n/en.json' }, sourceLang: 'zh' }, {
    'op.json': guard(), 'i18n/en.json': { version: 1, lang: 'en', files: { chess: { chess_x_data_demo_guard_a: { name: 'Demo guard' } } } },
  });
  const s = build(f); assert.deepEqual(s.problems, []);
  const overlay = JSON.parse(contentSetFiles(s).get('i18n/en.json').body);
  assert.equal(applyFileOverlay(s.data.chess, overlay.files.chess).value.chess_x_data_demo_guard_a.name, 'Demo guard');
  assert.equal(s.data.chess.chess_x_data_demo_guard_a.name, '演示守卫');
  assert.ok(overlay.files.chess.chess_char_1_01_a);
});
test('bad i18n leaf refuses the entire combination', t => {
  const f = fixture(t); f.put('data-demo', { i18n: { en: 'en.json' } }, { 'en.json': { version: 1, lang: 'en', files: { chess: { missing: { name: 'bad' } } } } });
  assert.equal(build(f).problems[0].code, 'PLUGIN_I18N'); assert.equal(build(f).cs, undefined);
});
test('missing permission, map deletion, foreign namespace and undeclared cross-plugin writes are refused', t => {
  const f = fixture(t);
  f.put('data-demo', { permissions: ['data.add'], data: ['p.json'] }, { 'p.json': bondPatch() });
  assert.equal(build(f).problems[0].code, 'PLUGIN_CONTENT_PERMISSION');
  f.put('data-demo', { data: ['p.json'] }, { 'p.json': { patch: 1, ops: [{ op: 'set', file: 'config', path: ['modes'], value: {} }] } });
  assert.equal(build(f).problems[0].code, 'PLUGIN_RECORD_DELETE');
  f.put('data-demo', { data: ['p.json'] }, { 'p.json': { patch: 1, ops: [{ op: 'merge', file: 'config', path: ['modes'], value: { stolen: {} } }] } });
  assert.equal(build(f).problems[0].code, 'PLUGIN_RECORD_ID');
  f.put('base-pack', { data: ['p.json'] }, { 'p.json': { records: 1, entries: [{ file: 'modes', id: 'mode_x_base_pack_one', base: 'mode_single_normal' }] } });
  f.put('data-demo', { data: ['p.json'], loadAfter: ['base-pack'] }, { 'p.json': { patch: 1, ops: [{ op: 'set', file: 'config', path: ['modes', 'mode_x_base_pack_one', 'name'], value: 'Changed' }] } });
  const s = buildContentSet({ registry: f.registry, ids: ['data-demo', 'base-pack'] });
  assert.ok(s.problems.some(p => p.code === 'PLUGIN_DEPENDENCY'));
});
test('invalid documents, JSON and DSL are skipped without loading code', t => {
  const f = fixture(t);
  for (const [manifest, doc, want] of [
    [{ data: ['p.json'] }, {}, 'PLUGIN_CONTENT_FORMAT'],
    [{ data: ['p.json'] }, '{', 'PLUGIN_CONTENT_FILE'],
    [{ dsl: ['p.json'], permissions: ['dsl'] }, {}, 'PLUGIN_DSL_VERSION'],
  ]) { f.put('data-demo', manifest, { 'p.json': doc }); assert.equal(f.registry.plugin('data-demo'), null); assert.ok(f.registry.report().skipped.some(p => p.problems.some(s => s.includes(want)))); }
  assert.equal(buildContentSet({ registry: f.registry, ids: {} }).problems[0].code, 'PLUGIN_CONTENT_FORMAT');
});

test('cosmetic-only selection remains the P0 set; mixed content dependencies resolve without changing gameplay order', t => {
  const f = fixture(t);
  f.put('art-pack', { class: 'cosmetic', permissions: ['assets.override'], assets: { chars: { char_102_texas: { avatar: { ref: 'char_112_siege' } } } } });
  const vanilla = buildContentSet({ registry: f.registry });
  const cosmetic = buildContentSet({ registry: f.registry, ids: ['art-pack'] });
  assert.deepEqual(cosmetic.problems, []); assert.equal(cosmetic.cs, vanilla.cs);
  f.put('data-demo', { data: ['p.json'], requires: { 'art-pack': '*' } }, { 'p.json': bondPatch() });
  const s = build(f); assert.deepEqual(s.problems, []); assert.deepEqual(s.plugins.map(p => p.id), ['data-demo']);
});

test('plugin ids whose namespaces collide after hyphen folding cannot be selected together', t => {
  const f = fixture(t);
  const empty = { patch: 1, ops: [] };
  f.put('ab', { data: ['p.json'] }, { 'p.json': empty });
  f.put('ab-cd', { data: ['p.json'] }, { 'p.json': empty });
  const hit = buildContentSet({ registry: f.registry, ids: ['ab', 'ab-cd'] });
  assert.equal(hit.problems[0].code, 'PLUGIN_RECORD_ID');
  assert.equal(hit.cs, undefined);
  f.put('data', { data: ['p.json'] }, { 'p.json': empty });
  f.put('data-demo', { data: ['p.json'] }, { 'p.json': empty });
  const demo = buildContentSet({ registry: f.registry, ids: ['data', 'data-demo'] });
  assert.equal(demo.problems[0].code, 'PLUGIN_RECORD_ID');
  assert.equal(demo.cs, undefined);
  f.put('abc', { data: ['p.json'] }, { 'p.json': empty });
  const ok = buildContentSet({ registry: f.registry, ids: ['ab', 'abc'] });
  assert.deepEqual(ok.problems, []);
  assert.match(ok.cs, /^[0-9a-f]{64}$/);
});

function copyData(dir) {
  const src = path.join(ROOT, 'data');
  const dest = path.join(dir, 'data');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const st = fs.statSync(from);
    if (st.isFile() && name.endsWith('.json')) fs.copyFileSync(from, path.join(dest, name));
    else if (st.isDirectory() && name === 'i18n') {
      fs.mkdirSync(path.join(dest, 'i18n'), { recursive: true });
      for (const file of fs.readdirSync(from)) if (file.endsWith('.json')) fs.copyFileSync(path.join(from, file), path.join(dest, 'i18n', file));
    }
  }
  return dest;
}

function registryAt(dir, dataDir) {
  return createPluginRegistry({
    publicDir: path.join(dir, 'public'), packsDir: path.join(dir, 'packs'), pluginsDir: path.join(dir, 'plugins'), dataDir,
  });
}

test('a content composition hashes the served i18n bytes; vanilla cs does not', t => {
  const f = fixture(t);
  f.put('data-demo', { data: ['p.json'] }, { 'p.json': bondPatch() });
  const dataDir = copyData(f.dir);
  const lang = fs.readdirSync(path.join(dataDir, 'i18n')).find(name => name.endsWith('.json'));
  assert.ok(lang);
  const regA = registryAt(f.dir, dataDir);
  const a = buildContentSet({ registry: regA, ids: ['data-demo'] });
  assert.deepEqual(a.problems, []);
  const file = path.join(dataDir, 'i18n', lang);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const walk = (v) => {
    if (typeof v === 'string') return v + '※';
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  fs.writeFileSync(file, JSON.stringify(walk(doc)));
  const regB = registryAt(f.dir, dataDir);
  const b = buildContentSet({ registry: regB, ids: ['data-demo'] });
  assert.deepEqual(b.problems, []);
  assert.notEqual(b.cs, a.cs);
  const rel = `i18n/${lang}`;
  assert.equal(contentSetFiles(a).get(rel).body.equals(contentSetFiles(b).get(rel).body), false);
  const vanillaReal = computeVanillaContent({ simDir: 'server/sim', sharedDir: 'shared', dataDir: 'data', shim: DATA_SHIM_JS });
  const vanillaEdited = computeVanillaContent({ simDir: 'server/sim', sharedDir: 'shared', dataDir, shim: DATA_SHIM_JS });
  assert.equal(vanillaEdited.cs, vanillaReal.cs);
  assert.equal(buildContentSet({ registry: regB }).cs, vanillaReal.cs);
});

test('a wave route change recomputes ground paths of the stages that use it and keeps deploy tiles', t => {
  const data = getData();
  const waveId = Object.keys(data.waves).find(id => Object.values(data.config.modes).some(m => Object.values(m.rounds ?? {}).some(rd => rd?.template === id || Object.values(rd?.bossTemplates ?? {}).includes(id))));
  assert.ok(waveId);
  const used = new Set();
  for (const m of Object.values(data.config.modes)) {
    const hits = Object.values(m.rounds ?? {}).some(rd => rd?.template === waveId || Object.values(rd?.bossTemplates ?? {}).includes(waveId));
    if (hits) for (const id of m.stages ?? []) used.add(id);
  }
  const stageId = [...used].find(id => data.stages[id]?.groundPaths);
  const otherId = Object.keys(data.stages).find(id => !used.has(id) && data.stages[id]?.groundPaths);
  assert.ok(stageId && otherId);
  const stage = data.stages[stageId];
  const grid = new Grid({ ...stage, legend: stage.tiles }, { r0: 0, r1: 18, c0: 0, c1: 20 });
  const tiles = [];
  for (let r = 0; r < 19; r++) for (let c = 0; c < 21; c++) if (grid.groundPassable(r, c)) tiles.push([r, c]);
  let pair = null, tried = 0;
  for (let i = 0; i < tiles.length && !pair; i++) for (let j = tiles.length - 1; j > i && !pair; j--) {
    const start = tiles[i], end = tiles[j];
    const key = `${start.join(',')}->${end.join(',')}`;
    if (stage.groundPaths[key]) continue;
    tried++;
    if (grid.findPath(start[0], start[1], end[0], end[1])) pair = { start, end, key };
    else if (tried > 40) break;
  }
  assert.ok(pair, 'a passable pair missing from the baked ground paths');
  const f = fixture(t);
  f.put('data-demo', { data: ['p.json'] }, { 'p.json': { patch: 1, ops: [{ op: 'append', file: 'waves', id: waveId, path: ['routes'], value: [{ motion: 'WALK', start: pair.start, end: pair.end, checkpoints: [] }] }] } });
  const s = build(f);
  assert.deepEqual(s.problems, []);
  const routes = Object.values(s.data.waves).flatMap(w => [...w.routes, ...w.extraRoutes]);
  const next = s.data.stages[stageId];
  assert.equal(next.rows.join('\n'), stage.rows.join('\n'));
  assert.deepEqual(next.deployTiles, stage.deployTiles);
  assert.deepEqual(next.groundPaths, computeGroundPaths(stage, routes).groundPaths);
  assert.ok(next.groundPaths[pair.key]);
  assert.equal(stage.groundPaths[pair.key], undefined);
  assert.deepEqual(s.data.stages[otherId].groundPaths, data.stages[otherId].groundPaths);
});
