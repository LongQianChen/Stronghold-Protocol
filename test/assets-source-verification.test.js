import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceVerifier } from '../tools/assets/source-verifier.mjs';
import { Downloader } from '../tools/assets/downloader.mjs';
import { cachedJson } from '../tools/assets/cache.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate } from '../tools/assets/manifest.mjs';
import { normalizeAtlas } from '../tools/assets/atlas.mjs';
import { processModels } from '../tools/assets/spine.mjs';
import { buildFonts, FONTS } from '../tools/assets/fonts.mjs';
import { decodeWoff2Tables } from '../tools/assets/woff2.mjs';
import { orphanFiles, parseArgs } from '../tools/fetch-assets.mjs';

const quiet = () => {};
const commit = '1'.repeat(40);
const tree = '2'.repeat(40);
const raw = 'https://raw.githubusercontent.com/o/r/main/';
// Independent fixture Git-object digest, not the implementation under test.
const digest = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

async function fixture(t, files, { revision = commit, payload = (url) => files[url.split('/').at(-1)], apiStatus = 200, missingStatus = 404 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sp-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.authorization, 'Bearer test-api-token');
      assert.equal(options.redirect, 'error');
      return Response.json({ truncated: false, tree: Object.entries(files).map(([path, buf]) => ({ path, type: 'blob', sha: digest(buf) })) }, { status: apiStatus });
    }
    assert.equal(new Headers(options?.headers).has('authorization'), false, 'payloads never receive the API token');
    const bytes = payload(url);
    return new Response(bytes ?? null, { status: bytes ? 200 : missingStatus });
  };
  const verifier = new SourceVerifier({ 'o/r@main': { commit: revision, tree } }, { fetchImpl, token: 'test-api-token' });
  const dl = new Downloader({ root, ledgerPath: join(root, 'ledger.json'), verifier, fetchImpl, retries: 1, backoffMs: 0, log: quiet });
  return { root, dl, verifier, fetchImpl, calls };
}

test('user equal-size stale mirror bytes are rejected before a valid pinned fallback is accepted', async (t) => {
  // Given valid JSON of the same size but different contents from the mirror.
  const good = Buffer.from('{"n":2}');
  const stale = Buffer.from('{"n":1}');
  const f = await fixture(t, { 'a.json': good }, { payload: (url) => url.startsWith('https://proxy.example/') ? stale : good });
  const dl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier,
    fetchImpl: f.fetchImpl, source: 'mirror', proxyPrefix: 'https://proxy.example/', retries: 1, log: quiet });
  // When the generator downloads a current candidate.
  const result = await dl.run([{ rel: 'a.json', urls: [raw + 'a.json'], kind: 'json' }]);
  // Then only the verified direct fallback reaches disk and logical provenance survives.
  assert.equal(result.get('a.json').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'a.json')), good);
  assert.equal(dl.ledger.files['a.json'].url, raw + 'a.json');
  assert.equal(f.calls.filter((u) => !u.startsWith('https://api.')).length, 2);
  assert.ok(f.calls.filter((u) => !u.startsWith('https://api.')).every((u) => u.includes(commit)), 'payload requests are pinned, not branch requests');
});

test('user same-path remapping replaces equal-size bytes despite an old ledger URL', async (t) => {
  const old = Buffer.from('old!');
  const good = Buffer.from('new!');
  const f = await fixture(t, { 'old.bin': old, 'new.bin': good });
  await writeFile(join(f.root, 'asset.bin'), old);
  f.dl.ledger.files['asset.bin'] = { url: raw + 'old.bin', bytes: old.length };
  const result = await f.dl.run([{ rel: 'asset.bin', urls: [raw + 'new.bin', raw + 'old.bin'], kind: 'bin' }]);
  assert.equal(result.get('asset.bin').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'asset.bin')), good);
  assert.equal(f.dl.ledger.files['asset.bin'].url, raw + 'new.bin');
});

