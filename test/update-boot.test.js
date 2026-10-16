// test/update-boot.test.js — the update package on the player's machine (server/update.js, docs/DEPLOY.md §1.5): the
// paths UPDATE.json may name, the boot step that finishes an update (deletes, renames, refuses a mismatched install,
// skips a malformed file), and the MANIFEST.json check `npm run doctor` shows. Temporary folders only.
// Run: node --test test/update-boot.test.js (the packaging side: test/update-package.test.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  APPLIED_FILE, MANIFEST_FILE, UPDATE_FILE, affectsRuntime, applyPendingUpdate, checkInstall, deleteRemoved, digestFile,
  inManifest, isSetupArt, parseManifest, parseUpdate, pathProblem, removalProblem, verifyFiles,
} from '../server/update.js';

const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const dg = (body) => ({ size: Buffer.byteLength(body), sha256: sha(body) });
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-update-${tag}-`));
const put = (dir, rel, body = `// ${rel}\n`) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const quiet = () => {
  const lines = [];
  return { lines, log: { log: (m) => lines.push(['log', m]), warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) } };
};
/** MANIFEST.json / UPDATE.json as tools/package-update.mjs writes them (the same keys; its line layout is not needed here). */
const manifestText = ({ app, files }) => JSON.stringify({ format: 1, app, files: Object.fromEntries(files) });
const updateText = ({ app, from, files, removed }) => JSON.stringify({ format: 1, app, from, count: files.size,
  bytes: [...files.values()].reduce((n, d) => n + d.size, 0), files: Object.fromEntries(files), removed });

// ---------------------------------------------------------------------------------------------------------------------
// The paths an update may name

test('refusal rules: traversal, absolute and drive paths, backslashes, per-machine folders and the update files are never removed', () => {
  for (const p of ['../x', 'a/../../x', 'server/../../etc/passwd', 'a/./b', 'a//b', 'a/', '', '..', '.']) assert.ok(pathProblem(p), `traversal: ${JSON.stringify(p)}`);
  for (const p of ['/etc/passwd', 'C:/Windows/x', 'C:\\Windows\\x', 'c:x', '\\\\server\\share\\x', 'server\\index.js', 'a\0b', 'a/b.', 'a/b ']) {
    assert.ok(pathProblem(p), `absolute / not plain: ${JSON.stringify(p)}`);
  }
  for (const p of [null, undefined, 3, {}]) assert.ok(pathProblem(p) && removalProblem(p), String(p));
  for (const p of ['.git/config', '.cache/assets-report.json', 'logs/server.log', '.venv-extract/bin/python', 'tools/local-extract/.venv/x',
    'data/.env', '.env.local', 'scripts/service.env.cmd', 'node_modules/.cache/x', 'handoff/HANDOFF.md', '.claude/settings.json',
    MANIFEST_FILE, UPDATE_FILE, APPLIED_FILE]) {
    assert.ok(removalProblem(p), `never removed: ${p}`);
    assert.equal(pathProblem(p), null, `${p} may still be listed (a manifest path is only read)`);
  }
  for (const p of ['../x', '/etc/passwd', 'C:/x']) assert.ok(removalProblem(p), p);
  for (const p of ['server/old.js', 'packs/qab/pack.json', 'node_modules/three/build/three.cjs', 'public/assets/ui/b c.png', 'data/i18n/zh-TW.json',
    'docs/research/07-assets.json', 'README.md']) {
    assert.equal(removalProblem(p), null, p);
  }
  // a dependency's own .env.example can be verified (MANIFEST.json) but an update never deletes it
  const m = parseManifest(JSON.stringify({ format: 1, app: '0.2.1', files: { 'node_modules/x/.env.example': dg('x') } }));
  assert.deepEqual([...m.files.keys()], ['node_modules/x/.env.example']);
});

const H = sha('x');
const goodUpdate = (patch = {}) => JSON.stringify({ format: 1, app: '0.2.1', from: ['0.2.0'], count: 1, bytes: 1,
  files: { 'server/a.js': { size: 1, sha256: H } }, removed: [{ path: 'server/old.js', sha256: [H] }], ...patch });

