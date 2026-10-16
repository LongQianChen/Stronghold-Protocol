import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { forkSandbox } from '../../server/match/host/childHost.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import { validateC2S } from '../../shared/protocol.js';
import { fixtureSet, fixtureSpec, scriptSet as makeScriptSet, operatorScript } from '../helpers/simHostFixture.js';

export function nodePort(child = false) {
  const worker = child ? forkSandbox(fileURLToPath(new URL('../helpers/simChildNode.mjs', import.meta.url)))
    : new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
  const port = { postMessage: m => child ? worker.send(m) : worker.postMessage(m), terminate: () => child ? worker.kill('SIGKILL') : worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data })); worker.on('error', e => port.onerror?.(e));
  if (child) worker.stderr.on('data', d => process.stderr.write(d));
  return port;
}
const remote = options => new WorkerSimHost({ workerFactory: () => nodePort(), ...options });
const local = () => new InPageSimHost({ loadSim: content => loadBrowserSim({ ...content, base: new URL('../../server/sim/', import.meta.url).href }) });

test('cold load has its own budget; install keeps the short watchdog; stop settles pending calls', async () => {
  const commands = [];
  let port, terminated = 0;
  const host = new WorkerSimHost({ timeoutMs: 30, loadTimeoutMs: 300, workerFactory: () => (port = {
    terminate: () => terminated++, postMessage: m => {
      commands.push(m.method);
      if (m.method === 'load') setTimeout(() => port.onmessage({ data: { id: m.id, value: { install: true } } }), 80);
    },
  }) });
  const start = performance.now();
  await assert.rejects(host.load('a', { cs: 'a', data: {} }), e => e.code === 'PLUGIN_WORKER_TIMEOUT');
  assert.deepEqual(commands, ['load', 'install']); assert.equal(terminated, 1);
  assert.ok(performance.now() - start >= 100);
  const another = new WorkerSimHost({ workerFactory: () => ({ terminate() {}, postMessage() {} }) });
  const waiting = assert.rejects(another.rpc('step', [8]), e => e.code === 'PLUGIN_WORKER_STOPPED');
  another.stop(); await waiting; assert.equal(another.pending.size, 0);
});

test('runner on a real Worker reports its simulated cs and cached detail stats; pause and clear preserve ownership', async t => {
  const set = fixtureSet(), spec = { ...fixtureSpec(), cs: set.cs }, sent = [];
  let now = 1000;
  const runner = createBattleRunner({ net: { on: () => () => {}, send: (kind, fields) => {
    assert.equal(validateC2S({ t: kind, ...fields }), null); sent.push({ kind, ...fields });
  }, request: (kind, fields) => { assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve(); } },
  store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
  createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {}, now: () => now, doc: null });
  t.after(() => runner.dispose());
  await runner.onStart({ battleId: 'probe', fieldId: 'n:p1', authoritative: true, spec });
  const e = runner._entries.get('probe'); assert.equal(e.host.remote, true); assert.equal(e.battle.step, undefined);
  runner.setPaused(true); now += 2000; runner._frame(); assert.equal(e.battle.tickCount, 0); runner.setPaused(false);
  for (let i = 0; i < 20 && !e.done; i++) {
    now += 1000; runner._frame();
    while (e.stepping) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(e.done, true);
  const results = sent.filter(m => m.kind === 'b.result'); assert.equal(results.length, 1); assert.equal(results[0].cs, set.cs);
  assert.ok(sent.some(m => m.kind === 'b.progress'));
  const id = runner.unitIdOf(1, 'p1'); assert.ok(id != null); assert.equal(runner.unitStats(id), null);
  while (e.host.statsPending.size) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runner.unitStats(id).id, id);
  runner.clear(); assert.equal(e.host.stopped, true); assert.equal(runner.state(), null);
});

