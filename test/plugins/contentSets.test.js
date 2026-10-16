// test/plugins/contentSets.test.js — server/plugins/contentSets.js, the content sets rooms hold (DESIGN §32.6, P1c), over
// an injected builder (the real C1 builder: test/plugins/contentSet.test.js, test/lobby-plugins.test.js):
//   * the same plugins in the same state with the same settings are not built again; a changed plugin file (a new
//     content hash), another manifest or other settings are — settings as the builder reads them (normalizeSettings: a
//     key the plugin does not declare never costs a build: the P1c review's HIGH-2);
//   * a set whose manifest does not hash to its cs is never used (INTERNAL);
//   * the concurrent limit (PLUGIN_BUSY) is checked before anything is built, the set the asking room gives up counted
//     free; a refused set is not remembered;
//   * what /cs/<cs16>/… serves and the bytes a match host checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { ERR } from '../../shared/constants.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const APP = '0.3.0-dev';
const SIM = 'f'.repeat(64);

/** A built set of one plugin `id` whose patched bonds file says `tag` (`broken`: its cs is not its manifest's). */
function fakeBuilt(id, tag, { broken = false } = {}) {
  const body = Buffer.from(JSON.stringify({ tag }));
  const plugins = [{ id, version: '1.0.0', files: { 'p.json': sha(Buffer.from(id)) } }];
  const cs = broken ? 'ab'.repeat(32) : contentHashOf({ app: APP, sim: SIM, data: { bonds: sha(body) }, plugins, settings: {} });
  const index = { app: APP, sim: SIM, cs, vanilla: false, plugins, settings: {},
    data: { bonds: { url: `/cs/${cs.slice(0, 16)}/data/bonds.json`, sha256: sha(body), bytes: body.length } }, i18n: {} };
  const files = new Map([['data/bonds.json', { body, sha256: sha(body), bytes: body.length }],
    ['index.json', { body: Buffer.from(JSON.stringify(index)), sha256: sha(Buffer.from(JSON.stringify(index))), bytes: 1 }]]);
  return { built: { cs, vanilla: false, plugins: [{ id, version: '1.0.0', hash: sha(Buffer.from(id)) }], data: { bonds: { tag } }, modes: [], index, warnings: [], kitted: null, problems: [] }, files };
}

const DEF = { x: { type: 'integer', min: 0, max: 9, default: 0 } };

function harness({ maxSets = 4 } = {}) {
  const plugins = { a: { id: 'a', content: { hash: 'h1' }, manifest: { id: 'a', version: '1.0.0' } }, b: { id: 'b', content: { hash: 'h2' }, manifest: { id: 'b', version: '1.0.0' } },
    t: { id: 't', content: { hash: 'h3' }, manifest: { id: 't', version: '1.0.0', settings: DEF } } };
  const calls = [];
  const filesBy = new WeakMap();
  const made = { a: () => fakeBuilt('a', `a:${plugins.a.content.hash}`), b: () => fakeBuilt('b', 'b'), t: () => fakeBuilt('t', 't'), bad: () => fakeBuilt('a', 'x', { broken: true }) };
  let next = null;
  const build = ({ ids }) => {
    calls.push(ids.map((x) => (typeof x === 'string' ? x : `${x.id}+${JSON.stringify(x.settings)}`)).join(','));
    const key = next || (typeof ids[0] === 'string' ? ids[0] : ids[0].id);
    const { built, files } = made[key]();
    filesBy.set(built, files);
    return built;
  };
  const sets = createContentSets({ registry: { plugin: (id) => plugins[id] || null }, vanillaData: { config: { modes: {} } }, maxSets: () => maxSets,
    build, filesOf: (built) => filesBy.get(built) });
  return { sets, plugins, calls, breakNext: (on) => { next = on ? 'bad' : null; } };
}

