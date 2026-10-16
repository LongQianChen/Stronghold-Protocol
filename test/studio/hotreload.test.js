// test/studio/hotreload.test.js — hot reload of plugins while the studio is in use (DESIGN §32.9; server/studio/watch.js,
// server/lobby.js refreshPlugins): a file of a plugin changes on disk (the studio's write or an author's own tool) → the
// watch (fs.watch, gathered over 300 ms) → registry.rescan() → the visual sets see the set a room holds changed → a room
// whose host is the author (a game session the studio's page named) or whose host is its only player applies the same
// plugins again at once — a new `vs` in room.state, during a match too, nobody told or un-readied — and any other room's
// host is told as in P1a (one toast, the panel's 「重新应用」). A server whose studio was never opened keeps P1a's behaviour.
// The studio's page hears the change (server-sent events, the ids that changed).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createPluginWatcher, treeWithin } from '../../server/studio/watch.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { png, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const TOAST = '房间插件「{names}」的文件在服务器上变了，请在插件面板中点「重新应用」';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the watch: a change in a plugin folder → one rescan after the quiet time → the ids whose state changed; dot files never count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-watch-'));
  const plugins = path.join(dir, 'plugins');
  writePlugin(path.join(plugins, 'skin'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(2, 2) });
  writePlugin(path.join(plugins, 'other'), cosmetic({ assets: { chars: { char_112_siege: { avatar: 'b.png' } } } }), { 'b.png': png(2, 2) });
  const registry = createPluginRegistry({ publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'), packsDir: path.join(dir, 'packs'), pluginsDir: plugins }, { recheckMs: 60000 });
  registry.refresh(true);
  const seen = [];
  const w = createPluginWatcher({ pluginsDir: plugins, registry, debounceMs: 150, onChange: (ids) => seen.push(ids) });
  try {
    assert.equal(w.start(), true, 'fs.watch runs on this platform');
    fs.writeFileSync(path.join(plugins, 'skin', '.swap.tmp'), 'x');
    await sleep(500);
    assert.deepEqual(seen, [], 'a dot file is no change');
    fs.writeFileSync(path.join(plugins, 'skin', 'a.png'), png(3, 3));
    for (let i = 0; i < 40 && !seen.length; i++) await sleep(100);
    assert.deepEqual(seen, [['skin']], 'the plugin whose state changed, once');
    // a plugin broken on disk shows as changed too (now skipped)
    fs.writeFileSync(path.join(plugins, 'other', 'plugin.json'), '{ broken');
    for (let i = 0; i < 40 && seen.length < 2; i++) await sleep(100);
    assert.deepEqual(seen[1], ['other']);
    assert.ok(registry.report().skipped.some((k) => k.where === 'plugins/other/'));
  } finally { w.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the watch: a plugins folder over the entry limit is not watched as a tree (links not followed in the count)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-watch-big-'));
  const plugins = path.join(dir, 'plugins');
  writePlugin(path.join(plugins, 'skin'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(2, 2) });
  fs.symlinkSync(dir, path.join(plugins, 'loop')); // a link back up: never followed by the count
  const registry = createPluginRegistry({ publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'), packsDir: path.join(dir, 'packs'), pluginsDir: plugins }, { recheckMs: 60000 });
  const warns = [];
  const w = createPluginWatcher({ pluginsDir: plugins, registry, log: { warn: (m) => warns.push(m) }, maxEntries: 2 });
  try {
    assert.deepEqual([treeWithin(plugins, 100), treeWithin(plugins, 2)], [true, false]);
    assert.equal(w.start(), false);
    assert.equal(w.active, false);
    assert.match(warns.join('\n'), /more than 2 entries: not watched/);
  } finally { w.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

describe('rooms follow a plugin changed on disk', () => {
  let srv;
  let tmp;
  let plugins;
  const open = [];
  const player = async (name) => {
    const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  const room = async (host, mode) => {
    assert.equal((await host.request({ t: 'room.create', mode, difficulty: 'NORMAL' })).t, 'ok');
    return host.waitFor('room.state', (s) => s.hostId === host.id);
  };
  const withSet = async (host, id) => {
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id }] })).t, 'ok');
    return (await host.waitFor('room.state', (s) => !!s.content?.vs)).content.vs;
  };
  const touch = (id, n) => fs.writeFileSync(path.join(plugins, id, 'a.png'), png(n, n, [n * 10, 0, 0, 255]));
  // the studio's calls carry its key (server/studio/key.js) — the first one turns the studio on (activate)
  const studio = (url, body) => fetch(srv.url + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json());

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-hotreload-'));
    plugins = path.join(tmp, 'plugins');
    for (const id of ['solo-skin', 'coop-skin', 'match-skin', 'quiet-skin', 'mend-skin']) writePlugin(path.join(plugins, id), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(2, 2) });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, MatchClass: StubMatch });
  });
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    await srv?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('before the studio is opened nothing changes by itself (P1a): the host of a single-player room is told', async () => {
    const host = await player('Ptilopsis');
    await room(host, 'solo');
    const vs = await withSet(host, 'quiet-skin');
    host.clearInbox();
    touch('quiet-skin', 3);
    srv.packs.rescan();
    const toast = await host.waitFor('m.toast', (m) => m.msgid === TOAST, 3000);
    assert.equal(toast.params?.names, 'quiet-skin');
    assert.equal(srv.lobby.rooms.values().next().value.content.vs, vs, 'the set stays until the host applies it again');
    assert.equal(srv.studio.active, false);
    // a visit without the studio's key (the page itself, a read, a picture of another site) turns nothing on
    for (const u of ['/studio/', '/studio/api/plugins', '/studio/api/info']) assert.equal((await fetch(srv.url + u)).status, 200, u);
    assert.equal(srv.studio.active, false, 'only a request with the key starts the watch');
  });

  test('a single-player room applies a change by itself: a new vs, no toast', async () => {
    assert.ok((await studio('/studio/api/info')).templates, 'the studio is opened');
    assert.equal(srv.studio.active, true);
    const host = await player('Saria');
    await room(host, 'solo');
    const vs = await withSet(host, 'solo-skin');
    host.clearInbox();
    touch('solo-skin', 4);
    const next = await host.waitFor('room.state', (s) => s.content?.vs && s.content.vs !== vs, 5000);
    assert.deepEqual(next.content.plugins.map((p) => p.id), ['solo-skin']);
    assert.equal(next.content.cs, srv.content.cs, 'art never changes a battle: the vanilla cs');
    await host.expectNone('m.toast', (m) => m.msgid === TOAST, 300);
  });

  test('a co-op room: its host is told — until the studio\'s page names the host\'s session; then it applies by itself', async () => {
    const host = await player('Ifrit');
    const guest = await player('Silence');
    const s0 = await room(host, 'coop');
    assert.equal((await guest.request({ t: 'room.join', code: s0.code })).t, 'ok');
    const vs = await withSet(host, 'coop-skin');
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    host.clearInbox();
    touch('coop-skin', 5);
    await host.waitFor('m.toast', (m) => m.msgid === TOAST, 5000);
    assert.equal([...srv.lobby.rooms.values()].find((r) => r.code === s0.code).content.vs, vs, 'not applied: the host is not the author');
    // the studio's page names the host's game session (localStorage sp.tokens of the same browser): the change the host
    // was told about applies at once, and every later one by itself
    host.clearInbox();
    guest.clearInbox();
    assert.deepEqual(await studio('/studio/api/authors', { tokens: [host.token, 'not-a-token'] }), { players: 1 });
    const now = await guest.waitFor('room.state', (s) => s.content?.vs && s.content.vs !== vs, 5000);
    touch('coop-skin', 6);
    const next = await guest.waitFor('room.state', (s) => s.content?.vs && s.content.vs !== now.content.vs, 5000);
    assert.equal(next.seats.find((x) => x && x.playerId === guest.id).ready, true, 'nobody un-readied');
    await host.expectNone('m.toast', (m) => m.msgid === TOAST, 300);
  });

  test('during a match too: the room\'s state carries the new set while the match runs', async () => {
    const host = await player('Mudrock');
    await room(host, 'solo');
    const vs = await withSet(host, 'match-skin');
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    await host.waitFor('room.state', (s) => s.inMatch === true);
    host.clearInbox();
    touch('match-skin', 7);
    const next = await host.waitFor('room.state', (s) => s.content?.vs && s.content.vs !== vs, 5000);
    assert.equal(next.inMatch, true);
  });

  test('a plugin broken for a moment while its author saves it, then mended: the single-player room follows the mended one', async () => {
    const host = await player('Kroos');
    await room(host, 'solo');
    const vs = await withSet(host, 'mend-skin');
    host.clearInbox();
    // broken: the set no longer resolves — the host is told (once: the visual sets tell a held set once)
    fs.writeFileSync(path.join(plugins, 'mend-skin', 'plugin.json'), '{ broken');
    await host.waitFor('m.toast', (m) => m.msgid === TOAST, 5000);
    // mended (and a new picture): the room applies it by itself all the same
    fs.writeFileSync(path.join(plugins, 'mend-skin', 'plugin.json'), JSON.stringify(cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } })));
    touch('mend-skin', 9);
    const next = await host.waitFor('room.state', (s) => s.content?.vs && s.content.vs !== vs, 5000);
    assert.deepEqual(next.content.plugins.map((p) => p.id), ['mend-skin']);
  });

  test('the studio\'s page hears which plugins changed (server-sent events)', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${srv.url}/studio/api/events`, { signal: ctrl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body.getReader();
    let text = '';
    // one read in flight at a time (a read that lost a race to the timer still holds the next chunk)
    let pending = null;
    const until = async (re) => {
      for (let i = 0; i < 60 && !re.test(text); i++) {
        pending ||= reader.read();
        const r = await Promise.race([pending, sleep(200).then(() => null)]);
        if (r) { pending = null; if (r.value) text += Buffer.from(r.value).toString('utf8'); }
      }
    };
    await until(/event: hello/);
    touch('quiet-skin', 8);
    await until(/event: change/);
    ctrl.abort();
    assert.match(text, /event: change\ndata: \{"ids":\["quiet-skin"\]\}/);
  });
});
