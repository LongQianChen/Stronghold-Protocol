// Real-server browser E2E — the plugin studio (DESIGN §32.9; opt-in, ~30 s):
//   SP_E2E=1 node --test test/ui/studio.e2e.test.js
//
// A server with a plugins folder of its own: the studio's page at the address the server prints (/studio/#key=…: the key
// every change carries, server/studio/key.js — kept by the page, taken out of the address bar) → 新建插件 → the template
// 换头像 / 立绘 / 图标 → the operator found by its official name (德克萨斯) → its plugin is made (loaded at once) → a PNG made
// on the spot (180 × 180, no file of the game) is dropped on the avatar slot → the preview draws it in the game's own card
// component (ui/gameComponents.js UnitThumb, the plugin side; the original beside it) → 打包并下载 writes the lock and
// downloads the zip, which holds the manifest, the lock and the picture. A browser without the key (another profile)
// sees the plugins with the bar that asks for it; pasting the printed address there makes the page whole. The same page
// through a public address — a tunnel or proxy on this machine forwarding a visitor — and through a foreign Host name is
// the 404 page. No console or page error.
// 删除所选 (DESIGN §32.14.34): plugins checked in the list (a click, the keyboard, 全选 / 清除选择) → the confirmation names
// them and where they go (Escape cancels, nothing moves) → confirmed: they move to plugins/_removed/, the list follows,
// the one open on the right closes, the note above the list says what went and takes the focus; one a room uses stays,
// shown with its reason (the room's code), and stays checked.
//
// Screenshots: test/e2e/out/studio-*.png (and SP_STUDIO_SHOTS=<dir> copies them there for a report).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, OUT, hasChrome, sleep } from '../e2e/client.mjs';
import { png, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';
import { unzipFiles } from '../../server/plugins/zip.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

describe('the plugin studio in the browser', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('new plugin from a template → an operator by its official name → a PNG dropped on its slot → previewed → packed into a zip; a public address is refused', { timeout: 3 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-e2e-'));
    const plugins = path.join(tmp, 'plugins');
    const downloads = path.join(tmp, 'downloads');
    fs.mkdirSync(downloads);
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    const P = (await import('puppeteer-core')).default;
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run', '--force-device-scale-factor=1', '--mute-audio'] });
    const problems = [];
    const shots = [];
    fs.mkdirSync(OUT, { recursive: true });
    const shot = async (page, name) => {
      const file = path.join(OUT, `studio-${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      shots.push(file);
    };
    try {
      // a public visitor (a tunnel or proxy on this machine forwards it) and a foreign Host name get the 404 page
      const pub = await fetch(`${srv.url}/studio/`, { headers: { 'x-forwarded-for': '203.0.113.50' } });
      assert.equal(pub.status, 404);
      assert.match(await pub.text(), /页面不存在 · Not found/);
      assert.equal((await fetch(`${srv.url}/studio/api/plugins`, { headers: { 'cf-connecting-ip': '198.51.100.7' } })).status, 404);

      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1000 });
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => { if (!/\/assets\/|\/fonts\//.test(r.url())) problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`); });
      const cdp = await page.createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__studio?.ready === true, { timeout: 30000 });
      assert.equal(await page.evaluate(() => location.hash), '', 'the key is taken out of the address bar');
      assert.equal(await page.$('[data-testid="key-bar"]'), null, 'the page has its key');
      await shot(page, 'start');
      // 新建插件 → the template → the operator by its official name → name and id → create
      await page.click('[data-testid="new-plugin"]');
      await page.waitForSelector('[data-template="art"]');
      await shot(page, 'templates');
      await page.click('[data-template="art"]');
      await page.waitForSelector('[data-testid="target-search"]');
      await page.type('[data-testid="target-search"]', '德克萨斯');
      await page.waitForSelector('[data-target="operator:char_102_texas"]', { timeout: 15000 });
      await shot(page, 'picker');
      await page.click('[data-target="operator:char_102_texas"]');
      await page.waitForSelector('[data-testid="create-id"]');
      await page.waitForFunction(() => /^[a-z0-9][a-z0-9-]{1,31}$/.test(document.querySelector('[data-testid="create-id"]')?.value || ''), { timeout: 10000 });
      const id = await page.$eval('[data-testid="create-id"]', (e) => e.value);
      assert.equal(id, 'texas-art', 'an id made from the operator and the template');
      await page.click('[data-testid="create-confirm"]');
      await page.waitForSelector(`.st-plugin[data-plugin="${id}"]`, { timeout: 15000 });
      await page.waitForFunction(() => /已载入/.test(document.querySelector('[data-testid="plugin-status"]')?.textContent || ''), { timeout: 15000 });
      assert.ok(fs.existsSync(path.join(plugins, id, 'plugin.json')));
      // a PNG made on the spot, dropped on the avatar slot (the slot's file input)
      const pic = path.join(tmp, 'red-avatar.png');
      fs.writeFileSync(pic, png(180, 180, [220, 30, 30, 255]));
      const input = await page.$('[data-slot="chars.char_102_texas.avatar"] [data-testid="slot-input"]');
      await input.uploadFile(pic);
      // the preview: the plugin side of the game's card component draws it (its pixels arrived: naturalWidth 180)
      await page.waitForFunction((pid) => {
        const img = document.querySelector('[data-testid="pair-thumb"] .st-pair__col.is-plugin img');
        return !!img && img.src.includes(`/studio/api/plugins/${pid}/f/`) && img.complete && img.naturalWidth === 180;
      }, { timeout: 20000 }, id);
      const orig = await page.$eval('[data-testid="pair-thumb"] .st-pair__col:not(.is-plugin) img', (e) => e.getAttribute('src'));
      assert.doesNotMatch(orig, /\/studio\//, 'the original beside it is the installation\'s');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(plugins, id, 'plugin.json'), 'utf8')).assets, { chars: { char_102_texas: { avatar: 'art/char_102_texas/avatar.png' } } });
      await sleep(600);
      await shot(page, 'preview');
      // 打包并下载: the lock written, the zip downloaded
      await page.click('[data-testid="pack"]');
      await page.waitForSelector('[data-testid="pack-result"].is-ok', { timeout: 20000 });
      let zipFile = null;
      for (let i = 0; i < 100 && !zipFile; i++) {
        const f = fs.readdirSync(downloads).find((n) => n.endsWith('.zip'));
        if (f) zipFile = path.join(downloads, f);
        else await sleep(150);
      }
      assert.ok(zipFile, 'a zip was downloaded');
      assert.equal(path.basename(zipFile), `${id}-1.0.0.zip`);
      const names = unzipFiles(fs.readFileSync(zipFile)).map((e) => e.name);
      assert.deepEqual(names, [`${id}/README.md`, `${id}/art/char_102_texas/avatar.png`, `${id}/plugin.json`, `${id}/plugin.lock.json`]);
      await shot(page, 'packed');
      // another browser profile without the key: the plugins show, the bar asks for the key; the printed address pasted
      const other = await browser.createBrowserContext();
      const p2 = await other.newPage();
      await p2.setViewport({ width: 1600, height: 1000 });
      p2.on('pageerror', (e) => problems.push(`pageerror (no key): ${e.message}`));
      await p2.goto(`${srv.url}/studio/`, { waitUntil: 'domcontentloaded' });
      await p2.waitForFunction(() => globalThis.__studio?.ready === true, { timeout: 30000 });
      await p2.waitForSelector('[data-testid="key-bar"]');
      await p2.waitForSelector(`.st-list__item[data-plugin="${id}"]`);
      await shot(p2, 'no-key');
      await p2.type('[data-testid="key-input"]', srv.studio.pageUrl(srv.url));
      await p2.click('[data-testid="key-bar"] button[type="submit"]');
      await p2.waitForFunction(() => !document.querySelector('[data-testid="key-bar"]'), { timeout: 10000 });
      await other.close();
      assert.deepEqual(problems, []);
      if (process.env.SP_STUDIO_SHOTS) {
        fs.mkdirSync(process.env.SP_STUDIO_SHOTS, { recursive: true });
        for (const f of shots) fs.copyFileSync(f, path.join(process.env.SP_STUDIO_SHOTS, path.basename(f)));
      }
    } finally {
      await browser.close().catch(() => {});
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('删除所选: plugins checked in the list → the confirmation names them → moved to plugins/_removed/, the list follows; one a room uses stays with its reason', { timeout: 3 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-remove-e2e-'));
    const plugins = path.join(tmp, 'plugins');
    const skin = (id, name) => writePlugin(path.join(plugins, id), cosmetic({ name: { zh: name }, assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(2, 2) });
    skin('blue-skin', '蓝色皮肤');
    skin('green-skin', '绿色皮肤');
    skin('room-skin', '房间皮肤');
    skin('keep-skin', '留下的皮肤');
    const { startServer } = await import('../../server/index.js');
    const { StubMatch } = await import('../../server/match/StubMatch.js');
    const { TestClient } = await import('../helpers/wsClient.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, MatchClass: StubMatch });
    const P = (await import('puppeteer-core')).default;
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run', '--force-device-scale-factor=1', '--mute-audio'] });
    let host = null;
    const problems = [];
    fs.mkdirSync(OUT, { recursive: true });
    const shot = (page, name) => page.screenshot({ path: path.join(OUT, `studio-${name}.png`), fullPage: true });
    const removeLabel = (page) => page.$eval('[data-testid="remove-selected"]', (b) => [b.disabled, b.textContent.trim()]);
    try {
      // a room uses room-skin (its host switched it on)
      host = await TestClient.connect(`${srv.url.replace('http', 'ws')}/ws`);
      const me = await host.hello('Saria');
      assert.equal((await host.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
      const room = await host.waitFor('room.state', (s) => s.hostId === me.playerId);
      assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'room-skin' }] })).t, 'ok');
      await host.waitFor('room.state', (s) => !!s.content?.plugins?.some((p) => p.id === 'room-skin'));

      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1000 });
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => { if (!/\/assets\/|\/fonts\//.test(r.url())) problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`); });
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__studio?.ready === true, { timeout: 30000 });
      await page.waitForSelector('.st-list__item[data-plugin="keep-skin"]');
      // blue-skin open on the right
      await page.click('.st-list__item[data-plugin="blue-skin"]');
      await page.waitForSelector('.st-plugin[data-plugin="blue-skin"]', { timeout: 15000 });
      // nothing checked: 删除所选（0）, disabled
      assert.deepEqual(await removeLabel(page), [true, '删除所选（0）']);
      // checked by a click and by the keyboard (Space on the focused checkbox)
      await page.click('[data-check="blue-skin"]');
      await page.focus('[data-check="green-skin"]');
      await page.keyboard.press('Space');
      await page.click('[data-check="room-skin"]');
      assert.deepEqual(await removeLabel(page), [false, '删除所选（3）']);
      assert.equal(await page.$eval('[data-testid="select-all"]', (e) => e.indeterminate), true, 'some checked: 全选 shows it mixed');
      // 全选 → all four; 清除选择 → none
      await page.click('[data-testid="select-all"]');
      assert.deepEqual(await removeLabel(page), [false, '删除所选（4）']);
      await page.click('[data-testid="select-clear"]');
      assert.deepEqual(await removeLabel(page), [true, '删除所选（0）']);
      for (const id of ['blue-skin', 'green-skin', 'room-skin']) await page.click(`[data-check="${id}"]`);
      // the confirmation: the plugins by name and id, where they go and how they come back; Escape cancels
      await page.click('[data-testid="remove-selected"]');
      await page.waitForSelector('[data-testid="remove-confirm"]');
      const named = await page.$$eval('[data-testid="remove-list"] li', (els) => els.map((e) => [e.dataset.plugin, e.textContent.replace(/\s+/g, ' ').trim()]));
      assert.deepEqual(named, [['blue-skin', '蓝色皮肤 blue-skin'], ['green-skin', '绿色皮肤 green-skin'], ['room-skin', '房间皮肤 room-skin']]);
      assert.match(await page.$eval('[data-testid="remove-confirm"]', (e) => e.textContent), /plugins\/_removed\/[\s\S]*移回 plugins\//);
      await shot(page, 'remove-confirm');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[data-testid="remove-confirm"]'));
      assert.ok(fs.existsSync(path.join(plugins, 'blue-skin', 'plugin.json')), 'cancelled: nothing moved');
      assert.equal(fs.existsSync(path.join(plugins, '_removed')), false);
      // confirmed
      await page.click('[data-testid="remove-selected"]');
      await page.waitForSelector('[data-testid="remove-confirm"]');
      await page.click('.modal__actions .btn--danger');
      // the one a room uses: refused, with its reason
      await page.waitForSelector('[data-testid="remove-refused"]', { timeout: 15000 });
      const refused = await page.$$eval('[data-testid="remove-refused"] li', (els) => els.map((e) => [e.dataset.plugin, e.dataset.code, e.textContent]));
      assert.deepEqual(refused.map(([id, code]) => [id, code]), [['room-skin', 'PLUGIN_STUDIO_IN_USE']]);
      assert.match(refused[0][2], new RegExp(`正在使用中（房间 ${room.code}）`));
      assert.match(await page.$eval('[data-testid="remove-refused"]', (e) => e.textContent), /其余 2 个已移到 plugins\/_removed\//);
      await shot(page, 'remove-refused');
      await page.click('.modal__actions .btn--primary');
      await page.waitForFunction(() => !document.querySelector('[data-testid="remove-refused"]'));
      // the list follows, the open plugin closed, the folders in plugins/_removed/ (nothing deleted)
      await page.waitForFunction(() => !document.querySelector('.st-list__item[data-plugin="blue-skin"]') && !document.querySelector('.st-list__item[data-plugin="green-skin"]'), { timeout: 10000 });
      assert.ok(await page.$('.st-list__item[data-plugin="room-skin"]'));
      assert.ok(await page.$('.st-list__item[data-plugin="keep-skin"]'));
      assert.equal(await page.$('.st-plugin[data-plugin="blue-skin"]'), null, 'the plugin open on the right closed');
      const moved = fs.readdirSync(path.join(plugins, '_removed')).sort();
      assert.deepEqual(moved.map((n) => n.replace(/-\d{8}-\d{6}-\d{3}(?:-\d+)?$/, '')), ['blue-skin', 'green-skin']);
      for (const n of moved) assert.ok(fs.existsSync(path.join(plugins, '_removed', n, 'a.png')), n);
      assert.ok(fs.existsSync(path.join(plugins, 'room-skin', 'plugin.json')));
      // the note says what went and has the focus; the refused one stays checked
      await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'remove-result', { timeout: 5000 });
      const note = await page.$eval('[data-testid="remove-result"]', (e) => e.textContent);
      assert.match(note, /已移到 plugins\/_removed\/：2 个插件/);
      assert.match(note, /1 个插件没有删除/);
      assert.deepEqual(await removeLabel(page), [false, '删除所选（1）']);
      assert.equal(await page.$eval('[data-check="room-skin"]', (e) => e.checked), true);
      await shot(page, 'removed');
      assert.deepEqual(problems, []);
    } finally {
      await host?.terminate().catch(() => {});
      await browser.close().catch(() => {});
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
