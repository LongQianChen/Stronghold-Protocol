// test/studio/remove.test.js — the studio's 删除所选 (POST /studio/api/plugins/remove; DESIGN §32.14.34, docs/PLUGINS.md
// §15): each plugin folder named moves to plugins/_removed/<id>-<time>/ (nothing deleted: moving it back restores it) and
// the registry no longer lists it; several go at once; an id that is no plugin folder right inside plugins/ (an invalid id,
// a missing folder, another case of a name, a '_' or dot folder, a symbolic link), a plugin an open room uses — its match
// running too — and a move that fails are refused one by one with their codes, the others removed, and the answer is 200
// also when some or all are refused; the request needs the studio's key (the 404 page without the header, 403 with a
// wrong key) and a list it can read; the page hears the removed ids (the change event of the hot reload).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { REMOVE_MAX } from '../../server/studio/index.js';
import { PLUGIN_ERRORS } from '../../shared/plugins/errors.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { png, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Where a removed plugin went: _removed/<id>-<UTC YYYYMMDD-HHMMSS-mmm>, -2 … when taken. */
const stamped = (id) => new RegExp(`^_removed/${id}-\\d{8}-\\d{6}-\\d{3}(?:-\\d+)?$`);

describe('removing plugins in the studio', () => {
  let srv;
  let tmp;
  let plugins;
  /** The headers of a change: the studio's key, JSON. */
  let H;
  const open = [];
  const skin = (dir) => writePlugin(dir, cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(2, 2) });
  const post = async (body, headers = H) => {
    const r = await fetch(`${srv.url}/studio/api/plugins/remove`, { method: 'POST', headers, body: JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
  };
  const remove = (ids, headers = H) => post({ ids }, headers);
  const listed = async () => (await (await fetch(`${srv.url}/studio/api/plugins`)).json()).plugins.map((p) => p.id);
  const at = (to) => path.join(plugins, ...to.split('/'));
  const player = async (name) => {
    const c = await TestClient.connect(`${srv.url.replace('http', 'ws')}/ws`);
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-remove-'));
    plugins = path.join(tmp, 'plugins');
    for (const id of ['old-skin', 'pair-a', 'pair-b', 'ok-skin', 'room-skin', 'back-skin', 'stuck-skin', 'locked-skin', 'remove']) skin(path.join(plugins, id));
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, MatchClass: StubMatch });
    H = { 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' };
  });
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    await srv?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('a plugin folder moves to plugins/_removed/<id>-<time>/ with every file, and the registry no longer lists it; moved back under its id, it is there again', async () => {
    assert.equal(srv.packs.plugin('old-skin')?.status, 'loaded');
    const r = await remove(['old-skin']);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.refused, []);
    assert.deepEqual(r.body.removed.map((x) => x.id), ['old-skin']);
    const { to } = r.body.removed[0];
    assert.match(to, stamped('old-skin'), 'relative to plugins/: no absolute path in the answer');
    assert.equal(fs.existsSync(path.join(plugins, 'old-skin')), false);
    assert.deepEqual(fs.readdirSync(at(to)).sort(), ['a.png', 'plugin.json'], 'nothing deleted');
    assert.equal(srv.packs.plugin('old-skin'), null, 'the registry read the folders at once');
    assert.equal((await listed()).includes('old-skin'), false);
    assert.equal((await listed()).includes('_removed'), false, 'plugins/_removed/ is no plugin');
    // restored: the folder moved back and named by its id again
    fs.renameSync(at(to), path.join(plugins, 'old-skin'));
    srv.packs.rescan();
    assert.equal(srv.packs.plugin('old-skin')?.status, 'loaded');
    assert.equal((await listed()).includes('old-skin'), true);
  });

  test('several at once, in their order; an id named twice counts once; the limit is in /studio/api/info', async () => {
    const r = await remove(['pair-b', 'pair-a', 'pair-b']);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.removed.map((x) => x.id), ['pair-b', 'pair-a']);
    assert.deepEqual(r.body.refused, []);
    for (const x of r.body.removed) {
      assert.match(x.to, stamped(x.id));
      assert.ok(fs.existsSync(path.join(at(x.to), 'plugin.json')), x.to);
    }
    const ids = await listed();
    assert.deepEqual([ids.includes('pair-a'), ids.includes('pair-b')], [false, false]);
    assert.deepEqual([srv.packs.plugin('pair-a'), srv.packs.plugin('pair-b')], [null, null]);
    const info = await (await fetch(`${srv.url}/studio/api/info`, { headers: H })).json();
    assert.equal(info.limits.removeMax, REMOVE_MAX);
  });

  test('refused one by one, the others removed — an invalid id, a missing folder, another case of a name, a "_" or dot folder, a symbolic link: 200 with each code, nothing of them touched', async () => {
    fs.mkdirSync(path.join(plugins, '_keep'));
    fs.writeFileSync(path.join(plugins, '_keep', 'notes.txt'), 'x');
    fs.mkdirSync(path.join(plugins, '.hidden'));
    skin(path.join(plugins, 'Mixed-Case'));
    const target = skin(path.join(tmp, 'linked-target'));
    fs.symlinkSync(target, path.join(plugins, 'linked-skin'));
    srv.packs.rescan();
    const r = await remove(['Bad_ID', '../old-skin', 'nope-skin', 'mixed-case', '_keep', '.hidden', 'linked-skin', 'ok-skin']);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.removed.map((x) => x.id), ['ok-skin']);
    assert.deepEqual(r.body.refused.map((x) => [x.id, x.error]), [
      ['Bad_ID', 'PLUGIN_ID'], ['../old-skin', 'PLUGIN_ID'], ['nope-skin', 'PLUGIN_UNKNOWN'], ['mixed-case', 'PLUGIN_UNKNOWN'],
      ['_keep', 'PLUGIN_ID'], ['.hidden', 'PLUGIN_ID'], ['linked-skin', 'PLUGIN_STUDIO_PATH'],
    ]);
    assert.deepEqual(r.body.refused[2].params, { id: 'nope-skin' });
    assert.match(r.body.refused[6].params.detail, /symbolic link/);
    for (const x of r.body.refused) assert.ok(PLUGIN_ERRORS[x.error], `${x.error}: the error catalogue explains it`);
    assert.ok(fs.existsSync(path.join(plugins, '_keep', 'notes.txt')));
    assert.ok(fs.statSync(path.join(plugins, '.hidden')).isDirectory());
    assert.ok(fs.existsSync(path.join(plugins, 'Mixed-Case', 'plugin.json')), 'another case of the name is not that plugin (a case-insensitive disk)');
    assert.ok(fs.lstatSync(path.join(plugins, 'linked-skin')).isSymbolicLink(), 'the link stays where it was');
    assert.deepEqual(fs.readdirSync(target).sort(), ['a.png', 'plugin.json'], 'nothing of its target moved');
    assert.ok(fs.existsSync(path.join(plugins, 'old-skin', 'plugin.json')), '../old-skin never reaches old-skin');
    // every one refused: 200 all the same, nothing removed
    const none = await remove(['nope-skin', 'linked-skin']);
    assert.deepEqual([none.status, none.body.removed, none.body.refused.map((x) => x.error)], [200, [], ['PLUGIN_UNKNOWN', 'PLUGIN_STUDIO_PATH']]);
    fs.rmSync(path.join(plugins, 'linked-skin'));
    fs.rmSync(path.join(plugins, 'Mixed-Case'), { recursive: true });
    srv.packs.rescan();
  });

  test('a plugin an open room uses is refused (PLUGIN_STUDIO_IN_USE: the room, its match running too), and goes once the room is gone', async () => {
    const host = await player('Saria');
    assert.equal((await host.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
    const s0 = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'room-skin' }] })).t, 'ok');
    await host.waitFor('room.state', (s) => !!s.content?.plugins?.some((p) => p.id === 'room-skin'));
    let r = await remove(['room-skin', 'back-skin']);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.removed.map((x) => x.id), ['back-skin'], 'the others still go');
    assert.deepEqual(r.body.refused, [{ id: 'room-skin', error: 'PLUGIN_STUDIO_IN_USE', params: { id: 'room-skin', rooms: s0.code, matches: 0 } }]);
    assert.ok(fs.existsSync(path.join(plugins, 'room-skin', 'plugin.json')));
    assert.equal(srv.packs.plugin('room-skin')?.status, 'loaded');
    // its match running
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    await host.waitFor('room.state', (s) => s.inMatch === true);
    r = await remove(['room-skin']);
    assert.deepEqual(r.body.refused.map((x) => [x.error, x.params.rooms, x.params.matches]), [['PLUGIN_STUDIO_IN_USE', s0.code, 1]]);
    assert.ok(fs.existsSync(path.join(plugins, 'room-skin', 'plugin.json')));
    // the room gone (its only player left): nothing uses it now
    assert.equal((await host.request({ t: 'room.leave' })).t, 'ok');
    r = await remove(['room-skin']);
    assert.deepEqual([r.body.removed.map((x) => x.id), r.body.refused], [['room-skin'], []]);
  });

  test('the studio\'s gate and key: a forwarded public client, no header or another origin get the 404 page, a wrong key 403 PLUGIN_STUDIO_KEY — nothing moved', async () => {
    const JSONH = { 'content-type': 'application/json' };
    assert.equal((await remove(['stuck-skin'], { ...H, 'x-forwarded-for': '203.0.113.9' })).status, 404, 'this machine and the LAN only, whatever the key');
    assert.equal((await remove(['stuck-skin'], JSONH)).status, 404);
    assert.equal((await remove(['stuck-skin'], { ...H, origin: 'http://evil.example.com' })).status, 404);
    const wrong = await remove(['stuck-skin'], { ...JSONH, 'x-sp-studio': 'A'.repeat(22) });
    assert.deepEqual([wrong.status, wrong.body.error], [403, 'PLUGIN_STUDIO_KEY']);
    assert.ok(fs.existsSync(path.join(plugins, 'stuck-skin', 'plugin.json')));
  });

  test('a request it cannot read: 400 PLUGIN_STUDIO_REQUEST — no list, an empty one, more than REMOVE_MAX, a value that is no text; nothing moved', async () => {
    const many = Array.from({ length: REMOVE_MAX + 1 }, (_, i) => `p-${i}`);
    for (const body of [{}, { ids: [] }, { ids: 'stuck-skin' }, { ids: ['stuck-skin', 7] }, { ids: many }]) {
      const r = await post(body);
      assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_REQUEST'], JSON.stringify(body).slice(0, 60));
    }
    const notJson = await fetch(`${srv.url}/studio/api/plugins/remove`, { method: 'POST', headers: H, body: '{ nope' });
    assert.equal(notJson.status, 400);
    assert.ok(fs.existsSync(path.join(plugins, 'stuck-skin', 'plugin.json')));
  });

  test('a move that fails is refused alone (PLUGIN_STUDIO_REMOVE): plugins/_removed a symbolic link is never written through', async () => {
    const removed = path.join(plugins, '_removed');
    const kept = path.join(tmp, 'removed-kept');
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    if (fs.existsSync(removed)) fs.renameSync(removed, kept);
    fs.symlinkSync(elsewhere, removed);
    try {
      const r = await remove(['stuck-skin']);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { removed: [], refused: [{ id: 'stuck-skin', error: 'PLUGIN_STUDIO_REMOVE', params: { id: 'stuck-skin', detail: 'plugins/_removed is not a real folder' } }] });
      assert.ok(fs.existsSync(path.join(plugins, 'stuck-skin', 'plugin.json')));
      assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing went through the link');
    } finally {
      fs.rmSync(removed);
      if (fs.existsSync(kept)) fs.renameSync(kept, removed);
    }
  });

  test('a file system error answers with its code only — never the message, which names the absolute path', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs a folder the server cannot write' }, async () => {
    fs.chmodSync(plugins, 0o555);
    let r;
    try { r = await remove(['locked-skin']); } finally { fs.chmodSync(plugins, 0o755); }
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.refused, [{ id: 'locked-skin', error: 'PLUGIN_STUDIO_REMOVE', params: { id: 'locked-skin', detail: 'EACCES' } }]);
    assert.doesNotMatch(JSON.stringify(r.body), /\//, 'no path in the answer');
    assert.ok(fs.existsSync(path.join(plugins, 'locked-skin', 'plugin.json')));
  });

  test('the page hears the removed ids (the change event of the hot reload); a plugin named "remove" keeps its own routes', async () => {
    const own = await fetch(`${srv.url}/studio/api/plugins/remove`);
    assert.equal(own.status, 200);
    assert.equal((await own.json()).id, 'remove', 'GET …/plugins/remove is the plugin "remove"');
    const ctrl = new AbortController();
    const res = await fetch(`${srv.url}/studio/api/events`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    let text = '';
    let pending = null;
    const until = async (re) => {
      for (let i = 0; i < 50 && !re.test(text); i++) {
        pending ||= reader.read();
        const got = await Promise.race([pending, sleep(200).then(() => null)]);
        if (got) { pending = null; if (got.value) text += Buffer.from(got.value).toString('utf8'); }
      }
    };
    try {
      await until(/event: hello/);
      const r = await remove(['remove', 'stuck-skin']);
      assert.deepEqual(r.body.removed.map((x) => x.id), ['remove', 'stuck-skin']);
      await until(/"stuck-skin"/);
      assert.match(text, /event: change\ndata: \{"ids":\[[^\]]*"remove"[^\]]*"stuck-skin"[^\]]*\]\}/);
    } finally { ctrl.abort(); }
  });
});