test('user transient primary failures preserve untried cached alternatives through pruning without publishing them', async (t) => {
  for (const failure of ['api', 'payload', 'invalid']) {
    // Given a previous run that downloaded a fallback after a primary 404.
    const good = Buffer.from('new!');
    const f = await fixture(t, { 'a.bin': good, 'fallback.bin': good }, {
      payload: (url) => url.endsWith('a.bin') ? null : good,
    });
    const template = { item: { alts: ['a.bin', 'fallback.bin', 'older.bin'].map((rel) =>
      ({ rel, urls: [raw + rel], kind: 'bin' })) } };
    await downloadLeaves(collectLeaves(template), f.dl, f.root);
    assert.deepEqual(resolveTemplate(template, { root: f.root, spine: new Map(),
      available: (rel) => f.dl.accepted.has(rel) }).value, { item: '/assets/fallback.bin' });
    await writeFile(join(f.root, 'a.bin'), 'old!');
    await writeFile(join(f.root, 'older.bin'), 'older fallback');
    await writeFile(join(f.root, 'unrelated.bin'), 'orphan');
    const fetchImpl = async (url, options) => {
      if (failure === 'api' || url.endsWith('a.bin')) {
        return failure === 'invalid' ? new Response('old!') : new Response(null, { status: 503 });
      }
      return f.fetchImpl(url, options);
    };
    const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, { fetchImpl, token: 'test-api-token' });
    const dl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier,
      fetchImpl, retries: 1, backoffMs: 0, log: quiet });
    await dl.loadLedger();
    // When a new run fails on the primary and prunes unreferenced files.
    assert.deepEqual(await downloadLeaves(collectLeaves(template), dl, f.root), ['item']);
    const resolved = resolveTemplate(template, { root: f.root, spine: new Map(), available: (rel) => dl.accepted.has(rel) });
    const orphans = orphanFiles(['a.bin', 'fallback.bin', 'older.bin', 'unrelated.bin'],
      new Set([...resolved.files, ...dl.preserved]));
    for (const rel of orphans) await rm(join(f.root, rel));
    // Then cached alternatives survive, but only independently accepted files can be published.
    assert.deepEqual(await readFile(join(f.root, 'fallback.bin')), good);
    assert.equal(await readFile(join(f.root, 'older.bin'), 'utf8'), 'older fallback');
    assert.equal(await readFile(join(f.root, 'a.bin'), 'utf8'), 'old!');
    assert.deepEqual(orphans, ['unrelated.bin']);
    assert.deepEqual(resolved.value, {});
    assert.deepEqual(resolved.droppedLeaves, ['item']);
  }
});

test('user missing sources preserve legacy and verified caches through shared fallback pruning', async (t) => {
  // Given two consumers of a cached fallback, with and without blob provenance.
  for (const missing of ['tree', 404, 410, 503]) for (const verified of [false, true]) {
    const good = Buffer.from('{"cached":true}');
    const f = await fixture(t, missing === 'tree' ? {} : { 'shared.json': Buffer.from('{"new":true}') }, {
      payload: () => null, missingStatus: missing === 'tree' ? 404 : missing,
    });
    await writeFile(join(f.root, 'shared.json'), good);
    const ledger = { url: raw + 'shared.json', bytes: good.length, ...(verified ? { blob: digest(good), commit } : {}) };
    f.dl.ledger.files['shared.json'] = ledger;
    const shared = { rel: 'shared.json', urls: [raw + 'shared.json'], kind: 'json' };
    const template = { first: { alts: [shared] }, second: { alts: [
      { rel: 'missing.json', urls: [raw + 'missing.json'], kind: 'json' }, shared,
    ] } };
    // When both sources disappear and the caller computes the prune set.
    await downloadLeaves(collectLeaves(template), f.dl, f.root);
    assert.deepEqual(await readFile(join(f.root, 'shared.json')), good);
    const resolved = resolveTemplate(template, { root: f.root, spine: new Map(), available: (rel) => f.dl.accepted.has(rel) });
    const orphans = orphanFiles(['shared.json', 'unrelated.json'], new Set([...resolved.files, ...f.dl.preserved]));
    // Then deletion requires an orphan, not a failed fetch; only proven bytes are published.
    assert.deepEqual(JSON.parse(await readFile(join(f.root, 'ledger.json'))).files['shared.json'], ledger);
    assert.deepEqual(orphans, ['unrelated.json']);
    assert.deepEqual(resolved.value, verified ? { first: '/assets/shared.json', second: '/assets/shared.json' } : {});
  }
});

test('user source revisions reuse unchanged raw bytes but replace same-size changed bytes and refresh the ledger', async (t) => {
  const good = Buffer.from('unchanged');
  const revision = '3'.repeat(40);
  for (const [cached, status, requests] of [[good, 'skip', 1], [Buffer.from('outdated!'), 'ok', 2]]) {
    const f = await fixture(t, { 'a.bin': good }, { revision });
    await writeFile(join(f.root, 'a.bin'), cached);
    f.dl.ledger.files['a.bin'] = { url: raw + 'a.bin', bytes: good.length, commit };
    const result = await f.dl.run([{ rel: 'a.bin', urls: [raw + 'a.bin'], kind: 'bin' }]);
    assert.equal(result.get('a.bin').status, status);
    assert.equal(f.calls.length, requests, 'unchanged raw bytes need metadata only; same-size changes need a new payload');
    assert.deepEqual(await readFile(join(f.root, 'a.bin')), good);
    const ledger = JSON.parse(await readFile(join(f.root, 'ledger.json'), 'utf8'));
    assert.equal(ledger.files['a.bin'].commit, revision);
    assert.equal(ledger.files['a.bin'].blob, digest(good));
  }
});