test('data set: Worker and in-page snapshots/events/results match every batch; bounds, stats, owners', async t => {
  const a = local(), b = remote(); t.after(() => b.stop());
  const set = fixtureSet(), spec = fixtureSpec();
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  assert.equal(await b.rpc('bounds'), 120, 'Worker installed the official snapshot, not plugin data');
  assert.deepEqual(b.battle.snapshot(), a.battle.snapshot()); a.battle.drainEvents(); b.battle.drainEvents();
  while (!a.battle.finished) {
    const x = a.step(8, { slice: 3 }), y = await b.step(8, { slice: 3 });
    assert.deepEqual(y.snap, x.snap); assert.deepEqual(y.ev, x.ev); assert.deepEqual(y.slices, x.slices);
  }
  assert.deepEqual(b.compactResult(), a.compactResult({}));
  assert.equal(b.compactResult().errors, 0);
  assert.ok(b.compactResult().total > 0, 'fixture fields real scheduled enemies');
  assert.deepEqual(b.ownerOps('p1'), a.ownerOps('p1'));
  const id = a.battle.allyUnits[0].id;
  assert.deepEqual(await b.rpc('unitStats', [id]), a.unitStats(id));
  assert.equal(typeof globalThis.lockdown, 'undefined', 'data/vanilla never install SES in the main realm');
});

test('script operator: permission child and Worker have byte-identical ev/results', async t => {
  const a = new WorkerSimHost({ workerFactory: () => nodePort(true) }), b = remote(), native = remote();
  t.after(() => { a.stop(); b.stop(); native.stop(); });
  const set = makeScriptSet(operatorScript), spec = fixtureSpec();
  const nativeSet = makeScriptSet(operatorScript,'trusted');
  await native.load(nativeSet.cs,nativeSet);await native.start(spec);
  await a.load(set.cs, set); await b.load(set.cs, set); await a.start(spec); await b.start(spec);
  await a.step(1); await b.step(1);await native.step(1);
  const stats = await b.rpc('unitStats', [b.battle.allyUnits[0].id]);
  assert.ok(stats, 'script operator is in the battle');
  const vanilla = local(); await vanilla.load(set.cs, { ...set, scripts: [] }); vanilla.start(spec); vanilla.step(1);
  assert.notDeepEqual(stats, vanilla.unitStats(vanilla.battle.allyUnits[0].id), 'the sandbox kit really changes the operator');
  vanilla.stop();
  while (!a.battle.finished) {
    const x = await a.step(8), y = await b.step(8), z = await native.step(8);
    assert.equal(JSON.stringify(y.ev), JSON.stringify(x.ev)); assert.equal(JSON.stringify(y.snap), JSON.stringify(x.snap));
    assert.equal(JSON.stringify(z.ev),JSON.stringify(x.ev));assert.equal(JSON.stringify(z.snap),JSON.stringify(x.snap));
  }
  assert.equal(JSON.stringify(b.compactResult()), JSON.stringify(a.compactResult()));
  assert.equal(JSON.stringify(native.compactResult()),JSON.stringify(a.compactResult()));
});

test('runner: true infinite script and slow data step terminate, stop reports and request server takeover', { timeout: 15000 }, async t => {
  for (const scripts of [true, false]) {
    const set = { ...fixtureSet(), ...(scripts ? makeScriptSet('export default function(){while(true){}}') : { data: { ...fixtureSet().data, __slow: true } }) };
    const sent = [], toasts = [];
    const runner = createBattleRunner({ net: { on: () => () => {}, request: (kind, fields) => {
      assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve();
    } }, store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
    createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {},
    toast: text => toasts.push(text), now: () => Date.now(), doc: null });
    t.after(() => runner.dispose());
    let alive = 0; const pulse = setInterval(() => alive++, 30);
    const start = Date.now();
    await runner.onStart({ battleId: 'hang', fieldId: 'n:p1', authoritative: true, spec: { ...fixtureSpec(), cs: set.cs }, elapsed: scripts ? 0 : 3 });
    clearInterval(pulse);
    assert.ok(alive > 25, 'parent remains responsive'); assert.ok(Date.now() - start >= 1900);
    assert.equal(toasts.length, 1); assert.equal(sent.length, 1); assert.equal(sent[0].cs, undefined);
    assert.equal(runner.state(), null);
  }
});

test('Worker overhead budget (8-tick batches, 240 ticks)', async t => {
  const set = fixtureSet(), spec = fixtureSpec();
  const a = local(), b = remote(); t.after(() => b.stop());
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  const t0 = performance.now();
  for (let n = 0; n < 30; n++) { const p = a.step(8); p.snap; p.ev; }
  const localMs = performance.now() - t0, t1 = performance.now();
  for (let n = 0; n < 30; n++) await b.step(8);
  const remoteMs = performance.now() - t1;
  t.diagnostic(JSON.stringify({ ticks: 240, localMs, workerMs: remoteMs, overheadMsPerTick: (remoteMs - localMs) / 240 }));
  assert.ok(remoteMs < 2000, '240 ticks fit inside a batch watchdog budget on this fixture');
});