test('UPDATE.json is read strictly: one bad entry and the whole file is refused', () => {
  const u = parseUpdate(goodUpdate());
  assert.equal(u.app, '0.2.1');
  assert.deepEqual(u.removed, [{ path: 'server/old.js', sha256: [H] }]);
  assert.deepEqual([...u.files.keys()], ['server/a.js']);
  const bad = {
    'not JSON': '{"format": 1,',
    'not an object': '[]',
    'another format': goodUpdate({ format: 2 }),
    'no version': goodUpdate({ app: 'latest' }),
    'no base': goodUpdate({ from: [] }),
    'no count': goodUpdate({ count: -1 }),
    'files not an object': goodUpdate({ files: [] }),
    'a file without a hash': goodUpdate({ files: { 'server/a.js': { size: 1 } } }),
    'a file outside the install': goodUpdate({ files: { '../a.js': { size: 1, sha256: H } } }),
    'removed not a list': goodUpdate({ removed: {} }),
    'traversal': goodUpdate({ removed: [{ path: '../../outside.txt', sha256: [H] }] }),
    'absolute': goodUpdate({ removed: [{ path: '/etc/hosts', sha256: [H] }] }),
    'a user folder': goodUpdate({ removed: [{ path: 'logs/server.log', sha256: [H] }] }),
    'twice': goodUpdate({ removed: [{ path: 'server/old.js', sha256: [H] }, { path: 'server/old.js', sha256: [H] }] }),
    'shipped and removed': goodUpdate({ removed: [{ path: 'server/a.js', sha256: [H] }] }),
    'no hash': goodUpdate({ removed: [{ path: 'server/old.js', sha256: [] }] }),
    'a bad hash': goodUpdate({ removed: [{ path: 'server/old.js', sha256: ['abc'] }] }),
    'a bare path': goodUpdate({ removed: ['server/old.js'] }),
  };
  for (const [what, text] of Object.entries(bad)) assert.throws(() => parseUpdate(text), undefined, what);
});

// ---------------------------------------------------------------------------------------------------------------------
// The boot step

/** An install of the new version: `files` on disk, MANIFEST.json over the non-art ones, UPDATE.json as given. */
function newInstall(onDisk, { app = '0.2.1', from = ['0.2.0'], shipped = [], removed = [], manifest = null } = {}) {
  const dir = tmp('inst');
  for (const [rel, body] of Object.entries(onDisk)) put(dir, rel, body);
  const listed = new Map();
  for (const rel of manifest ?? Object.keys(onDisk).filter(inManifest)) listed.set(rel, digestFile(path.join(dir, rel)));
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), manifestText({ app, files: listed }));
  const ship = new Map(shipped.map((rel) => [rel, digestFile(path.join(dir, rel))]));
  fs.writeFileSync(path.join(dir, UPDATE_FILE), updateText({ app, from, files: ship, removed }));
  return dir;
}