test('user stale JSON index is verified before parsing and cannot drive the plan', async (t) => {
  const good = Buffer.from('{"plan":"new"}');
  const stale = Buffer.from('{"plan":"old"}');
  const f = await fixture(t, { 'index.json': good }, { payload: (url) => url.startsWith('https://proxy.example/') ? stale : good });
  const cacheFile = join(f.root, 'index.json');
  await writeFile(cacheFile, stale);
  const index = await cachedJson({ cacheFile, url: raw + 'index.json', verifier: f.verifier, fetchImpl: f.fetchImpl,
    source: 'mirror', proxyPrefix: 'https://proxy.example/', log: quiet, backoffMs: 0 });
  assert.deepEqual(index, { plan: 'new' });
  assert.deepEqual(await readFile(cacheFile), good);
  const calls = f.calls.length;
  assert.deepEqual(await cachedJson({ cacheFile, url: raw + 'index.json', verifier: f.verifier, fetchImpl: f.fetchImpl }), { plan: 'new' });
  assert.equal(f.calls.length, calls, 'a verified unchanged index is reused without fetching payloads or repeated tree metadata');
});

test('user source API failure fails closed even for matching cached assets and indexes', async (t) => {
  const good = Buffer.from('{"n":2}');
  const f = await fixture(t, { 'a.json': good }, { apiStatus: 503 });
  const cacheFile = join(f.root, 'a.json');
  await writeFile(cacheFile, good);
  f.dl.ledger.files['a.json'] = { url: raw + 'a.json', bytes: good.length, blob: digest(good), commit };
  const result = await f.dl.run([{ rel: 'a.json', urls: [raw + 'a.json'], kind: 'json' }]);
  assert.equal(result.get('a.json').status, 'error');
  assert.match(result.get('a.json').error, /source tree API HTTP 503/);
  assert.deepEqual(await readFile(cacheFile), good);
  assert.ok(f.dl.accepted.has('a.json'), 'the last verified file remains usable in the manifest');
  await writeFile(cacheFile, good);
  await assert.rejects(cachedJson({ cacheFile, url: raw + 'a.json', verifier: f.verifier, fetchImpl: f.fetchImpl }), /source tree API HTTP 503/);
  assert.deepEqual(await readFile(cacheFile), good);
});

test('user retries source lookup after an API outage and reuses the recovered tree offline', async () => {
  // Given a source whose recursive probe is unavailable and whose subtree API is temporarily down.
  const blob = digest(Buffer.from('asset'));
  let available = false;
  const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, {
    token: '', fetchImpl: async (url) => {
      assert.ok(url.startsWith(`https://api.github.com/repos/o/r/git/trees/${tree}`));
      if (url.endsWith('?recursive=1') || !available) return new Response(null, { status: 503 });
      return Response.json({ truncated: false, tree: [{ path: 'a.bin', type: 'blob', sha: blob }] });
    },
  });
  // When concurrent lookups fail and the API subsequently recovers.
  await Promise.all([0, 1].map(() => assert.rejects(verifier.resolve(raw + 'a.bin'), /source tree API HTTP 503/)));
  available = true;
  const expected = { blob, commit, url: raw + 'a.bin', pinnedUrl: `https://raw.githubusercontent.com/o/r/${commit}/a.bin` };
  // Then a later lookup succeeds, and the verified tree remains usable through another outage.
  assert.deepEqual(await verifier.resolve(raw + 'a.bin'), expected);
  available = false;
  assert.deepEqual(await verifier.resolve(raw + 'a.bin'), expected);
});

