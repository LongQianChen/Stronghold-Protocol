import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatches, normalizeSettings } from '../../shared/plugins/patch.js';
const data = { config: { economy: { value: 1 }, modes: {} }, enemies: {}, bonds: { deputShip: { bb: { atk: 1 }, members: ['a'] } } };
const set = (over = {}) => ({ op: 'set', file: 'config', path: ['economy', 'value'], value: 2, ...over });
const code = (ops, want, context) => { const r = applyPatches(data, ops, context); assert.equal(r.data, data); assert.ok(r.problems.some(p => p.code === want), JSON.stringify(r.problems)); };
test('all five operations are pure; settings substitute before type checks', () => {
  const r = applyPatches(data, [set({ value: { $setting: 'price' } }),
    { op: 'merge', file: 'bonds', id: 'deputShip', path: ['bb'], value: { atk: 4, hp: 2 } },
    { op: 'add', file: 'enemies', id: 'enemy_x_demo_slug', value: { key: 'enemy_x_demo_slug' } },
    { op: 'append', file: 'bonds', id: 'deputShip', path: ['members'], value: ['b'] },
    { op: 'remove', file: 'bonds', id: 'deputShip', path: ['members'], match: 'a' },
  ], { pluginId: 'demo', settings: { price: 0 } });
  assert.deepEqual(r.problems, []); assert.equal(r.data.config.economy.value, 0);
  assert.deepEqual(r.data.bonds.deputShip, { bb: { atk: 4, hp: 2 }, members: ['b'] });
  assert.equal(data.config.economy.value, 1); assert.deepEqual(data.enemies, {});
});
for (const [label, ops, want] of [
  ['unknown op', [set({ op: 'execute' })], 'PLUGIN_PATCH_OP'],
  ['missing path', [set({ path: ['missing'] })], 'PLUGIN_PATCH_PATH'],
  ['wrong type', [set({ value: [] })], 'PLUGIN_PATCH_TYPE'],
  ['unknown setting', [set({ value: { $setting: 'missing' } })], 'PLUGIN_PATCH_SETTING'],
  ['wrong namespace', [{ op: 'add', file: 'enemies', id: 'official', value: {} }], 'PLUGIN_RECORD_ID'],
  ['prototype', [set({ value: JSON.parse('{"__proto__":{}}') })], 'PLUGIN_DATA_PATH'],
  ['nonfinite', [set({ value: Infinity })], 'PLUGIN_DATA_NUMBER'],
  ['function', [set({ value: () => 1 })], 'PLUGIN_DATA_TYPE'],
  ['wrong ops', {}, 'PLUGIN_PATCH_TYPE'],
]) test(label, () => code(ops, want));
test('existing namespaced record rejected; failure rolls back preceding valid operations', () => {
  const op = { op: 'add', file: 'enemies', id: 'enemy_x_demo_slug', value: {} };
  code([set(), op, op], 'PLUGIN_RECORD_EXISTS');
  code([set(), set({ path: ['constructor'] })], 'PLUGIN_PATCH_PATH');
});
test('64-level JSON bound', () => { let v = {}; for (let i = 0; i < 66; i++) v = { v }; code([set({ value: v })], 'PLUGIN_DATA_LIMIT'); });
test('null cannot wash a field into another type', () => {
  const ops = [
    { op: 'set', file: 'config', path: ['economy', 'value'], value: null },
    { op: 'set', file: 'config', path: ['economy', 'value'], value: { hijack: true } },
  ];
  const r = applyPatches(data, ops);
  assert.equal(r.data, data);
  assert.equal(r.problems[0].code, 'PLUGIN_PATCH_TYPE');
  assert.equal(data.config.economy.value, 1);
  const nullable = { ...data, config: { ...data.config, economy: { value: null } } };
  const ok = applyPatches(nullable, [{ op: 'set', file: 'config', path: ['economy', 'value'], value: null }]);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.data.config.economy.value, null);
  assert.notEqual(ok.data, nullable);
});
test('settings use defaults for invalid/unknown values and preserve valid zero', () => {
  const d = { n: { type: 'integer', min: 0, max: 6, step: 2, default: 2 }, b: { type: 'boolean', default: true }, e: { type: 'enum', options: ['a', 'b'], default: 'a' } };
  assert.deepEqual(normalizeSettings(d, { n: 0, b: false, e: 'b', ignored: 3 }), { n: 0, b: false, e: 'b' });
  assert.deepEqual(normalizeSettings(d, { n: 3, b: 1, e: 'z' }), { n: 2, b: true, e: 'a' });
});
