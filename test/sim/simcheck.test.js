// The cross-engine check (tools/sim-check.mjs, public/dev/simcheck — docs/SIM.md「11. Tools」): the hashes are pinned
// (references made before still compare; the same values as the copy of core.js in 争锋频道 / Duel Channel), a change in
// one tick is found in its block and named by the dump comparison, the deep walk sees another realm's Map / Set, the
// check page loads the data files the client loads, and the corpus covers the golden battle families, traces a battle
// the same whatever ran before it, and ends it with the result digest a plain run gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { hex, hashNumbers, hashValue, deepHash, trace, tracer, compare, diffDumps, selectScenarios, textFingerprint } from '../../public/dev/simcheck/core.js';
import { SIM_DATA_FILES, scenariosOf } from '../../public/dev/simcheck/stronghold.js';
import { corpusSpecs, nodeAdapter, FAMILIES, parseOptions, bundleIdentity } from '../../tools/sim-check.mjs';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

test('simcheck dumps preserve special IEEE values through JSON and still locate a one-bit difference', () => {
  const adapter = {
    start: () => ({ t: 0 }), step: r => ++r.t <= 1,
    state: () => [-0, Infinity, -Infinity, NaN, 1 + Number.EPSILON], result: () => 'same',
  };
  const a = trace(adapter, { id: 'bits' }, { dump: [1, 1] }).dumps;
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(diffDumps(a, b), []);
  assert.deepEqual(b[1].state.slice(0, 4), ['-0', 'Infinity', '-Infinity', 'NaN']);
  b[1].state[0] = 0; b[1].state[4] = 1;
  const diff = diffDumps(a, b);
  assert.deepEqual(diff.map(x => x.index), [0, 4]);
  assert.notEqual(diff[0].refBits, diff[0].gotBits);
});

test('simcheck rejects incomplete runs and invalid sampling/dump parameters', () => {
  const adapter = { maxTicks: 2, start: () => ({}), step: () => true, state: () => [1], result: () => 'not finished' };
  assert.throws(() => trace(adapter, { id: 'loop' }), /maxTicks/);
  assert.throws(() => tracer(adapter, { id: 'bad' }, { every: 0 }), /interval/);
  assert.throws(() => tracer(adapter, { id: 'bad' }, { dump: [2, 1] }), /window/);
  assert.throws(() => tracer(adapter, { id: 'bad' }, { dump: [1, Infinity] }), /window/);
});

test('simcheck selection and CLI reject empty, mismatched and misspelled requests', () => {
  const scenarios = [{ id: 'a', family: 'one' }, { id: 'b', family: 'two' }];
  const subsets = [{ id: 'one', pick: s => s.family === 'one' }];
  assert.equal(selectScenarios(scenarios, subsets, 'one').list.length, 1);
  assert.throws(() => selectScenarios(scenarios, subsets, 'typo'), /unknown subset/);
  assert.throws(() => selectScenarios(scenarios, subsets, 'one', 'typo'), /unknown scenario/);
  assert.throws(() => selectScenarios(scenarios, subsets, 'one', 'b'), /no scenarios/);
  for (const args of [['--engines'], ['--engines', 'oops'], ['--subset', 'all'], ['--engines', 'chrome', '--subset', 'typo'], ['--oops', 'x']]) assert.throws(() => parseOptions(args));
});

test('simcheck bundle identity changes with corpus or dirty runtime/data content', () => {
  const specs = [{ id: 'a', spec: { seed: 1 } }], files = [{ url: '/data/chess.json', hash: textFingerprint('old') }];
  const a = bundleIdentity(specs, files);
  assert.notEqual(a, bundleIdentity([{ id: 'a', spec: { seed: 2 } }], files));
  assert.notEqual(a, bundleIdentity(specs, [{ url: files[0].url, hash: textFingerprint('new') }]));
  assert.equal(a, bundleIdentity(JSON.parse(JSON.stringify(specs)), JSON.parse(JSON.stringify(files))));
});

