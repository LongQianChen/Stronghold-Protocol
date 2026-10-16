// Prep DSL from a content set runs inside the match host (DESIGN §32.7, PLUGIN-DSL.md §9).
// Helpers are local, as in test/match/plugin-host.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../../server/data.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { writePlugin } from '../helpers/pluginFixtures.js';
import { createPlugin, templateById } from '../../server/studio/templates/index.js';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contentHashOf } from '../../shared/plugins/identity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const content = (extra = {}) => ({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch', 'data.add'], ...extra });
const bondPatch = (value) => ({ patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value })) });

const dirs = [];
function pluginsDir(plugins) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-dsl-host-'));
  dirs.push(tmp);
  const dir = path.join(tmp, 'plugins');
  for (const [id, [extra, files]] of Object.entries(plugins)) writePlugin(path.join(dir, id), content(extra), files);
  return dir;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function setsOf(dir) {
  const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(path.dirname(dir), 'packs'), pluginsDir: dir }, { log: quiet });
  registry.refresh(true);
  return createContentSets({ registry, vanillaData: getData({ log: quiet }), log: quiet });
}

function matchOpts(cs, seats, out, extra = {}) {
  return {
    roomCode: 'TEST', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal', seats, spectators: [], seed: 7, matchNo: 1, cs, requireCs: true,
    send: (pid, msg) => { out.sent.push([pid, msg]); return true; },
    broadcast: (msg) => out.broadcast.push(msg),
    onEnd: (summary) => { out.ended.push(summary); out.resolveEnd?.(summary); },
    ...extra,
  };
}
const frames = () => { const out = { sent: [], broadcast: [], ended: [] }; out.end = new Promise((r) => { out.resolveEnd = r; }); return out; };
const human = [{ seat: 0, playerId: 'p_1', name: 'P1', isBot: false, connected: true }];

function incomeSpec(id, key = `effect:${id}:income`) {
  return {
    dsl: 1,
    pluginId: id,
    meta: { key, on: [{ when: 'income', if: { round: 1 }, do: [{ funds: { amount: 15, setIncome: true } }] }] },
  };
}

/** Drive a solo match to the first private view whose funds are above 0 (round-1 income). */
async function roundOneFunds(hosts, cs) {
  const out = frames();
  const m = hosts.create(cs, matchOpts(cs, human, out, { mode: 'solo', modeId: 'mode_single_normal' }));
  m.start();
  const ready = await m.handle('p_1', { t: 'g.infoReady' });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  // infoReady schedules enterBandDraft with later(0). The reply can arrive before that phase.
  let band = { error: 'WRONG_PHASE' };
  for (let i = 0; i < 40 && !band.ok; i++) {
    band = await m.handle('p_1', { t: 'g.band', bandId: 'band_amiya' });
    if (band.ok || band.error !== 'WRONG_PHASE') break;
    await delay(50);
  }
  assert.equal(band.ok, true, JSON.stringify(band));
  let funds = null;
  for (let i = 0; i < 80 && funds == null; i++) {
    const view = out.sent.map(([, msg]) => msg).find((msg) => msg && msg.t === 'm.private' && msg.playerId === 'p_1' && msg.funds > 0);
    if (view) funds = view.funds;
    else await delay(150);
  }
  m.dispose();
  return funds;
}

test('a prep DSL spec rewrites round-1 income inside the match host; a set with no dsl does not', { timeout: 90_000 }, async () => {
  const generated = createPlugin(templateById('meta'), { id: 'roundgold', options: { dsl: incomeSpec('roundgold') } });
  const dir = pluginsDir({
    roundgold: [generated.manifest, generated.files],
    plainbond: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.33) }],
  });
  const contents = setsOf(dir);
  const gold = contents.resolve(['roundgold']);
  assert.ok(gold.ok, JSON.stringify(gold));
  assert.equal(gold.set.data.dsl.roundgold[0].meta.key, 'effect:roundgold:income');
  const dslFile = gold.set.served.get('data/dsl.json');
  assert.ok(dslFile, 'prep specs are a served data file');
  assert.match(dslFile.body.toString('utf8'), /effect:roundgold:income/);
  assert.equal(typeof gold.set.hashInput.data.dsl, 'string', 'data/dsl.json is part of cs');
  const plain = contents.resolve(['plainbond']);
  assert.ok(plain.ok, JSON.stringify(plain));
  assert.equal(Object.hasOwn(plain.set.data, 'dsl'), false);
  assert.equal(plain.set.served.get('data/dsl.json'), undefined);
  assert.equal(Object.hasOwn(plain.set.hashInput.data, 'dsl'), false);
  contents.hold(gold.set.cs);
  contents.hold(plain.set.cs);
  const hosts = createMatchHosts({ contents, log: quiet });
  try {
    assert.equal(await roundOneFunds(hosts, gold.set.cs), 15);
    assert.equal(await roundOneFunds(hosts, plain.set.cs), 4);
  } finally { hosts.close(); }
});

test('a prep key that is not this plugin id is refused before a match host boots', () => {
  const dir = pluginsDir({
    badkey: [{ permissions: ['dsl'], dsl: ['dsl/income.json'] }, { 'dsl/income.json': incomeSpec('badkey', 'effect:other:income') }],
  });
  const contents = setsOf(dir);
  const r = contents.resolve(['badkey']);
  assert.notEqual(r.ok, true);
  assert.equal(r.set, undefined);
  assert.equal(r.error, 'PLUGIN_BLOCKED');
  assert.match(r.detail, /PLUGIN_DSL_META/);
});

test('a hashed prep spec that skipped the builder fails host boot', { timeout: 30_000 }, async () => {
  const dir = pluginsDir({
    badkey: [{ permissions: ['dsl'], dsl: ['dsl/income.json'] }, { 'dsl/income.json': incomeSpec('badkey') }],
  });
  const contents = setsOf(dir);
  const r = contents.resolve(['badkey']);
  assert.ok(r.ok, JSON.stringify(r));
  contents.hold(r.set.cs);
  const files = contents.dataBytes(r.set.cs);
  const table = JSON.parse(Buffer.from(files.dsl).toString('utf8'));
  table.badkey[0].meta.key = 'effect:other:income';
  files.dsl = Buffer.from(JSON.stringify(table));
  const hashInput = JSON.parse(JSON.stringify(r.set.hashInput));
  hashInput.data.dsl = createHash('sha256').update(files.dsl).digest('hex');
  const cs = contentHashOf(hashInput);
  const child = fork(path.join(ROOT, 'server/match/host/entry.js'), [], {
    execArgv: ['--max-old-space-size=256'], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  try {
    const msg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host boot timed out')), 15_000);
      child.on('message', (m) => {
        if (m && (m.type === 'boot-error' || m.type === 'ready')) { clearTimeout(timer); resolve(m); }
      });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.send({ type: 'init', cs, hashInput, files, bounds: r.set.bounds, options: { heartbeatMs: 60_000 } });
    });
    assert.equal(msg.type, 'boot-error');
    assert.match(msg.error, /PLUGIN_DSL_META/);
  } finally {
    child.kill('SIGKILL');
  }
});

