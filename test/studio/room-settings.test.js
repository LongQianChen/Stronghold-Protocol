import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, bondPatch } from '../helpers/contentFixtures.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createRoomSets } from '../../server/plugins/roomSets.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { readStudioData } from '../../server/studio/gameData.js';
import { pluginStates } from '../../server/studio/watch.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { settingsSelection, settingValue, validSetting } from '../../public/js/ui/pluginSettings.js';

const defs = {
  on: { type: 'boolean', default: true },
  count: { type: 'integer', min: 0, max: 10, step: 2, default: 2 },
  defense: { type: 'number', min: 0, max: 1, step: 0.1, default: 0.1 },
  choice: { type: 'enum', options: ['one', 2, false], default: 'one' },
};
function setup(t) {
  const f = fixture(t);
  f.put('settings-test', { permissions: ['data.patch'], settings: defs, data: ['p.json'] }, { 'p.json': bondPatch({ $setting: 'defense' }) });
  const vanillaData = readStudioData(path.resolve('data'));
  const base = buildContentSet({ registry: f.registry, ids: [] });
  const contents = createContentSets({ registry: f.registry, vanillaData });
  const plugins = createRoomSets({ registry: f.registry, visual: null, contents, policy: null });
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, plugins, content: { cs: base.cs } });
  const player = name => { const s = registry.create(name); s.connected = true; s.messages = []; s.ws = { readyState: 1, bufferedAmount: 0, send: txt => s.messages.push(JSON.parse(txt)) }; return s; };
  const host = player('host'), guest = player('guest');
  assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  lobby.join(guest, { code: host.roomCode });
  const room = lobby.roomOf(host);
  t.after(() => { lobby.shutdown(); contents.close(); });
  return { ...f, base, contents, plugins, lobby, host, guest, room };
}

test('typed settings -> room.setPlugins -> normalizeSettings -> content data; guest sees same settings and original room bytes return', t => {
  const f = setup(t); const { lobby, host, guest, room, contents } = f;
  const vanilla = JSON.stringify(room.content);
  assert.equal(settingValue(defs.choice, '1'), 2); assert.equal(settingValue(defs.choice, '2'), false);
  assert.equal(settingValue(defs.on, false), false); assert.equal(validSetting(defs.count, 3), false);
  assert.equal(validSetting(defs.defense, 0.3), true);
  const chosen = settingsSelection(['settings-test'], [], { id: 'settings-test', settings: { on: false, count: 4, defense: 0.3, choice: 2, undeclared: 'dropped' } });
  assert.deepEqual(lobby.setPlugins(host, { plugins: chosen }), { ok: true });
  assert.equal(contents.dataOf(room.content.cs).bonds.deputShip.bb.base_def, 0.3);
  assert.deepEqual(room.content.plugins[0].settings, { on: false, count: 4, defense: 0.3, choice: 2 });
  assert.deepEqual(guest.messages.at(-1).content, host.messages.at(-1).content);
  const again = settingsSelection(['settings-test'], room.content.plugins);
  assert.equal(again[0].settings.defense, 0.3, 'toggle/reapply preserves values');
  lobby.setPlugins(host, { plugins: [{ id: 'settings-test', settings: { count: 3, defense: 5 } }] });
  assert.deepEqual(room.content.plugins[0].settings, { on: true, count: 2, defense: 0.1, choice: 'one' });
  assert.equal(lobby.setPlugins(guest, { plugins: [] }).error, 'NOT_HOST');
  lobby.setPlugins(host, { plugins: [] }); assert.equal(JSON.stringify(room.content), vanilla);
  const empty = buildContentSet({ registry: f.registry, ids: [] });
  assert.equal(empty.cs, f.base.cs);
  assert.ok(contentSetFiles(empty).get('index.json').body.equals(contentSetFiles(f.base).get('index.json').body));
});