test('boot apply: deletes the removed files that hold a base\'s bytes, keeps changed ones and players\' packs, renames UPDATE.json, then does nothing', () => {
  const dir = newInstall({
    'server/index.js': 'new', 'shared/constants.js': "APP_VERSION='0.2.1'", 'README.md': 'readme',
    // left over from 0.2.0
    'server/old.js': 'old', 'server/lib/only/gone.js': 'gone', 'data/old.json': 'edited here', 'packs/qab/pack.json': 'shipped pack',
    'packs/mine/pack.json': 'a player\'s own pack',
  }, {
    shipped: ['server/index.js', 'shared/constants.js'],
    manifest: ['server/index.js', 'shared/constants.js', 'README.md'],
    removed: [
      { path: 'server/old.js', sha256: [sha('old')] },
      { path: 'server/lib/only/gone.js', sha256: [sha('gone')] },
      { path: 'data/old.json', sha256: [sha('as shipped')] },
      { path: 'packs/qab/pack.json', sha256: [sha('shipped pack')] },
      { path: 'packs/mine/pack.json', sha256: [sha('the 0.2.0 pack of that name')] },
      { path: 'server/never-here.js', sha256: [sha('x')] },
    ],
  });
  try {
    const { lines, log } = quiet();
    const r = applyPendingUpdate(dir, { log });
    assert.equal(r.state, 'applied', JSON.stringify(lines));
    assert.deepEqual(r.deleted.sort(), ['packs/qab/pack.json', 'server/lib/only/gone.js', 'server/old.js']);
    assert.deepEqual(r.kept.sort(), ['data/old.json', 'packs/mine/pack.json'], 'other bytes than any base shipped: left alone');
    assert.equal(r.absent, 1);
    assert.ok(!has(dir, 'server/old.js') && !has(dir, 'server/lib'), 'the folders it leaves empty go too');
    assert.ok(has(dir, 'server/index.js') && has(dir, 'packs/mine/pack.json') && has(dir, 'data/old.json'));
    assert.ok(!has(dir, 'packs/qab') && has(dir, 'packs'), 'an emptied pack folder goes, the packs folder with another pack stays');
    assert.ok(!has(dir, UPDATE_FILE) && has(dir, APPLIED_FILE), 'UPDATE.json → .update-applied.json');
    assert.equal(parseUpdate(read(dir, APPLIED_FILE)).app, '0.2.1');
    assert.match(lines.map((l) => l[1]).join('\n'), /已更新到 v0\.2\.1：3 个文件校验通过，删除 3 个旧文件 · updated to v0\.2\.1/);
    assert.ok(lines.some(([k, m]) => k === 'warn' && /保留了 2 个/.test(m)), 'the kept files are named');
    // idempotent: nothing pending, nothing changes
    const before = fs.readdirSync(dir, { recursive: true }).sort();
    assert.equal(applyPendingUpdate(dir, { log }).state, 'none');
    assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boot apply: a malformed UPDATE.json is logged and skipped — nothing deleted, the file kept, never a throw', () => {
  const outside = tmp('outside');
  put(outside, 'victim.txt', 'keep me');
  const dir = newInstall({ 'server/index.js': 'new', 'server/old.js': 'old' });
  try {
    const cases = [
      '{"format": 1, "app": "0.2.1"',                                                     // truncated
      JSON.stringify({ format: 1, app: '0.2.1', from: ['0.2.0'], count: 0, bytes: 0, files: {},
        removed: [{ path: 'server/old.js', sha256: [sha('old')] }, { path: `../${path.basename(outside)}/victim.txt`, sha256: [sha('keep me')] }] }),
      JSON.stringify({ format: 1, app: '0.2.1', from: ['0.2.0'], count: 0, bytes: 0, files: {}, removed: [{ path: path.join(outside, 'victim.txt'), sha256: [sha('keep me')] }] }),
      JSON.stringify({ format: 99 }),
      'null',
    ];
    for (const text of cases) {
      fs.writeFileSync(path.join(dir, UPDATE_FILE), text);
      const { lines, log } = quiet();
      const r = applyPendingUpdate(dir, { log });
      assert.equal(r.state, 'malformed', text);
      assert.ok(has(dir, UPDATE_FILE) && !has(dir, APPLIED_FILE), 'left in place');
      assert.ok(has(dir, 'server/old.js'), 'one bad entry: not even the good ones are deleted');
      assert.equal(read(outside, 'victim.txt'), 'keep me');
      assert.match(lines[0][1], /UPDATE\.json 格式不对，已跳过，服务器按现有文件启动/);
    }
    fs.rmSync(path.join(dir, UPDATE_FILE));
    fs.mkdirSync(path.join(dir, UPDATE_FILE)); // unreadable (a folder)
    assert.equal(applyPendingUpdate(dir, quiet()).state, 'malformed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('boot apply: a file the server runs that does not match MANIFEST.json stops the start; nothing is deleted, UPDATE.json stays', () => {
  const dir = newInstall({ 'server/index.js': 'new', 'data/chess.json': '{}', 'server/old.js': 'old' }, {
    manifest: ['server/index.js', 'data/chess.json'],
    removed: [{ path: 'server/old.js', sha256: [sha('old')] }],
  });
  try {
    put(dir, 'data/chess.json', '{"old": 1}'); // the base's copy: the update was extracted over another version
    fs.rmSync(path.join(dir, 'server/index.js'));
    const { lines, log } = quiet();
    const r = applyPendingUpdate(dir, { log });
    assert.equal(r.state, 'failed');
    assert.deepEqual(r.fatal, ['data/chess.json', 'server/index.js']);
    assert.ok(has(dir, 'server/old.js') && has(dir, UPDATE_FILE) && !has(dir, APPLIED_FILE));
    const text = lines.filter(([k]) => k === 'error').map((l) => l[1]).join('\n');
    assert.match(text, /这个更新包只能覆盖在 v0\.2\.0 的整合包安装上（检测到 2 个文件与 v0\.2\.1 不一致或缺失，例：data\/chess\.json、server\/index\.js）。服务器没有启动：请下载 v0\.2\.1 的完整包/);
    assert.match(text, /This update package only applies over a v0\.2\.0 install \(2 files differ from v0\.2\.1 or are missing/);
    // fixed (the right files extracted): the next start applies it
    put(dir, 'data/chess.json', '{}');
    put(dir, 'server/index.js', 'new');
    assert.equal(applyPendingUpdate(dir, quiet()).state, 'applied');
    assert.ok(!has(dir, 'server/old.js'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boot apply: a missing or foreign MANIFEST.json stops the start; docs-only differences and missing art are warnings', () => {
  const a = newInstall({ 'server/index.js': 'new' });
  const b = newInstall({ 'server/index.js': 'new' });
  const c = newInstall({ 'server/index.js': 'new', 'README.md': 'readme', 'scripts/start.sh': 'sh', 'node_modules/ws/README.md': 'r', 'public/assets/x.png': 'x' },
    { shipped: ['public/assets/x.png'] });
  try {
    fs.rmSync(path.join(a, MANIFEST_FILE));
    let q = quiet();
    assert.equal(applyPendingUpdate(a, { log: q.log }).state, 'failed');
    assert.match(q.lines.map((l) => l[1]).join('\n'), /没有完整解压（MANIFEST\.json is missing）/);
    fs.writeFileSync(path.join(b, MANIFEST_FILE), manifestText({ app: '0.2.2', files: new Map() }));
    q = quiet();
    assert.equal(applyPendingUpdate(b, { log: q.log }).state, 'failed');
    assert.match(q.lines.map((l) => l[1]).join('\n'), /MANIFEST\.json belongs to v0\.2\.2/);
    put(c, 'README.md', 'edited');
    put(c, 'scripts/start.sh', 'edited');
    put(c, 'node_modules/ws/README.md', 'edited');
    fs.rmSync(path.join(c, 'public/assets/x.png'));
    q = quiet();
    const r = applyPendingUpdate(c, { log: q.log });
    assert.equal(r.state, 'applied');
    assert.deepEqual(r.notes, ['README.md', 'node_modules/ws/README.md', 'scripts/start.sh']);
    assert.deepEqual(r.art, ['public/assets/x.png']);
    const warned = q.lines.filter(([k]) => k === 'warn').map((l) => l[1]).join('\n');
    assert.match(warned, /3 个说明 \/ 脚本文件与 v0\.2\.1 不一致（不影响运行/);
    assert.match(warned, /1 个素材文件没有完整解压/);
  } finally {
    for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('boot apply: a local-art manifest the update brought to an install without that art is named (a lite install)', () => {
  const local = JSON.stringify({ groups: { g: { x: { path: '/assets/local/g/x.webp' }, y: { path: '/assets/local/g/y.webp' } } } });
  const dir = newInstall({ 'server/index.js': 'new', 'data/local-assets.json': local, 'public/assets/local/g/y.webp': 'y' },
    { shipped: ['data/local-assets.json', 'public/assets/local/g/y.webp'] });
  try {
    const q = quiet();
    const r = applyPendingUpdate(dir, { log: q.log });
    assert.equal(r.state, 'applied');
    assert.deepEqual(r.localGaps, ['public/assets/local/g/x.webp']);
    assert.match(q.lines.map((l) => l[1]).join('\n'), /本地客户端素材不完整：data\/local-assets\.json 列出的 1 个文件不在这台电脑上/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting removed files: never through a symlink, never a folder, never a file of the new version that differs only in case', () => {
  const dir = tmp('del');
  const outside = tmp('outside');
  try {
    put(outside, 'x.js', 'old');
    put(dir, 'server/dir.js/inner.js', 'old');
    put(dir, 'public/assets/X.png', 'png');
    let links = true;
    try {
      fs.symlinkSync(path.join(outside, 'x.js'), path.join(dir, 'server', 'link.js'));
      fs.symlinkSync(outside, path.join(dir, 'linked'), 'dir');
    } catch { links = false; } // Windows without the symlink privilege
    const r = deleteRemoved(dir, [
      { path: 'server/link.js', sha256: [sha('old')] },
      { path: 'linked/x.js', sha256: [sha('old')] },
      { path: 'server/dir.js', sha256: [sha('old')] },
      { path: 'public/assets/X.png', sha256: [sha('png')] },
      { path: '../escape.js', sha256: [sha('old')] },
    ], new Set(['public/assets/x.png']));
    assert.deepEqual(r.deleted, []);
    assert.equal(read(outside, 'x.js'), 'old', 'the symlink targets are untouched');
    assert.ok(has(dir, 'public/assets/X.png') && has(dir, 'server/dir.js/inner.js'));
    const why = r.skipped.join('\n');
    if (links) {
      assert.match(why, /server\/link\.js \(not a regular file\)/);
      assert.match(why, /linked\/x\.js \(outside the install\)/);
    }
    assert.match(why, /server\/dir\.js \(not a regular file\)/);
    assert.match(why, /public\/assets\/X\.png \(a file of the new version\)/);
    assert.match(why, /\.\.\/escape\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The manifest check

test('manifest verification: missing files, other sizes, same size other bytes, a folder in place of a file; doctor\'s states', () => {
  const dir = tmp('verify');
  try {
    put(dir, 'a.js', 'aaaa');
    put(dir, 'b.js', 'bbbb');
    put(dir, 'c.js', 'cccc');
    fs.mkdirSync(path.join(dir, 'd.js'));
    const v = verifyFiles(dir, new Map([['a.js', dg('aaaa')], ['b.js', dg('bbbbb')], ['c.js', dg('CCCC')], ['d.js', dg('d')], ['e.js', dg('e')]]));
    assert.deepEqual(v, { checked: 5, missing: ['d.js', 'e.js'], mismatched: ['b.js', 'c.js'] });

    assert.deepEqual(checkInstall(dir), { state: 'none', pending: false }, 'no MANIFEST.json: a source checkout');
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), '{');
    assert.equal(checkInstall(dir).state, 'broken');
    const listed = new Map([['a.js', dg('aaaa')], ['README.md', dg('readme')]]);
    put(dir, 'README.md', 'readme');
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), manifestText({ app: '0.2.1', files: listed }));
    assert.deepEqual(checkInstall(dir), { state: 'ok', pending: false, app: '0.2.1', checked: 2, missing: [], mismatched: [], runtime: [], other: [] });
    put(dir, 'README.md', 'edited');
    put(dir, 'a.js', 'AAAA');
    put(dir, UPDATE_FILE, '{}');
    const c = checkInstall(dir);
    assert.equal(c.state, 'mismatch');
    assert.deepEqual([c.runtime, c.other, c.pending], [['a.js'], ['README.md'], true]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('what MANIFEST.json lists and what stops an update', () => {
  for (const f of ['public/assets/char/a.png', 'public/fonts/fonts.css', 'data/assets.json', 'data/local-assets.json', 'data/local-fx.json',
    'public/assets/local/fx/prefabs/common_hit_01.json']) {
    assert.ok(isSetupArt(f) && !inManifest(f), f);
  }
  for (const f of [MANIFEST_FILE, UPDATE_FILE, APPLIED_FILE]) assert.ok(!inManifest(f), f);
  for (const f of ['server/index.js', 'data/chess.json', 'node_modules/ws/index.js', 'public/vendor/pixi.min.js', 'README.md', 'packs/index.json']) {
    assert.ok(inManifest(f), f);
  }
  for (const f of ['server/index.js', 'shared/constants.js', 'data/chess.json', 'public/js/main.js', 'public/vendor/pixi.min.js', 'packs/index.json',
    'node_modules/ws/package.json', 'node_modules/ws/lib/websocket.js', 'node_modules/x/license.js', 'docs/research/03-operators.json', 'package.json']) {
    assert.ok(affectsRuntime(f), `${f} stops an update`);
  }
  for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'docs/DEPLOY.md', 'node_modules/ws/README.md', 'node_modules/three/LICENSE',
    'node_modules/preact/src/index.d.ts', 'node_modules/x/dist/x.js.map', 'scripts/start-windows.bat', 'tools/setup.mjs',
    'tools/local-extract/LICENSE-Ark-Unpacker.txt', 'package-lock.json', 'node_modules/.package-lock.json']) {
    assert.ok(!affectsRuntime(f), `${f} only warns`);
  }
});