test('the same plugins, in the same state, with the same settings, are not built again', () => {
  const { sets, plugins, calls } = harness();
  const one = sets.resolve(['a']);
  assert.ok(one.ok, JSON.stringify(one));
  assert.equal(sets.resolve(['a']).set, one.set, 'remembered');
  assert.deepEqual(calls, ['a']);
  plugins.a = { ...plugins.a, content: { hash: 'h1-changed' } };
  const changed = sets.resolve(['a']);
  assert.deepEqual(calls, ['a', 'a'], 'a changed file is built again');
  assert.notEqual(changed.set.cs, one.set.cs);
  plugins.a = { ...plugins.a, manifest: { ...plugins.a.manifest, version: '1.0.1' } };
  sets.resolve(['a']);
  assert.deepEqual(calls, ['a', 'a', 'a'], 'another manifest: built again');
  // settings as the builder reads them: undeclared keys are nothing; a declared one is
  sets.resolve(['a'], { settings: { a: { x: 1 } } });
  assert.equal(calls.length, 3, 'a key plugin a does not declare');
  sets.resolve(['t']);
  sets.resolve(['t'], { settings: { t: { x: 0, junk: 'a' } } });
  sets.resolve(['t'], { settings: { t: { x: 12 } } });
  assert.deepEqual(calls.slice(3), ['t+{"x":0}'], 'the default, junk beside it, an out-of-range value: the same set');
  sets.resolve(['t'], { settings: { t: { x: 3 } } });
  assert.deepEqual(calls.slice(3), ['t+{"x":0}', 't+{"x":3}'], 'another declared value: built (normalized)');
});

test('a burst of requests with junk settings builds once; at the limit nothing is built; a refused set is not remembered', () => {
  const { sets, calls } = harness({ maxSets: 1 });
  for (let i = 0; i < 6; i++) assert.ok(sets.resolve(['a'], { settings: { a: { junk: `j${i}` } } }).ok);
  assert.equal(calls.length, 1, 'six requests, one build');
  const a = sets.resolve(['a']).set;
  sets.hold(a.cs);
  for (const junk of ['x', 'y']) assert.equal(sets.resolve(['b'], { settings: { b: { junk } } }).error, ERR.PLUGIN_BUSY);
  assert.equal(calls.length, 1, 'refused before a build');
  assert.equal(sets.stats().builds, 1);
  sets.release(a.cs);
  assert.ok(sets.resolve(['b']).ok, 'room again: built now');
  assert.deepEqual(calls, ['a', 'b']);
});

test('a set whose manifest does not hash to its cs is never used; the limit; what is served', () => {
  const { sets, breakNext } = harness({ maxSets: 1 });
  breakNext(true);
  assert.equal(sets.resolve(['a']).error, ERR.INTERNAL);
  breakNext(false);
  const a = sets.resolve(['a']).set;
  sets.hold(a.cs);
  const busy = sets.resolve(['b']);
  assert.equal(busy.error, ERR.PLUGIN_BUSY);
  assert.ok(sets.resolve(['b'], { replacing: a.cs }).ok, 'the set the asking room gives up is free');
  assert.ok(sets.resolve(['a']).ok, 'a set already held is free');
  // /cs/<cs16>/…: the manifest (no hash of its own: it names cs) and the data files with theirs
  const cs16 = a.cs.slice(0, 16);
  assert.equal(sets.file(cs16, 'index.json').sha256, null);
  assert.equal(JSON.parse(sets.file(cs16, 'index.json').body.toString('utf8')).cs, a.cs);
  assert.equal(sets.file(cs16, 'data/bonds.json').sha256, a.hashInput.data.bonds);
  assert.equal(sets.file(cs16, 'data/../index.json'), null);
  assert.equal(sets.file('0'.repeat(16), 'index.json'), null);
  // the bytes a match host checks against the hash input
  const bytes = sets.dataBytes(a.cs);
  assert.equal(sha(bytes.bonds), a.hashInput.data.bonds);
  assert.equal(sets.inUse(), 1);
  sets.release(a.cs);
  assert.equal(sets.inUse(), 0);
});
