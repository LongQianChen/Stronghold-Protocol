// test/plugins/order.test.js — which plugins a set holds and in what order (DESIGN §32, shared/plugins/order.js): the
// requirements switched on with a plugin (`auto`), a missing or out-of-range requirement and a conflict refused, the
// order by requires / optional / loadAfter / loadBefore, then priority, then id — the same on every machine —, a cycle
// refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePluginOrder } from '../../shared/plugins/order.js';

const entry = (id, extra = {}) => ({ id, version: '1.0.0', requires: {}, optional: {}, conflicts: {}, loadAfter: [], loadBefore: [], priority: 0, ...extra });
const lookupOf = (...list) => { const m = new Map(list.map((p) => [p.id, p])); return (id) => m.get(id) || null; };

test('the plugins asked for, in id order when nothing else decides', () => {
  const lookup = lookupOf(entry('zeta'), entry('alpha'), entry('mid'));
  assert.deepEqual(resolvePluginOrder(['zeta', 'alpha', 'mid', 'alpha'], lookup), { order: ['alpha', 'mid', 'zeta'], auto: [] });
  assert.deepEqual(resolvePluginOrder([], lookup), { order: [], auto: [] });
});

test('requirements join the set (auto) and load first; missing or out of range → PLUGIN_DEPENDENCY', () => {
  const lookup = lookupOf(entry('skin', { requires: { base: '^1.0.0' } }), entry('base', { requires: { core: '*' } }), entry('core'), entry('old', { version: '0.9.0' }));
  assert.deepEqual(resolvePluginOrder(['skin'], lookup), { order: ['core', 'base', 'skin'], auto: ['base', 'core'] });
  assert.deepEqual(resolvePluginOrder(['skin', 'base'], lookup), { order: ['core', 'base', 'skin'], auto: ['core'] }, 'asked for: not auto');
  const missing = resolvePluginOrder(['x'], lookupOf(entry('x', { requires: { gone: '*' } })));
  assert.deepEqual(missing, { error: 'PLUGIN_DEPENDENCY', detail: 'x requires gone *, which is not available' });
  const range = resolvePluginOrder(['x'], lookupOf(entry('x', { requires: { old: '>=1.0.0' } }), entry('old', { version: '0.9.0' })));
  assert.deepEqual(range, { error: 'PLUGIN_DEPENDENCY', detail: 'x requires old >=1.0.0; the installed one is 0.9.0' });
  assert.deepEqual(resolvePluginOrder(['nope'], lookup), { error: 'PLUGIN_UNKNOWN', detail: 'nope is not a plugin this set may hold' });
});

test('a conflict in range with another plugin of the set → PLUGIN_CONFLICT (whichever declares it)', () => {
  const lookup = lookupOf(entry('a', { conflicts: { b: '<2.0.0' } }), entry('b'), entry('c', { conflicts: { b: '>=2.0.0' } }));
  assert.equal(resolvePluginOrder(['a', 'b'], lookup).error, 'PLUGIN_CONFLICT');
  assert.equal(resolvePluginOrder(['b', 'a'], lookup).error, 'PLUGIN_CONFLICT');
  assert.deepEqual(resolvePluginOrder(['b', 'c'], lookup), { order: ['b', 'c'], auto: [] }, 'out of the conflict\'s range');
  assert.deepEqual(resolvePluginOrder(['a'], lookup), { order: ['a'], auto: [] }, 'a conflict with a plugin outside the set is nothing');
});

test('order: optional / loadAfter after, loadBefore before (within the set), then priority, then id; a cycle → PLUGIN_DEPENDENCY', () => {
  const lookup = lookupOf(
    entry('a', { loadAfter: ['c'] }), entry('b', { loadBefore: ['c'] }), entry('c', { optional: { absent: '*' } }),
    entry('hi', { priority: 10 }), entry('lo', { priority: -5 }), entry('d', { optional: { a: '*' } }),
  );
  assert.deepEqual(resolvePluginOrder(['a', 'b', 'c', 'd', 'hi', 'lo'], lookup).order, ['hi', 'b', 'c', 'a', 'd', 'lo']);
  const cyc = lookupOf(entry('x', { loadAfter: ['y'] }), entry('y', { loadAfter: ['x'] }));
  assert.deepEqual(resolvePluginOrder(['x', 'y'], cyc), { error: 'PLUGIN_DEPENDENCY', detail: 'the load order of x, y is a cycle' });
  assert.deepEqual(resolvePluginOrder(['x'], cyc), { order: ['x'], auto: [] }, 'a hint about a plugin outside the set is nothing');
});
