// test/plugins/visualSet.test.js — the visual sets of a server and the files of cosmetic plugins (DESIGN §32 P1a,
// server/plugins/visualSet.js, server/http/static.js /vs/ and /p/): a set resolved for a room or a player (loaded
// cosmetic plugins of the scope, their requirements switched on, in load order, within the size limit — refused
// otherwise), its vs stable for the same files and new for one changed byte; GET /vs/<vs16>/overlay.json — the set's
// composition, which a browser's check accepts, and each plugin's writes (no URL, no copy of the art manifest), which a
// page composes on the served manifest it loaded (its /assets/~<hash>/ URLs); GET /p/<id>/<hash8>/<path> — only a file
// an overlay names
// (never plugin.json, the lock, a document, a dot file, a path out of the folder or a link out of it), `immutable` at
// the hash of its bytes (its own, or its Spine model's), the current file with `no-cache` at any other — and the
// vanilla /data/assets.json unchanged by any plugin. Art is generated on the spot (test/helpers/pluginFixtures.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createVisualSets } from '../../server/plugins/visualSet.js';
import { createStaticHandler } from '../../server/http/static.js';
import { CompressCache } from '../../server/http/files.js';
import { createAssetIndex } from '../../server/http/assetIndex.js';
import { createManifestViews } from '../../server/http/assetViews.js';
import { splitUrl } from '../../server/http/common.js';
import { checkVisualDoc, layVisualOps, prepareVisualDoc, visualHashOf, modelHashOf, VISUAL_LIMITS } from '../../shared/plugins/visual.js';
import { main as pluginTool } from '../../tools/plugin.mjs';
import { png, skel, atlas, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** A checkout-shaped root: two operators' art in public/assets, the manifest naming them, and cosmetic plugins. */
function exampleRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-visual-'));
  const put = (rel, body) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  put('public/assets/char/avatar/char_102_texas.png', png(2, 2, [10, 10, 10, 255]));
  put('public/assets/char/avatar/char_112_siege.png', png(2, 2, [20, 20, 20, 255]));
  put('public/assets/ui/hp.png', png(2, 2, [30, 30, 30, 255]));
  put('data/assets.json', JSON.stringify({
    version: 1, hash: 'testhash', chars: {
      char_102_texas: { avatar: '/assets/char/avatar/char_102_texas.png' },
      char_112_siege: { avatar: '/assets/char/avatar/char_112_siege.png' },
    }, ui: { 'hudPanel/icon_hp': '/assets/ui/hp.png' },
  }));
  fs.mkdirSync(path.join(root, 'packs'));
  const plugins = path.join(root, 'plugins');
  writePlugin(path.join(plugins, 'red'), cosmetic({ authors: ['tester'], assets: {
    chars: { char_102_texas: { avatar: 'art/red.png', spine: { front: { skel: 'spine/t/t.skel' } } }, char_x_new: { ref: 'char_112_siege' } },
    ui: { 'hudPanel/icon_hp': { ref: 'hudPanel/icon_hp' } },
  }, permissions: ['assets.override', 'assets.add'] }), {
    'art/red.png': png(4, 4, [255, 0, 0, 255]), 'spine/t/t.skel': skel(), 'spine/t/t.atlas': atlas(['t.png']), 'spine/t/t.png': png(4, 4),
    'art/unused.png': png(1, 1), 'README.md': '# red\n', 'notes.txt': 'notes',
  });
  writePlugin(path.join(plugins, 'blue'), cosmetic({ loadAfter: ['red'], assets: { chars: { char_102_texas: { avatar: 'blue.png' } } } }), { 'blue.png': png(4, 4, [0, 0, 255, 255]) });
  writePlugin(path.join(plugins, 'needs-red'), cosmetic({ requires: { red: '^1.0.0' }, assets: { chars: { char_112_siege: { avatar: 'g.png' } } } }), { 'g.png': png(4, 4, [0, 255, 0, 255]) });
  writePlugin(path.join(plugins, 'mine'), cosmetic({ scope: ['personal'], app: '<0.1.0', assets: { chars: { char_112_siege: { avatar: 'm.png' } } } }), { 'm.png': png(4, 4, [9, 9, 9, 255]) });
  writePlugin(path.join(plugins, 'nope'), cosmetic({ conflicts: { blue: '*' }, assets: { chars: { char_112_siege: { avatar: 'n.png' } } } }), { 'n.png': png(4, 4) });
  writePlugin(path.join(plugins, 'gameplay'), { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', permissions: ['data.patch'], data: ['d.json'] }, { 'd.json': { patch: 1, ops: [] } });
  writePlugin(path.join(plugins, 'tunes'), cosmetic({ permissions: ['assets.add'], assets: { audio: { sfx: { ui: { click: 'v/click.mp3' } },
    voice: { char_102_texas: { select: ['v/both.mp3', 'v/both.ogg'] } } } } }), {
    'v/click.mp3': Buffer.from('ID3 a click, not really mp3'), 'v/both.mp3': Buffer.from('ID3 the mp3 one'), 'v/both.ogg': Buffer.from('OggS the ogg one'),
  });
  return root;
}

describe('the visual sets of a server', () => {
  let root;
  let registry;
  let visual;
  let assetIndex;
  let server;
  const get = (rawPath, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  const json = async (p) => { const r = await get(p); assert.equal(r.status, 200, `${p}: ${r.status}`); return JSON.parse(r.body.toString('utf8')); };

  before(async () => {
    root = exampleRoot();
    // the Spine model needs its lock (tools/plugin.mjs pack): written like an author would
    const log = console.log;
    console.log = () => {};
    try { assert.equal(await pluginTool(['pack', path.join(root, 'plugins', 'red'), '--root', root]), 0); } finally { console.log = log; }
    const dirs = { publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins') };
    registry = createPluginRegistry(dirs, { recheckMs: 0 });
    assetIndex = createAssetIndex({ publicDir: dirs.publicDir, delayMs: 0, cacheFile: null });
    assetIndex.start();
    await assetIndex.whenReady();
    const views = createManifestViews({ dataDir: dirs.dataDir, index: assetIndex });
    await views.rebuildAll();
    visual = createVisualSets({ registry });
    const serveStatic = createStaticHandler({ ...dirs, sharedDir: path.join(ROOT, 'shared'), packs: registry, views, assetIndex, visual });
    server = http.createServer((req, res) => { const p = splitUrl(req.url); serveStatic(req, res, p.rawPath, p.query).catch(() => res.destroy()); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    assetIndex.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('resolve: loaded cosmetic plugins of the scope, requirements switched on, load order, warnings — or refused', () => {
    const one = visual.resolve(['red']);
    assert.equal(one.ok, true, JSON.stringify(one));
    assert.deepEqual(one.set.plugins.map((p) => [p.id, p.version, p.class, typeof p.hash, p.auto]), [['red', '1.0.0', 'cosmetic', 'string', undefined]]);
    assert.equal(one.set.vs, registry.plugin('red').visual.vs, 'a set of one plugin is the vs the catalogue names');
    const two = visual.resolve(['blue', 'red']);
    assert.deepEqual(two.set.plugins.map((p) => p.id), ['red', 'blue'], 'blue loads after red');
    assert.deepEqual(two.set.warnings, [{ code: 'override', params: { path: 'chars.char_102_texas.avatar', plugins: ['red', 'blue'] } }]);
    assert.equal(two.set.bytes, registry.plugin('red').visual.bytes + registry.plugin('blue').visual.bytes);
    const auto = visual.resolve(['needs-red']);
    assert.deepEqual(auto.set.plugins.map((p) => [p.id, !!p.auto]), [['red', true], ['needs-red', false]]);
    assert.equal(visual.resolve(['red']).set.vs, one.set.vs, 'the same plugins → the same vs');
    const refuse = (ids, scope) => { const r = visual.resolve(ids, { scope }); return [r.error, r.detail]; };
    assert.equal(refuse(['absent'])[0], 'PLUGIN_UNKNOWN');
    assert.match(refuse(['gameplay']).join(' '), /^PLUGIN_BLOCKED gameplay is not a cosmetic plugin of scope room/);
    assert.equal(refuse(['mine'])[0], 'PLUGIN_BLOCKED', 'a personal-only plugin is no room plugin');
    assert.equal(refuse(['nope', 'blue'])[0], 'PLUGIN_CONFLICT');
    const personal = visual.resolve(['mine'], { scope: 'personal' });
    assert.deepEqual(personal.set.warnings, [{ code: 'app', params: { id: 'mine', app: '<0.1.0' } }], 'made for other versions: a cosmetic plugin is only warned about');
    const tight = createVisualSets({ registry, limits: { ...VISUAL_LIMITS, setBytes: 100 } });
    assert.equal(tight.resolve(['red']).error, 'PLUGIN_LIMIT');
  });

  test('GET /vs/<vs16>/overlay.json: the composition and each plugin\'s writes (no URL); composed on the served manifest, the installation\'s URLs keep their hash segment', async () => {
    const { set } = visual.resolve(['red', 'blue']);
    const url = `/vs/${set.vs.slice(0, 16)}/overlay.json`;
    const r = await get(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.headers['content-type'], /^application\/json/);
    const doc = JSON.parse(r.body.toString('utf8'));
    assert.equal(checkVisualDoc(doc, set.vs), null, 'its composition hashes to the room\'s vs');
    assert.deepEqual(doc.visual.overlays.map((o) => o.id), ['red', 'blue']);
    assert.deepEqual(doc.writes.map((w) => w.id), ['red', 'blue']);
    assert.deepEqual(Object.keys(doc).sort(), ['visual', 'writes'], 'no copy of the art manifest');
    assert.doesNotMatch(JSON.stringify(doc.writes), /\/p\/|\/assets\//, 'paths of the folders and references, never a URL');
    assert.ok(r.body.length < 4096, `a few KB, not the manifest (${r.body.length} bytes)`);
    // what a page draws: the document composed on the manifest it loaded (the served view)
    const view = JSON.parse((await get('/data/assets.json')).body.toString('utf8'));
    assert.match(view.chars.char_112_siege.avatar, /^\/assets\/~[0-9a-f]{16}\/char\/avatar\/char_112_siege\.png$/, 'the served manifest (0.2.6)');
    const prep = prepareVisualDoc(doc);
    assert.equal(prep.droppedCount, 0, prep.dropped.join('; '));
    const m = layVisualOps(view, [prep]).manifest;
    const blue = registry.plugin('blue').visual.served.get('blue.png');
    assert.equal(m.chars.char_102_texas.avatar, `/p/blue/${blue.sha256.slice(0, 8)}/blue.png`, 'the later plugin applies');
    assert.equal(m.chars.char_112_siege.avatar, view.chars.char_112_siege.avatar, 'an entry no plugin changes is the served one');
    assert.deepEqual(m.chars.char_x_new, view.chars.char_112_siege, 'a whole-record reference copies the page\'s entry');
    assert.equal(m.ui['hudPanel/icon_hp'], view.ui['hudPanel/icon_hp']);
    const front = m.chars.char_102_texas.spine.front;
    const red = registry.plugin('red').visual;
    const mh = modelHashOf(['spine/t/t.skel', 'spine/t/t.atlas', 'spine/t/t.png'].map((rel) => red.served.get(rel).sha256)).slice(0, 8);
    assert.deepEqual([front.skel, front.atlas, front.textures], [`/p/red/${mh}/spine/t/t.skel`, `/p/red/${mh}/spine/t/t.atlas`, [`/p/red/${mh}/spine/t/t.png`]]);
    assert.deepEqual([front.anims.idle, front.anims.attack.loop, front.hits, front.animations.Attack], ['Idle', 'Attack', { Attack: [0.5] }, 0.5], 'the clip data from the lock');
    // every URL it builds is one /p/ serves immutably
    for (const u of prep.urls) assert.equal((await get(u)).headers['cache-control'], 'public, max-age=31536000, immutable', u);
    // a document whose writes were changed on the way (another file of the same table to the same slot) is refused
    const tampered = JSON.parse(JSON.stringify(doc));
    tampered.writes[1].ops[0] = { ...tampered.writes[1].ops[0], file: 'blue.png', at: ['chars', 'char_112_siege', 'avatar'] };
    assert.match(String(checkVisualDoc(tampered, set.vs)), /writes of blue are not the ones its vs names/);
    // revalidated with its ETag
    assert.equal((await get(url, { 'If-None-Match': r.headers.etag })).status, 304);
    for (const p of [`/vs/${set.vs.slice(0, 16)}/assets.json`, `/vs/${'0'.repeat(16)}/overlay.json`, `/vs/${set.vs}/overlay.json`, `/vs/${set.vs.slice(0, 16)}/other.json`, '/vs/']) assert.equal((await get(p)).status, 404, p);
  });

  test('a set a room holds is never dropped; the others beyond the limit are; a document is built once however many ask', async () => {
    // (sets of two plugins or more: the set of one plugin alone is the catalogue's and always known)
    const small = createVisualSets({ registry, maxSets: 1 });
    const room = small.resolve(['red', 'blue']).set.vs;
    small.hold(room);
    const other = small.resolve(['needs-red']).set.vs;
    small.resolve(['needs-red', 'blue']);
    assert.notEqual(await small.doc(room.slice(0, 16)), null, 'held: still served');
    assert.equal(await small.doc(other.slice(0, 16)), null, 'neither held nor recent: dropped (404)');
    assert.deepEqual([small.stats().held, small.stats().sets], [1, 2]);
    small.release(room);
    small.resolve(['needs-red']);
    small.resolve(['needs-red', 'blue']);
    assert.equal(await small.doc(room.slice(0, 16)), null, 'released: dropped like any other');
    // two requests at once: one build, the same body
    const vs = small.resolve(['blue', 'red']).set.vs;
    const [a, b] = await Promise.all([small.doc(vs.slice(0, 16)), small.doc(vs.slice(0, 16))]);
    assert.ok(a && a === b);
  });

  test('what a set\'s references copy out of the manifest is capped (PLUGIN_LIMIT)', () => {
    const tight = createVisualSets({ registry, limits: { ...VISUAL_LIMITS, setCopyBytes: 10 } });
    const r = tight.resolve(['red']);
    assert.deepEqual([r.error, /references copy/.test(r.detail)], ['PLUGIN_LIMIT', true]);
    assert.ok(registry.plugin('red').visual.copyBytes > 10, 'red copies an entry through its references');
    assert.equal(tight.resolve(['blue']).ok, true, 'a plugin without references copies nothing');
  });

  test('a plugin\'s own set (the catalogue\'s vs) is served without anybody resolving it: a personal plugin\'s overlay', async () => {
    const cat = await json('/plugins/index.json');
    const mine = cat.plugins.find((p) => p.id === 'mine');
    assert.deepEqual([mine.status, mine.unofficial, mine.scope, typeof mine.vs, mine.artBytes], ['loaded', true, ['personal'], 'string', registry.plugin('mine').visual.bytes]);
    assert.equal(cat.plugins.find((p) => p.id === 'gameplay').vs, undefined, 'only a loaded cosmetic plugin has one');
    const doc = await json(`/vs/${mine.vs.slice(0, 16)}/overlay.json`);
    assert.equal(checkVisualDoc(doc, mine.vs), null);
    assert.deepEqual(doc.writes, [{ id: 'mine', ops: [{ at: ['chars', 'char_112_siege', 'avatar'], file: 'm.png' }] }]);
    assert.match(layVisualOps({}, [prepareVisualDoc(doc)]).manifest.chars.char_112_siege.avatar, /^\/p\/mine\/[0-9a-f]{8}\/m\.png$/);
  });

  test('GET /p/: only a file an overlay names, immutable at the hash of its bytes (its own or its model\'s), no-cache at another', async () => {
    const red = registry.plugin('red').visual;
    const avatar = red.served.get('art/red.png');
    const own = avatar.sha256.slice(0, 8);
    const r = await get(`/p/red/${own}/art/red.png`);
    assert.deepEqual([r.status, r.headers['cache-control'], r.headers['content-type'], r.headers.etag], [200, 'public, max-age=31536000, immutable', 'image/png', `"${avatar.sha256.slice(0, 16)}"`]);
    assert.equal(sha(r.body), avatar.sha256, 'the very bytes');
    const mh = modelHashOf(['spine/t/t.skel', 'spine/t/t.atlas', 'spine/t/t.png'].map((rel) => red.served.get(rel).sha256)).slice(0, 8);
    for (const rel of ['spine/t/t.skel', 'spine/t/t.atlas', 'spine/t/t.png']) assert.equal((await get(`/p/red/${mh}/${rel}`)).headers['cache-control'], 'public, max-age=31536000, immutable', rel);
    const other = await get('/p/red/00000000/art/red.png');
    assert.deepEqual([other.status, other.headers['cache-control']], [200, 'no-cache'], 'another hash: the current file, revalidated');
    assert.equal((await get(`/p/red/${own}/art/red.png`, { 'If-None-Match': r.headers.etag })).status, 304);
    // never served: what the overlay does not name, the manifest, the lock, documents, dot files, paths out of the folder
    const refused = ['/p/red/00000000/plugin.json', '/p/red/00000000/plugin.lock.json', '/p/red/00000000/README.md', '/p/red/00000000/notes.txt',
      '/p/red/00000000/art/unused.png', '/p/red/00000000/.hidden.png', '/p/red/00000000/../red/art/red.png', '/p/red/00000000/art/%2e%2e/plugin.json',
      '/p/red/00000000/art%2f..%2f..%2fplugin.json', '/p/red/0000000/art/red.png', '/p/red/abcdefgz/art/red.png', '/p/Red/00000000/art/red.png',
      '/p/absent/00000000/x.png', '/p/gameplay/00000000/d.json', '/p/red/00000000/', '/p/red/', '/p/', '/p/red/00000000/art/red.png%00'];
    for (const p of refused) assert.ok([400, 403, 404].includes((await get(p)).status), `${p} must not be served`);
    assert.equal((await get('/p/red/00000000/art%5cred.png')).status, 400, 'a backslash is no path');
  });

  test('GET /p/: a plugin\'s audio without its extension too (download managers, public/js/media.js) — the listed file of that name the hash names', async () => {
    const tunes = registry.plugin('tunes').visual;
    const click = tunes.served.get('v/click.mp3');
    const r = await get(`/p/tunes/${click.sha256.slice(0, 8)}/v/click`);
    assert.deepEqual([r.status, r.headers['content-type'], r.headers['cache-control']], [200, 'audio/mpeg', 'public, max-age=31536000, immutable']);
    assert.equal(sha(r.body), click.sha256);
    const mp3 = tunes.served.get('v/both.mp3');
    const ogg = tunes.served.get('v/both.ogg');
    const o = await get(`/p/tunes/${ogg.sha256.slice(0, 8)}/v/both`);
    assert.deepEqual([o.status, o.headers['content-type'], sha(o.body)], [200, 'audio/ogg', ogg.sha256], 'two of one name: the one the hash names');
    assert.equal(sha((await get(`/p/tunes/${mp3.sha256.slice(0, 8)}/v/both`)).body), mp3.sha256);
    const other = await get('/p/tunes/00000000/v/both');
    assert.deepEqual([other.status, other.headers['cache-control']], [200, 'no-cache'], 'a hash naming neither: the current .mp3, revalidated');
    for (const p of ['/p/tunes/00000000/v/nothing', '/p/red/00000000/art/red', '/p/tunes/00000000/v/click.png', '/p/tunes/00000000/v/']) assert.equal((await get(p)).status, 404, `${p}: only an audio file of the overlay`);
  });

  test('GET /p/: a link put in place of a served file after the scan, leading out of the folder, is not followed', async (t) => {
    const outside = path.join(root, 'secret.png');
    fs.writeFileSync(outside, 'not for players');
    const target = path.join(root, 'plugins', 'blue', 'blue.png');
    const saved = fs.readFileSync(target);
    const h = registry.plugin('blue').visual.served.get('blue.png').sha256.slice(0, 8);
    fs.rmSync(target);
    try {
      fs.symlinkSync(outside, target);
    } catch {
      fs.writeFileSync(target, saved);
      t.skip('no symbolic links on this file system');
      return;
    }
    try {
      assert.equal((await get(`/p/blue/${h}/blue.png`)).status, 404);
    } finally {
      fs.rmSync(target, { force: true });
      fs.writeFileSync(target, saved);
    }
  });

  test('GET /p/: a link put in place of a served file after the scan is never followed, even one to a file of the folder; nor one in place of a folder on its way', async (t) => {
    const red = registry.plugin('red').visual;
    const own = red.served.get('art/red.png').sha256.slice(0, 8);
    const dir = path.join(root, 'plugins', 'red');
    const target = path.join(dir, 'art', 'red.png');
    const saved = fs.readFileSync(target);
    fs.writeFileSync(path.join(dir, '.secret'), 'SECRET-DOTFILE-BYTES');
    fs.rmSync(target);
    try {
      fs.symlinkSync(path.join(dir, '.secret'), target);
    } catch {
      fs.writeFileSync(target, saved);
      fs.rmSync(path.join(dir, '.secret'), { force: true });
      t.skip('no symbolic links on this file system');
      return;
    }
    try {
      const r = await get(`/p/red/${own}/art/red.png`);
      assert.equal(r.status, 404, 'a link to a dot file of the folder');
      assert.doesNotMatch(r.body.toString('utf8'), /SECRET/);
      fs.rmSync(target);
      fs.symlinkSync(path.join(dir, 'art', 'unused.png'), target);
      assert.equal((await get(`/p/red/${own}/art/red.png`)).status, 404, 'a link to another file of the folder');
    } finally {
      fs.rmSync(target, { force: true });
      fs.writeFileSync(target, saved);
      fs.rmSync(path.join(dir, '.secret'), { force: true });
    }
    // a folder on the way: spine/t moved aside and a link to it put in its place — the files are the same bytes, but
    // their real path is not the one the scan hashed
    const mh = modelHashOf(['spine/t/t.skel', 'spine/t/t.atlas', 'spine/t/t.png'].map((rel) => red.served.get(rel).sha256)).slice(0, 8);
    fs.renameSync(path.join(dir, 'spine', 't'), path.join(dir, 'spine', 't-moved'));
    try {
      fs.symlinkSync(path.join(dir, 'spine', 't-moved'), path.join(dir, 'spine', 't'));
      assert.equal((await get(`/p/red/${mh}/spine/t/t.png`)).status, 404);
    } finally {
      fs.rmSync(path.join(dir, 'spine', 't'), { force: true });
      fs.renameSync(path.join(dir, 'spine', 't-moved'), path.join(dir, 'spine', 't'));
    }
    registry.rescan();
    assert.equal((await get(`/p/red/${mh}/spine/t/t.png`)).status, 200, 'the real folder back: served again');
  });

  test('a changed byte: the old hash serves the new file with no-cache; once the folders are read again, a new vs and an immutable URL', async () => {
    const before = registry.plugin('blue').visual;
    const old = before.served.get('blue.png');
    const set0 = visual.resolve(['blue']).set;
    const file = path.join(root, 'plugins', 'blue', 'blue.png');
    fs.writeFileSync(file, png(4, 4, [0, 0, 254, 255]));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const r = await get(`/p/blue/${old.sha256.slice(0, 8)}/blue.png`);
    assert.deepEqual([r.status, r.headers['cache-control']], [200, 'no-cache'], 'served, but never as immutable under the old hash');
    assert.equal(sha(r.body), sha(fs.readFileSync(file)));
    registry.rescan();
    const now = registry.plugin('blue').visual;
    assert.notEqual(now.served.get('blue.png').sha256, old.sha256);
    const set1 = visual.resolve(['blue']).set;
    assert.notEqual(set1.vs, set0.vs, 'one changed byte → another vs');
    assert.equal(set1.vs, visualHashOf({ assets: registry.vanillaAssets().sha256, overlays: [now.composition] }));
    assert.equal((await get(`/p/blue/${now.served.get('blue.png').sha256.slice(0, 8)}/blue.png`)).headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  test('a file rewritten with its old size and mtime put back (rsync -t, touch -r) is no longer the hashed one: no-cache, a rescan, then a new vs', async () => {
    // a registry that trusts its last look for a while (the server's own: 1 s) — the request itself finds the change
    const dirs = { publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins') };
    const slow = createPluginRegistry(dirs, { recheckMs: 600000 });
    const slowSets = createVisualSets({ registry: slow });
    const serve = createStaticHandler({ ...dirs, sharedDir: path.join(ROOT, 'shared'), packs: slow, visual: slowSets });
    const s2 = http.createServer((req, res) => { const u = splitUrl(req.url); serve(req, res, u.rawPath, u.query).catch(() => res.destroy()); });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const getFrom = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: s2.address().port, path: p, agent: false }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    try {
      const file = path.join(root, 'plugins', 'blue', 'blue.png');
      const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 60000);
      fs.utimesSync(file, T, T);
      slow.rescan();
      const scanned = slow.plugin('blue').visual.served.get('blue.png');
      assert.equal(scanned.mtimeMs, T.getTime(), 'the scan recorded that mtime');
      const set0 = slowSets.resolve(['blue']).set;
      // other pixels of the same size (a deflated PNG's length depends on its pixels)
      let bytes = null;
      for (let c = 1; c < 255 && !bytes; c++) { const b = png(4, 4, [0, 0, c, 255]); if (b.length === scanned.bytes && sha(b) !== scanned.sha256) bytes = b; }
      assert.ok(bytes, 'a PNG of the same size');
      fs.writeFileSync(file, bytes);
      fs.utimesSync(file, T, T);
      assert.deepEqual([fs.statSync(file).size, fs.statSync(file).mtimeMs], [scanned.bytes, scanned.mtimeMs], 'size and mtime as scanned');
      assert.notEqual(sha(bytes), scanned.sha256);
      let noted = 0;
      slowSets.noteChanged = () => { noted++; };
      const r = await getFrom(`/p/blue/${scanned.sha256.slice(0, 8)}/blue.png`);
      assert.deepEqual([r.status, r.headers['cache-control']], [200, 'no-cache'], 'never immutable: its ctime (and maybe inode) changed');
      assert.notEqual(r.headers.etag, `"${scanned.sha256.slice(0, 16)}"`, 'never the old content hash as its ETag');
      assert.equal(sha(r.body), sha(bytes), 'the current bytes');
      assert.equal(noted, 1, 'the registry is asked to read the folders again');
      slow.rescan();
      const now = slow.plugin('blue').visual.served.get('blue.png');
      assert.equal(now.sha256, sha(bytes), 'hashed again, though its size and mtime look unchanged');
      assert.notEqual(slowSets.resolve(['blue']).set.vs, set0.vs, 'another vs');
      assert.equal((await getFrom(`/p/blue/${now.sha256.slice(0, 8)}/blue.png`)).headers['cache-control'], 'public, max-age=31536000, immutable');
    } finally {
      await new Promise((r) => s2.close(r));
      registry.rescan();
    }
  });

  test('a quiet rewrite (size and mtime put back) is noticed by the folders\' own check — no /p/ request needed', () => {
    const file = path.join(root, 'plugins', 'mine', 'm.png');
    const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 90000);
    fs.utimesSync(file, T, T);
    registry.rescan();
    const before = registry.plugin('mine').visual.served.get('m.png');
    let bytes = null;
    for (let c = 1; c < 255 && !bytes; c++) { const b = png(4, 4, [c, 9, 9, 255]); if (b.length === before.bytes && sha(b) !== before.sha256) bytes = b; }
    assert.ok(bytes, 'a PNG of the same size');
    fs.writeFileSync(file, bytes);
    fs.utimesSync(file, T, T);
    // no rescan(), no request: the registry's look at its folders (here on every call: recheckMs 0) sees the new ctime
    const now = registry.plugin('mine').visual.served.get('m.png');
    assert.equal(now.sha256, sha(bytes), 'hashed again');
    assert.notEqual(registry.plugin('mine').visual.vs, null);
  });

  test('the compressed-body cache tells a file rewritten with its old size and mtime from the old one (its inode, its ctime)', async () => {
    const file = path.join(root, 'rewritten.atlas');
    const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 120000);
    fs.writeFileSync(file, 'A'.repeat(2000));
    fs.utimesSync(file, T, T);
    const cache = new CompressCache();
    assert.equal(zlib.gunzipSync(await cache.get(file, fs.statSync(file), 'gzip')).toString()[0], 'A');
    fs.writeFileSync(file, 'B'.repeat(2000));
    fs.utimesSync(file, T, T);
    const st = fs.statSync(file);
    assert.deepEqual([st.size, st.mtimeMs], [2000, T.getTime()], 'size and mtime as before');
    assert.equal(zlib.gunzipSync(await cache.get(file, st, 'gzip')).toString()[0], 'B', 'the new bytes, not the cached old ones');
  });

  test('a plugins folder spelled in another case than on disk (macOS, Windows) still serves its files', async (t) => {
    const alt = path.join(path.dirname(root), path.basename(root).toUpperCase());
    if (alt === root || !fs.existsSync(path.join(alt, 'plugins'))) { t.skip('a case-sensitive file system'); return; }
    const dirs = { publicDir: path.join(alt, 'public'), dataDir: path.join(alt, 'data'), packsDir: path.join(alt, 'packs'), pluginsDir: path.join(alt, 'plugins') };
    const reg = createPluginRegistry(dirs, { recheckMs: 0 });
    const serve = createStaticHandler({ ...dirs, sharedDir: path.join(ROOT, 'shared'), packs: reg, visual: createVisualSets({ registry: reg }) });
    const s2 = http.createServer((req, res) => { const u = splitUrl(req.url); serve(req, res, u.rawPath, u.query).catch(() => res.destroy()); });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    try {
      const f = reg.plugin('red').visual.served.get('art/red.png');
      const status = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: s2.address().port, path: `/p/red/${f.sha256.slice(0, 8)}/art/red.png`, agent: false }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
      });
      assert.equal(status, 200, 'the scan and the request read the real path the same way (the native realpath)');
    } finally { await new Promise((r) => s2.close(r)); }
  });

  test('no plugin changes the vanilla manifest a page loads (/data/assets.json is the served view as without plugins)', async () => {
    const withPlugins = await get('/data/assets.json');
    const plain = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(ROOT, 'shared'),
      packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'no-plugins'), views: createManifestViews({ dataDir: path.join(root, 'data'), index: assetIndex }), assetIndex });
    const s2 = http.createServer((req, res) => { const p = splitUrl(req.url); plain(req, res, p.rawPath, p.query); });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    try {
      const body = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: s2.address().port, path: '/data/assets.json', agent: false }, (res) => {
          const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      assert.equal(body.toString('utf8'), withPlugins.body.toString('utf8'));
    } finally { await new Promise((r) => s2.close(r)); }
  });

  test('a data/assets.json rewritten while the server runs is noticed: references are checked against the new one', () => {
    const file = path.join(root, 'data', 'assets.json');
    const before = registry.vanillaAssets().sha256;
    writePlugin(path.join(root, 'plugins', 'late-ref'), cosmetic({ assets: { chars: { char_999_new: { ref: 'char_998_added' } } }, permissions: ['assets.add'] }));
    registry.refresh(true);
    assert.equal(registry.plugin('late-ref'), null, 'a reference to an entry the manifest does not have yet');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.chars.char_998_added = { avatar: '/assets/char/avatar/char_112_siege.png' };
    fs.writeFileSync(file, JSON.stringify(doc));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 10000));
    registry.refresh(true);
    assert.notEqual(registry.vanillaAssets().sha256, before);
    assert.equal(registry.plugin('late-ref')?.status, 'loaded', 'its reference now names an entry');
  });
});
