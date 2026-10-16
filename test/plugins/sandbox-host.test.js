import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createMatchHosts } from '../../server/match/host/index.js';
import { getData } from '../../server/data.js';
import { scriptSet } from '../helpers/simHostFixture.js';

function composition(source, data = { bonds: {} }) {
  const set = scriptSet(source, 'sandbox', data);
  const files = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  return { cs:set.cs, contents: { get: () => set, dataBytes: () => files } };
}
test('sandbox gate is off by default, rejects trusted; script hosts force permission child, watchdog ends matches', { timeout: 10000 }, async t => {
  const old = process.env.SP_PLUGIN_SCRIPTS;
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = old; });
  delete process.env.SP_PLUGIN_SCRIPTS;
  const set = composition('export default function(){ while(true){} }');
  const opts = { transport: 'worker', heartbeatMs: 50, watchdogMs: 1500,
    matchModule: fileURLToPath(new URL('../../server/match/StubMatch.js', import.meta.url)) };
  const hosts = createMatchHosts({ contents: set.contents, options: opts }); t.after(() => hosts.close());
  assert.throws(() => hosts.create(set.cs, {}), e => e.code === 'PLUGIN_SANDBOX_DISABLED');
  process.env.SP_PLUGIN_SCRIPTS = 'sandbox';
  set.contents.get().scripts[0].class = 'trusted';
  assert.throws(() => hosts.create(set.cs, {}), e => /mode mismatch/.test(e.message));
  set.contents.get().scripts[0].class = 'script';
  let finish;
  const ended = new Promise(resolve => { finish = resolve; });
  const messages = [];
  const proxy = hosts.create(set.cs, { roomCode: 'TEST', cs: set.cs, requireCs: true,
    send: () => {}, broadcast: m => messages.push(m), onEnd: finish });
  assert.equal(hosts._host(set.cs).transport, 'process');
  assert.ok(hosts._host(set.cs).child.spawnargs.includes('--permission'));
  proxy.start();
  const timer = setTimeout(() => finish({ reason: 'test-timeout' }), 7000);
  const result = await ended; clearTimeout(timer);
  assert.equal(result.reason, 'plugin-hang');
  assert.ok(messages.some(m => m.t === 'm.toast'));
  assert.equal(proxy.ended, true, 'onEnd is the lobby return path');
  assert.equal(hosts.stats().workers, 0);
});


test('SES child boots the real Match and finishes an all-bot game without engine errors', { timeout: 90000 }, async t => {
  const old = process.env.SP_PLUGIN_SCRIPTS;
  process.env.SP_PLUGIN_SCRIPTS = 'sandbox';
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = old; });
  const set = composition(`export default function setup(sp) {
    sp.content.register({install(b){b.on('battleStart',()=>{for(const u of b.allyUnits)b.addBuff(u,{key:'training',mods:{atkFlat:2}});});}});
    sp.meta.register('global:training',{onRoundStart(ctx){ctx.addFunds(1);}});
  }`, getData());
  const hosts = createMatchHosts({ contents: set.contents, options: { virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  t.after(() => hosts.close());
  let done;
  const end = new Promise(resolve => { done = resolve; });
  const match = hosts.create(set.cs, { cs: set.cs, requireCs: true, roomCode: 'TEST', mode: 'coop', difficulty: 'NORMAL',
    modeId: 'mode_multi_normal', seed: 7, matchNo: 1, spectators: [],
    seats: Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: 'bot_' + seat, name: 'Bot', isBot: true, connected: true })),
    send: () => {}, broadcast: () => {}, onEnd: done });
  match.start();
  const result = await end;
  assert.equal(typeof result.victory, 'boolean', JSON.stringify(result));
  const d = await match.diag();
  assert.equal(d.errorCount, 0, JSON.stringify(d.errors));
  assert.equal(d.cs, set.cs);
});