test('user mutable atlas is fetched and verified raw before existing normalization', async (t) => {
  const good = Buffer.from('page.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n');
  const stale = Buffer.from(good.toString().replace('1,1', '9,9'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  const f = await fixture(t, { 'model.atlas': good, 'page.png': png }, {
    payload: (url) => url.endsWith('page.png') ? png : url.startsWith('https://proxy.example/') ? stale : good,
  });
  const normalized = normalizeAtlas(stale.toString(), { pageSize: () => ({ width: 2, height: 2 }), pma: true });
  await writeFile(join(f.root, 'model.atlas'), normalized.text);
  const dl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier, fetchImpl: f.fetchImpl,
    source: 'mirror', proxyPrefix: 'https://proxy.example/', log: quiet, retries: 1 });
  const result = await dl.run([{ rel: 'model.atlas', urls: [raw + 'model.atlas'], kind: 'atlas', mutable: true }]);
  assert.equal(result.get('model.atlas').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'model.atlas')), good);
  const next = normalizeAtlas((await readFile(join(f.root, 'model.atlas'))).toString(), { pageSize: () => ({ width: 2, height: 2 }), pma: true });
  assert.match(next.text, /pma: true/);
  assert.equal(dl.ledger.files['model.atlas'].url, raw + 'model.atlas', 'page derivation uses logical branch URL');
  // The real Spine follow-up must derive an unlisted page using the logical URL, not the pinned transport URL.
  const model = { key: 'model', dir: '', baseUrl: raw, pngs: [],
    skel: { rel: 'model.skel', urls: [raw + 'missing.skel'], kind: 'skel' },
    atlas: { rel: 'model.atlas', urls: [raw + 'model.atlas'], kind: 'atlas', mutable: true } };
  await processModels(new Map([['model', model]]), { root: f.root, dl, cachePath: join(f.root, 'spine.json'), log: quiet });
  assert.deepEqual(await readFile(join(f.root, 'page.png')), png);
  assert.equal(dl.ledger.files['page.png'].url, raw + 'page.png');
});

// A minimal SFNT with one independently readable table, sufficient for the font converter.
function font(value) {
  const buf = Buffer.alloc(32);
  buf.write('OTTO'); buf.writeUInt16BE(1, 4); buf.write('CFF ', 12);
  buf.writeUInt32BE(28, 20); buf.writeUInt32BE(4, 24); buf.write(value, 28);
  return buf;
}

test('user changed font originals are verified before WOFF2 generation and failed fonts keep generated outputs', async (t) => {
  const good = font('new!');
  const stale = font('old!');
  let available = true;
  const f = await fixture(t, { 'font.otf': good }, { payload: () => available ? good : stale });
  const name = FONTS[0].name;
  await writeFile(join(f.root, name + '.otf'), stale);
  await writeFile(join(f.root, name + '.woff2'), 'stale generated');
  await writeFile(join(f.root, 'fonts.css'), 'stale css');
  const rejectedName = FONTS[1].name;
  await writeFile(join(f.root, rejectedName + '.ttf'), stale);
  await writeFile(join(f.root, rejectedName + '.woff2'), 'previous light font');
  await f.dl.run([{ rel: name + '.otf', urls: [raw + 'font.otf'], kind: 'font' }]);
  const built = await buildFonts(f.root, quiet, { verified: true, available: (rel) => f.dl.accepted.has(rel) });
  assert.ok(built.files[name].woff2);
  assert.equal(built.files[rejectedName], undefined);
  assert.ok(!built.css.includes(rejectedName));
  assert.equal(await readFile(join(f.root, rejectedName + '.woff2'), 'utf8'), 'previous light font');
  const tables = decodeWoff2Tables(await readFile(join(f.root, name + '.woff2')));
  assert.equal(tables.tables[0].data.toString(), 'new!');
  available = false;
  const forceDl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier,
    fetchImpl: f.fetchImpl, force: true, retries: 1, backoffMs: 0, log: quiet });
  await forceDl.loadLedger();
  const result = await forceDl.run([{ rel: name + '.otf', urls: [raw + 'font.otf'], kind: 'font' }]);
  assert.equal(result.get(name + '.otf').status, 'error');
  assert.deepEqual(await readFile(join(f.root, name + '.otf')), good);
  const failed = await buildFonts(f.root, quiet, { verified: true, available: (rel) => forceDl.accepted.has(rel) });
  assert.ok(failed.files[name].woff2, 'the preserved original can still regenerate the derived font');
  await access(join(f.root, name + '.woff2'));
  await access(join(f.root, 'fonts.css'));
  const previousWoff = await readFile(join(f.root, name + '.woff2'));
  const previousCss = await readFile(join(f.root, 'fonts.css'));
  // Given an unverified original still on disk, a failed download must preserve derivatives without publishing it.
  await writeFile(join(f.root, name + '.otf'), stale);
  const rejected = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier,
    fetchImpl: f.fetchImpl, retries: 1, backoffMs: 0, log: quiet });
  await rejected.loadLedger();
  await rejected.run([{ rel: name + '.otf', urls: [raw + 'font.otf'], kind: 'font' }]);
  const excluded = await buildFonts(f.root, quiet, { verified: true, available: (rel) => rejected.accepted.has(rel) });
  assert.deepEqual(excluded.files, {});
  assert.equal(excluded.css, null);
  assert.deepEqual(await readFile(join(f.root, name + '.woff2')), previousWoff);
  assert.deepEqual(await readFile(join(f.root, 'fonts.css')), previousCss);
  assert.deepEqual(await readFile(join(f.root, name + '.otf')), stale);
});

