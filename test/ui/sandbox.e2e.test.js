// SP_E2E=1 node --test test/ui/sandbox.e2e.test.js
// Real Chrome Workers, Node permission child, production SDK and descriptors. No official art fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { createStaticHandler } from '../../server/http/static.js';
import { createRequestHandler } from '../../server/http/routes.js';
import { siteCsp, SIM_WORKER_CSP } from '../../server/http/csp.js';
import { forkSandbox } from '../../server/match/host/childHost.js';
import { fixtureSet, fixtureSpec, scriptSet as makeScriptSet, operatorScript } from '../helpers/simHostFixture.js';
import {scriptUrl} from '../../shared/plugins/scriptLoad.js';

const enabled = process.env.SP_E2E === '1' && hasChrome();
test('Chrome: CSP, escape corpus, real Worker data/script determinism, 2 s takeover, no page freeze', { skip: !enabled, timeout: 120000 }, async t => {
  let networkHits = 0;
  const nativeScriptSet = makeScriptSet(operatorScript,'trusted');
  const nativePlugin = nativeScriptSet.scripts[0];
  const root = path.resolve('.');
  const staticFiles = createStaticHandler({ publicDir: path.join(root, 'public'), sharedDir: path.join(root, 'shared'), dataDir: path.join(root, 'data') });
  const handler = createRequestHandler({ csp: siteCsp(path.join(root, 'public')), health: {}, log: console,
    serveStatic: async (req, res, url, query) => {
      if (url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sandbox tests</title>'); return; }
      if (url === '/probe-network') { networkHits++; res.end('unexpected'); return; }
      if (url === scriptUrl(nativeScriptSet.cs,nativePlugin.id,'main.js')) {
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(nativePlugin.browserSources['main.js']);return;
      }
      // Test-only endpoints; the production static server never serves test/ or this adapter.
      const fixtures = ['simWorkerBrowser.js', 'simSandboxFixture.js', 'sandboxCases.js'];
      const rel = url.replace('/test/helpers/', '');
      if (fixtures.includes(rel) && url === '/test/helpers/' + rel) {
        res.setHeader('Content-Security-Policy', query === 'no-eval' ? SIM_WORKER_CSP.replace(" 'unsafe-eval'", '') : SIM_WORKER_CSP);
        res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(path.join(root, 'test/helpers', rel))); return;
      }
      await staticFiles(req, res, url.startsWith('/public/') ? url.slice('/public'.length) : url, query);
    } });
  const server = http.createServer(handler);
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.ok(!response.headers()['content-security-policy'].includes('unsafe-eval'));
  await page.evaluate(async () => {
    const { WorkerSimHost, InPageSimHost } = await import('/js/battle/simHost.js');
    window.hostTypes = { WorkerSimHost, InPageSimHost };
    window.makeHost = (testWorker = false, suffix = '') => new WorkerSimHost(testWorker ? {
      workerFactory: () => new Worker('/test/helpers/simWorkerBrowser.js' + suffix, { type: 'module' }),
    } : {});
  });
  const escape = await page.evaluate(async () => { const h = window.makeHost(true); try { return await h.rpc('escapes'); } finally { h.stop(); } });
  for (const x of escape) assert.equal(x.value, x.expected, x.label);
  assert.equal(await page.evaluate(async () => { const h = window.makeHost(true); try { return await h.rpc('network'); } finally { h.stop(); } }), 'blocked');
  assert.equal(networkHits, 0, 'Worker response CSP blocks even same-origin fetch');
  assert.equal(await page.evaluate(async () => { const h = window.makeHost(true); try { return await h.rpc('evaluate',['1+1']); } finally { h.stop(); } }), 2);
  assert.equal(await page.evaluate(async () => {
    const h = window.makeHost(true, '?no-eval'); try { return await h.rpc('evaluate',['1+1']); } catch { return 'blocked'; } finally { h.stop(); }
  }), 'blocked', 'SES evaluation needs unsafe-eval on Worker response');

  const set = fixtureSet(), spec = fixtureSpec();
  const dataComparison = await page.evaluate(async ({ set, spec }) => {
    const worker = window.makeHost(), local = new window.hostTypes.InPageSimHost();
    try {
      await worker.load(set.cs, set); await local.load(set.cs, set); await worker.start(spec); local.start(spec);
      worker.battle.drainEvents(); local.battle.drainEvents();
      let identical = true;
      while (!local.battle.finished) {
        const a = await worker.step(8), b = local.step(8);
        identical &&= JSON.stringify(a.ev) === JSON.stringify(b.ev) && JSON.stringify(a.snap) === JSON.stringify(b.snap);
      }
      return { identical, result: JSON.stringify(worker.compactResult()) === JSON.stringify(local.compactResult({})),
        noEngine: !worker.battle.step && !worker.battle.data, noLockdown: typeof lockdown === 'undefined' };
    } finally { worker.stop(); local.stop(); }
  }, { set, spec });
  assert.deepEqual(dataComparison, { identical: true, result: true, noEngine: true, noLockdown: true });

  const scriptSet = makeScriptSet(operatorScript);
  const child = forkSandbox(fileURLToPath(new URL('../helpers/simChildNode.mjs', import.meta.url)));
  t.after(() => child.kill('SIGKILL'));
  let seq = 0;
  const ask = async (method, args) => { const reply = once(child, 'message'); child.send({ id: ++seq, method, args }); const [r] = await reply; assert.ok(!r.error, JSON.stringify(r.error)); return r.value; };
  const ready = await ask('load', [scriptSet]); if (ready.install) await ask('install', []); await ask('start', [spec]);
  const trace = [];
  for (;;) { const p = await ask('step', [8, {}]); trace.push({ ev: p.ev, snap: p.snap, result: p.result }); if (p.state.finished) break; }
  const browserTrace = await page.evaluate(async ({ set, spec }) => {
    const h = window.makeHost(), trace = [];
    try { await h.load(set.cs, set); await h.start(spec); do { const p = await h.step(8); trace.push({ ev: p.ev, snap: p.snap, result: p.result }); } while (!h.battle.finished); return trace; }
    finally { h.stop(); }
  }, { set: scriptSet, spec });
  assert.equal(JSON.stringify(browserTrace), JSON.stringify(trace), 'Node child / Chrome Worker bit-identical events and result');
  const nativeTrace = await page.evaluate(async ({set,spec})=>{
    const {checkBrowserScripts} = await import('/shared/plugins/scriptLoad.js');
    await checkBrowserScripts(set.scripts,set.cs);
    const h = new window.hostTypes.InPageSimHost(),trace=[];
    try {
      await h.load(set.cs,{...set,nativeVerified:true});h.start(spec);h.battle.drainEvents();
      do {const p=h.step(8);trace.push({ev:p.ev,snap:p.snap,result:h.battle.finished?h.compactResult({battleId:spec.battleId,bossLike:false}):null});}while(!h.battle.finished);
      return trace;
    }finally{h.stop();}
  },{set:nativeScriptSet,spec});
  assert.equal(JSON.stringify(nativeTrace),JSON.stringify(trace),'trusted native / sandbox child / Chrome Worker have identical events and results');

  for (const dataLoop of [false, true]) {
    const bad = { ...set, ...(dataLoop ? { data: { ...set.data, __slow: true } } : makeScriptSet('export default function(){while(true){}}')) };
    const result = await page.evaluate(async ({ set, spec, dataLoop }) => {
      const [{ createBattleRunner }, { createStore, initialState }] = await Promise.all([import('/js/battle/runner.js'), import('/js/store.js')]);
      const sent = [], toasts = [];
      let pulses = 0; const pulse = setInterval(() => pulses++, 30);
      const runner = createBattleRunner({ store: createStore(initialState), doc: null, net: { on: () => () => {}, request: (t, m) => { sent.push({ t, ...m }); return Promise.resolve(); } },
        contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64), toast: text => toasts.push(text),
        createHost: (_, onFailure) => new window.hostTypes.WorkerSimHost({ workerFactory: () => new Worker('/test/helpers/simWorkerBrowser.js', { type: 'module' }), onFailure }) });
      const start = performance.now();
      try {
        await runner.onStart({ battleId: 'hang', fieldId: 'n:p1', authoritative: true, elapsed: dataLoop ? 3 : 0, spec: { ...spec, cs: set.cs } });
        return { pulses, ms: performance.now() - start, sent, toasts, state: runner.state() };
      } finally { clearInterval(pulse); runner.dispose(); }
    }, { set: bad, spec, dataLoop });
    assert.ok(result.pulses > 25); assert.ok(result.ms >= 1900 && result.ms < 7000);
    assert.equal(result.sent.length, 1); assert.equal(result.sent[0].t, 'b.result'); assert.equal(result.sent[0].cs, undefined);
    assert.deepEqual(result.toasts, ['插件卡死，本场由服务器接管']); assert.equal(result.state, null);
  }
  assert.deepEqual(errors, []);
});
