import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { forkSandbox } from '../../server/match/host/childHost.js';
import { escapeCases } from '../helpers/sandboxCases.js';
import { sha256Hex, utf8 } from '../../shared/sha256.js';
import {spawnSync} from 'node:child_process';

const entry = fileURLToPath(new URL('../helpers/sandboxProbe.mjs', import.meta.url));
async function child(t) {
  const c = forkSandbox(entry, { memoryMb: 64 });
  t.after(() => c.kill('SIGKILL'));
  let stderr = '';
  c.stderr.on('data', x => { stderr += x; });
  const boot = await Promise.race([once(c, 'message').then(([x]) => x), once(c, 'exit').then(() => { throw Error(stderr); })]);
  assert.equal(boot.ready, true); assert.equal(boot.permission, true);
  return { c, ask: async msg => { const answer = once(c, 'message'); c.send(msg); return (await answer)[0]; } };
}
const plugin = files => ({ id: 'probe', class: 'script', entry: 'main.js', files: Object.fromEntries(Object.entries(files).map(([p, s]) => {
  const bytes = utf8(s); return [p, { sha256: sha256Hex(bytes), bytes: [...bytes] }];
})) });

test('eval control requires successful evaluation, not just Compartment construction',()=>{
  const source=`import {initializeSandbox,createPluginCompartment} from './shared/plugins/sandbox.js';
    await initializeSandbox({loadSES:()=>import('ses')});
    const c=createPluginCompartment({});
    try {console.log(JSON.stringify({value:c.evaluate('1+1')}));}catch(e){console.log(JSON.stringify({error:e.name}));}`;
  for(const flags of [[],['--disallow-code-generation-from-strings']]) {
    const r=spawnSync(process.execPath,[...flags,'--input-type=module','-e',source],{encoding:'utf8',timeout:5000});
    assert.equal(r.status,0,r.stderr);
    assert.deepEqual(JSON.parse(r.stdout),flags.length?{error:'EvalError'}:{value:2});
  }
});

test('SES escape corpus inside Node 22 --permission child; IPC and denied OS operations', { timeout: 15000 }, async t => {
  const { ask } = await child(t);
  for (const [label, source, expected] of escapeCases) {
    const r = await ask({ source });
    if (expected === 'throws') assert.equal(r.ok, false, label); else assert.deepEqual(r, { ok: true, value: expected }, label);
  }
  assert.deepEqual((await ask({ probePermissions: true })).value, { write: true, read: true, spawn: true, ipc: true });
  assert.deepEqual((await ask({ probeSdk:true })).value, {refused:true,frozen:true,listFrozen:true,live:true,originalUntouched:true});
  assert.equal((await ask({probeLength:true})).error.code,'PLUGIN_SANDBOX_LIMIT','reject length before reading/copying bytes');
});

test('hashed module graph, own relative imports and SDK only; isolated compartments and detmath', { timeout: 15000 }, async t => {
  const { ask } = await child(t);
  const p = plugin({ 'main.js': "import { sp } from 'sp:sdk@1'; import { n } from './lib.js'; export default function setup(api) { sp.capture(n + Math.pow(3, 2)); }", 'lib.js': 'export const n = 7;' });
  assert.deepEqual(await ask({ plugin: p }), { ok: true, value: 16 });
  p.files['lib.js'].bytes[0]++;
  assert.equal((await ask({ plugin: p })).error.code, 'PLUGIN_SANDBOX_HASH');
  for (const path of ['node:fs', '/sim/spec.js', 'https://evil.test/a.js', '../escape.js', './missing.js']) {
    assert.equal((await ask({ plugin: plugin({ 'main.js': `import x from '${path}'; export default function() {}` }) })).error.code, 'PLUGIN_SANDBOX_IMPORT');
  }
  const trusted = plugin({ 'main.js': 'export default function(){}' }); trusted.class = 'trusted';
  assert.equal((await ask({ plugin: trusted })).error.code, 'PLUGIN_SANDBOX_CLASS');
  for (const source of ["export default async function(){}", "export default function(){ import('./x.js'); }", 'export default function(){ return 2 ** 0.5; }']) {
    assert.equal((await ask({ plugin: plugin({ 'main.js': source }) })).error.code, 'PLUGIN_SANDBOX_SYNTAX');
  }
  const dm = await import('../../server/sim/detmath.js');
  assert.deepEqual((await ask({ source: '[Math.sin(0.7),Math.cos(0.7),Math.atan2(2,3),Math.hypot(3,4),Math.pow(1.2,3)]' })).value,
    [dm.sin(0.7),dm.cos(0.7),dm.atan2(2,3),dm.hypot(3,4),dm.powi(1.2,3)]);
  assert.equal((await ask({ source: 'Math.pow(2,0.5)' })).error.code, 'PLUGIN_SANDBOX_MATH');
});

test('non-returning script is killed by 2 s watchdog; allocation bomb dies alone at heap cap', { timeout: 20000 }, async t => {
  const first = await child(t);
  const before = Date.now();
  const exited = once(first.c, 'exit');
  first.c.send({ plugin: plugin({ 'main.js': 'export default function(){ while(true){} }' }) });
  const timer = setTimeout(() => first.c.kill('SIGKILL'), 2000);
  const [, signal] = await exited; clearTimeout(timer);
  assert.equal(signal, 'SIGKILL'); assert.ok(Date.now() - before >= 1900);
  const second = await child(t);
  const died = once(second.c, 'exit');
  second.c.send({ source: 'const keep=[]; while(true) keep.push(new Array(1000000).fill(1))' });
  const guard = setTimeout(() => second.c.kill('SIGKILL'), 8000);
  const [code, memorySignal] = await died; clearTimeout(guard);
  assert.ok(code !== 0 || memorySignal); assert.notEqual(memorySignal, 'SIGKILL', 'heap limit acts before timeout');
});