test('user Spine post-processing does not read or normalize rejected atlas, skeleton or pages', async (t) => {
  // Given otherwise usable atlas/page bytes and a corrupt skeleton on disk.
  const atlas = Buffer.from('page.png\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  const skel = Buffer.alloc(64, 255);
  for (const rejected of ['model.atlas', 'model.skel', 'page.png']) {
    const files = { 'model.atlas': atlas, 'model.skel': skel, 'page.png': png };
    const f = await fixture(t, { ...files, [rejected]: Buffer.from('different upstream bytes') }, { payload: () => null });
    for (const [rel, buf] of Object.entries(files)) {
      await writeFile(join(f.root, rel), buf);
    }
    // A previous atlas used an extra page absent from the current download plan.
    await writeFile(join(f.root, 'extra.png'), png);
    const model = { key: 'model', dir: '', baseUrl: raw, pngs: [],
      skel: { rel: 'model.skel', urls: [raw + 'model.skel'], kind: 'skel' },
      atlas: { rel: 'model.atlas', urls: [raw + 'model.atlas'], kind: 'atlas', mutable: true } };
    await f.dl.run([model.skel, { ...model.atlas, mutable: false }, { rel: 'page.png', urls: [raw + 'page.png'], kind: 'png' }]);
    // When processing a model with one rejected input, no derived output may consume it.
    const result = await processModels(new Map([['model', model]]), { root: f.root, dl: f.dl,
      cachePath: join(f.root, 'spine.json'), download: false, log: quiet });
    assert.equal(result.entries.size, 0);
    assert.match(result.problems.join('\n'), /unverified/);
    assert.deepEqual(await readFile(join(f.root, 'model.atlas')), atlas);
    assert.deepEqual(await readFile(join(f.root, 'model.skel')), skel);
    assert.deepEqual(orphanFiles([...Object.keys(files), 'extra.png'], f.dl.preserved), [],
      'a failed model keeps its full directory for retry without publishing rejected inputs');
  }
});

test('user truncated or unavailable recursive Git tree uses complete bounded subtrees', async () => {
  const sha = digest(Buffer.from('ok'));
  const subtree = '4'.repeat(40);
  for (const recursiveStatus of [200, 500]) {
    const calls = [];
    const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, { token: '', fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith(tree + '?recursive=1')) return Response.json({ truncated: true, tree: [{ path: 'dir/a.bin', type: 'blob', sha: '5'.repeat(40) }] }, { status: recursiveStatus });
      if (url.endsWith(tree)) return Response.json({ truncated: false, tree: [{ path: 'dir', type: 'tree', sha: subtree }] });
      assert.ok(url.endsWith(subtree + '?recursive=1'));
      return Response.json({ truncated: false, tree: [{ path: 'a.bin', type: 'blob', sha }] });
    } });
    assert.equal((await verifier.resolve(raw + 'dir/a.bin')).blob, sha);
    assert.equal(await verifier.resolve(raw + 'dir/missing.bin'), null);
    assert.equal(calls.length, 3, 'complete subtrees are memoized; partial recursive entries are never used');
    await assert.rejects(verifier.resolve(raw + 'dir/'.repeat(65) + 'a.bin'), /traversal limit/);
  }
});

test('user malformed tree entries are verification errors rather than optional-source misses', async () => {
  for (const entry of [{ path: 'a.bin', sha: tree }, { type: 'blob', sha: tree }, { path: 'a.bin', type: 'blob', sha: 'bad' }]) {
    const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, {
      token: '', fetchImpl: async () => Response.json({ truncated: false, tree: [entry] }),
    });
    await assert.rejects(verifier.resolve(raw + 'a.bin'), /invalid source tree entry/);
  }
});

test('user invalid snapshots and incompatible CLI modes reject clearly', () => {
  for (const flag of ['--offline', '--add-only', '--local-spines']) {
    assert.throws(() => parseArgs(['--source-snapshot=pins.json', flag]), /incompatible/);
  }
  assert.throws(() => parseArgs(['--source-snapshot=']), /requires a path/);
  assert.throws(() => new SourceVerifier({ 'o/r@main': { commit: 'short', tree } }), /invalid source snapshot/);
  assert.equal(parseArgs(['--source-snapshot=a=b.json']).sourceSnapshot, 'a=b.json');
});