test('content disk edits notify only the host once per held set, including during a match; watcher sees equal-length edits', t => {
  const f = setup(t); const { lobby, host, guest, room, registry, dir, contents } = f;
  lobby.setPlugins(host, { plugins: [{ id: 'settings-test' }] });
  const old = room.content.cs;
  host.messages.length = 0; guest.messages.length = 0;
  const before = pluginStates(registry);
  fs.writeFileSync(path.join(dir, 'plugins/settings-test/p.json'), JSON.stringify(bondPatch(0.4)));
  registry.rescan(); registry.rescan();
  assert.notEqual(pluginStates(registry).get('settings-test'), before.get('settings-test'));
  assert.equal(host.messages.filter(m => m.t === 'm.toast').length, 1);
  assert.equal(guest.messages.filter(m => m.t === 'm.toast').length, 0);
  assert.equal(room.content.cs, old); assert.equal(contents.dataOf(old).bonds.deputShip.bb.base_def, 0.1);
  lobby.setPlugins(host, { plugins: settingsSelection(['settings-test'], room.content.plugins) });
  assert.notEqual(room.content.cs, old);
  room.match = { dispose() {} };
  host.messages.length = 0;
  fs.writeFileSync(path.join(dir, 'plugins/settings-test/p.json'), JSON.stringify(bondPatch(0.5)));
  registry.rescan(); assert.equal(host.messages.filter(m => m.t === 'm.toast').length, 0);
  room.match = null; lobby.tellPluginsChanged(room); lobby.tellPluginsChanged(room);
  assert.equal(host.messages.filter(m => m.t === 'm.toast').length, 1);
});

test('content hot reload debounces source events, ignores sidecars, and notices same-length numeric edits', async t => {
  const { createPluginWatcher } = await import('../../server/studio/watch.js');
  const f = fixture(t);
  const dir = f.put('watched-data', { permissions: ['data.patch'], data: ['p.json'] }, { 'p.json': bondPatch(0.1) });
  let event;
  const seen = [];
  const watcher = createPluginWatcher({ pluginsDir: path.join(f.dir, 'plugins'), registry: f.registry, debounceMs: 10,
    watch: (_dir, _options, fn) => { event = fn; return { on() {}, close() {} }; }, onChange: ids => seen.push(ids) });
  t.after(() => watcher.stop()); watcher.start();
  const file = path.join(dir, 'p.json'); const size = fs.statSync(file).size;
  fs.writeFileSync(file, JSON.stringify(bondPatch(0.2))); assert.equal(fs.statSync(file).size, size);
  event('change','watched-data/.studio.json'); await new Promise(r => setTimeout(r, 25)); assert.deepEqual(seen, []);
  event('change','watched-data/p.json'); event('change','watched-data/p.json');
  await new Promise(r => setTimeout(r, 40)); assert.deepEqual(seen, [['watched-data']]);
});

test('visual and content notices use independent keys, and deferred names are merged', t => {
  const { lobby, host, guest, room } = setup(t);
  lobby.setPlugins(host, { plugins: [{ id: 'settings-test' }] });
  room.content = { ...room.content, vs: 'v'.repeat(64) };
  host.messages.length = 0; guest.messages.length = 0;
  for (const kind of ['visual', 'content']) {
    const hash = kind === 'visual' ? room.content.vs : room.content.cs;
    lobby.pluginsChanged(hash, [kind], kind); lobby.pluginsChanged(hash, [kind], kind);
  }
  assert.equal(host.messages.filter(m => m.t === 'm.toast').length, 2);
  assert.equal(guest.messages.filter(m => m.t === 'm.toast').length, 0);
  room.pluginNoticeKeys = {}; room.match = { dispose() {} }; host.messages.length = 0;
  lobby.pluginsChanged(room.content.vs, ['skin'], 'visual');
  lobby.pluginsChanged(room.content.cs, ['rules'], 'content');
  assert.deepEqual(room.pluginsChanged, ['skin', 'rules']);
  assert.equal(host.messages.length, 0);
  room.match = null; lobby.tellPluginsChanged(room);
  assert.equal(host.messages.length, 1);
  assert.match(JSON.stringify(host.messages[0]), /skin、rules/);
});
