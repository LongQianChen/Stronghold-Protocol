// test/studio/forge.test.js — the studio's Forge import (DESIGN §32.12). The gate is the studio's own. The body is a
// zip or a file list, never a path on the server. Preview writes nothing; import writes plugins/<id>/ after the report.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/index.js';
import { zipFiles } from '../../server/plugins/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIN = path.join(ROOT, 'test', 'fixtures', 'forge', 'skin-pack');

function packZip(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      const next = rel ? `${rel}/${name}` : name;
      if (fs.statSync(p).isDirectory()) walk(p, next);
      else files.push({ name: next, data: fs.readFileSync(p) });
    }
  };
  walk(dir, '');
  return zipFiles(files);
}

describe('studio Forge import', () => {
  let srv;
  let tmp;
  let plugins;
  let H;
  const call = async (method, url, body, headers = H) => {
    const r = await fetch(srv.url + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const raw = (method, url, headers = {}, body = null) => new Promise((resolve, reject) => {
    const u = new URL(srv.url + url);
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-studio-'));
    plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    H = { 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' };
  });
  after(async () => { await srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  test('the gate refuses a preview without the key, from a public client, and from another origin', async () => {
    const body = JSON.stringify({ zip: 'e30=' });
    assert.equal((await raw('POST', '/studio/api/forge/preview', { 'content-type': 'application/json' }, body)).status, 404);
    assert.equal((await raw('POST', '/studio/api/forge/import', { 'content-type': 'application/json', 'x-sp-studio': '1', 'x-forwarded-for': '203.0.113.9' }, body)).status, 404);
    assert.equal((await raw('POST', '/studio/api/forge/import', { 'content-type': 'application/json', 'x-sp-studio': srv.studio.key, origin: 'http://evil.example.com' }, body)).status, 404);
    assert.equal(fs.readdirSync(plugins).filter((n) => !n.startsWith('.')).length, 0);
  });

  test('a server path is refused; preview writes nothing; import writes the plugin; a second import is refused', async () => {
    const refused = await call('POST', '/studio/api/forge/preview', { path: SKIN });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'PLUGIN_FORGE_INPUT');
    const zip = packZip(SKIN).toString('base64');
    const preview = await call('POST', '/studio/api/forge/preview', { zip });
    assert.equal(preview.status, 200, JSON.stringify(preview.body).slice(0, 500));
    assert.equal(preview.body.report.ok, true);
    assert.equal(preview.body.report.wrote, false);
    assert.equal(preview.body.plugins[0].id, 'rose-skin');
    assert.equal(fs.existsSync(path.join(plugins, 'rose-skin')), false);
    const imported = await call('POST', '/studio/api/forge/import', { zip });
    assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 800));
    assert.equal(imported.body.report.wrote, true);
    assert.ok(fs.existsSync(path.join(plugins, 'rose-skin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(plugins, 'rose-skin', 'IMPORT-REPORT.md')));
    const again = await call('POST', '/studio/api/forge/import', { zip });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'PLUGIN_FORGE_EXISTS');
    const list = await call('GET', '/studio/api/plugins');
    assert.ok(list.body.plugins.some((p) => p.id === 'rose-skin'));
  });

  test('a pack with a kit previews a script plugin with its run condition; noScripts leaves it out', async () => {
    // a kit pack built in memory (node --test runs every .js file under test/, so it is not a fixture file)
    const pair = (id, golden) => ({ chessId: id, baseId: 'chess_rose_kit_a', goldenId: 'chess_rose_kit_b', isGolden: golden, tier: 3, rarity: 4,
      name: '玫瑰行为', charId: 'char_102_texas', profession: 'SNIPER', subProfessionId: 'fastshot', position: 'RANGED', bonds: ['deputShip'],
      stats: { maxHp: 1000, atk: 400, def: 100, res: 0, cost: 12, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 70 }, rangeGrid: [[0, 0]],
      skills: [{ skillId: 'sk_rose_kit', name: '瞄准', duration: 10, spCost: 40, initSp: 0, bb: { atk: 0.3 }, isDefault: true }] });
    const zip = zipFiles([
      { name: 'pack.json', data: Buffer.from(JSON.stringify({ id: 'rose-kit', name: '玫瑰行为', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] })) },
      { name: 'chess.json', data: Buffer.from(JSON.stringify({ chess_rose_kit_a: pair('chess_rose_kit_a', false), chess_rose_kit_b: pair('chess_rose_kit_b', true) })) },
      { name: 'kits/chess_rose_kit_a.js', data: Buffer.from("import { num } from '@kit/tier1.js';\nexport default function kit(bb) { return { skill: { kind: 'passive', mods: { atkPct: num(bb.atk, 0) } } }; }\n") },
    ]).toString('base64');
    const preview = await call('POST', '/studio/api/forge/preview', { zip });
    assert.equal(preview.status, 200, JSON.stringify(preview.body).slice(0, 500));
    assert.deepEqual(preview.body.plugins, [{ id: 'kits-rose-kit', class: 'script' }, { id: 'rose-kit', class: 'content' }]);
    assert.match(preview.body.report.markdown, /SP_PLUGIN_SCRIPTS=sandbox/);
    const without = await call('POST', '/studio/api/forge/preview', { zip, noScripts: true });
    assert.equal(without.status, 200);
    assert.deepEqual(without.body.plugins, [{ id: 'rose-kit', class: 'content' }]);
    assert.ok(without.body.report.skipped.some((x) => x.path === 'kits/chess_rose_kit_a.js' && /--no-scripts/.test(x.en)));
    const imported = await call('POST', '/studio/api/forge/import', { zip });
    assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 500));
    assert.ok(fs.existsSync(path.join(plugins, 'kits-rose-kit', 'sim', 'index.js')));
    const list = await call('GET', '/studio/api/plugins');
    assert.ok(list.body.plugins.some((p) => p.id === 'kits-rose-kit'));
    fs.rmSync(path.join(plugins, 'kits-rose-kit'), { recursive: true, force: true });
    fs.rmSync(path.join(plugins, 'rose-kit'), { recursive: true, force: true });
  });

  test('a file list imports, and a path-escape name is refused', async () => {
    fs.rmSync(path.join(plugins, 'rose-skin'), { recursive: true, force: true });
    const files = [];
    const walk = (abs, rel) => {
      for (const name of fs.readdirSync(abs)) {
        const p = path.join(abs, name);
        const next = rel ? `${rel}/${name}` : name;
        if (fs.statSync(p).isDirectory()) walk(p, next);
        else files.push({ name: `skin-pack/${next}`, data: fs.readFileSync(p).toString('base64') });
      }
    };
    walk(SKIN, '');
    const preview = await call('POST', '/studio/api/forge/preview', { files });
    assert.equal(preview.status, 200, JSON.stringify(preview.body).slice(0, 500));
    assert.equal(preview.body.report.products[0].id, 'rose-skin');
    const bad = await call('POST', '/studio/api/forge/preview', { files: [{ name: '../evil.txt', data: Buffer.from('no').toString('base64') }, { name: 'pack.json', data: Buffer.from('{"id":"rose-evil","name":"x","version":"1.0.0"}').toString('base64') }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'PLUGIN_FORGE_ZIP');
    assert.equal(fs.existsSync(path.join(plugins, 'rose-skin')), false);
  });
});