test('simcheck hashes: pinned values, NaN as one value, −0 apart from 0', () => {
  assert.equal(hex(hashNumbers([0, -0, 1, 0.1, -2.5e-300, 1e300, NaN, Infinity])), '8b3e38ba');
  assert.equal(hex(hashValue({ a: [1, 'x', null, true], b: { c: 0.5 } })), 'a024c2ef');
  assert.equal(hex(hashNumbers([NaN])), hex(hashNumbers([0 / 0])));
  assert.notEqual(hex(hashNumbers([0])), hex(hashNumbers([-0])));
  assert.equal(hex(deepHash([{ s: new Set([1, 2]), m: new Map([['k', 3]]), arr: [4.5] }])), '92f56136');
  const other = vm.runInNewContext('({ s: new Set([1, 2]), m: new Map([["k", 3]]), arr: [4.5] })');
  assert.equal(hex(deepHash([other])), '92f56136', 'another realm\'s Map / Set');
});

test('simcheck compare: a one-ulp change at tick 45 is found in its block and named by the dumps', () => {
  const toy = (bump) => ({
    start: () => ({ n: 0, x: 0.1 }),
    step: (r) => { if (r.n >= 100) return false; r.n++; r.x = r.x * 1.01 + 0.1; if (bump && r.n === 45) r.x += r.x * Number.EPSILON; return true; },
    state: (r) => [r.n, r.x], labels: () => ['n', 'x'], view: (r) => ({ x: Math.round(r.x) }), deep: (r) => hashNumbers([r.x]), result: (r) => String(Math.round(r.x)),
  });
  const ref = trace(toy(false), { id: 't' });
  assert.deepEqual(compare(ref, trace(toy(false), { id: 't' })), { ok: true, at: null, result: false, ticks: null });
  assert.deepEqual(compare(ref, trace(toy(true), { id: 't' })).at, { level: 'state', block: 1, from: 31, to: 60 });
  const a = tracer(toy(false), { id: 't' }, { dump: [31, 60] }).finish(), b = tracer(toy(true), { id: 't' }, { dump: [31, 60] }).finish();
  const d = diffDumps(a.dumps, b.dumps);
  assert.equal(d[0].tick, 45);
  assert.equal(d[0].label, 'x');
});

test('simcheck page: the data files are the browser runner\'s', () => {
  // runner.js re-exports the list from the loader the Worker shares (simLoader.js, 0.3.0)
  const src = readFileSync(new URL('../../public/js/battle/simLoader.js', import.meta.url), 'utf8');
  const m = /export const SIM_DATA_FILES = Object\.freeze\((\[[^\]]*\])\)/.exec(src);
  assert.ok(m, 'simLoader.js SIM_DATA_FILES');
  assert.match(readFileSync(new URL('../../public/js/battle/runner.js', import.meta.url), 'utf8'), /export \{[^}]*SIM_DATA_FILES[^}]*\} from '\.\/simLoader\.js'/);
  assert.deepEqual([...SIM_DATA_FILES], JSON.parse(m[1].replace(/'/g, '"')));
});

test('simcheck corpus: the golden battle families, a battle traced the same whatever ran before, the plain run\'s result', () => {
  const doc = { specs: corpusSpecs() }, sc = scenariosOf(doc);
  assert.deepEqual([...new Set(sc.map((s) => s.family))], [...FAMILIES]);
  assert.equal(new Set(sc.map((s) => s.id)).size, sc.length);
  assert.ok(sc.some((s) => s.fast) && sc.some((s) => !s.fast));
  const pick = sc.filter((s) => s.family === 'bonds')[0], other = sc.filter((s) => s.family === 'roster')[0];
  const alone = trace(nodeAdapter(doc), pick), ad = nodeAdapter(doc);
  trace(ad, other);
  assert.deepEqual(trace(ad, pick), alone);
  const spec = doc.specs.find((s) => s.id === pick.id).spec;
  const plain = resultDigest(createBattleFromSpec(spec, new DataSource(getDefaultSource().raw, null), { quiet: true }).runToEnd(200000)).hash;
  assert.equal(alone.result, plain);
});
