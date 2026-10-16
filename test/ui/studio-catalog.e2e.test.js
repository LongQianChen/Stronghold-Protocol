// Real-server browser E2E — 「从目录安装」(DESIGN §32.13; opt-in):
//   SP_E2E=1 node --test test/ui/studio-catalog.e2e.test.js
//
// The page reads a catalogue file (it does not download the zip) and posts the text. Install asks the server to
// download the https zip. That download is an injected fetch, so the test does not touch the public network.
// The studio key comes from the address the server prints. A browser that cannot be launched leaves this file unrun.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { zipFiles } from '../../server/plugins/zip.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

describe('the studio catalogue page', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('a local catalogue file lists an entry, and 安装 downloads it on the server', { timeout: 3 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-catalog-e2e-'));
    const plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    const manifest = {
      manifest: 2, id: 'demo-skin', version: '1.0.0', app: '*', api: 1, class: 'cosmetic',
      scope: ['room', 'personal'], permissions: ['assets.override'], assets: {},
    };
    const zip = zipFiles([{ name: 'demo-skin/plugin.json', data: Buffer.from(JSON.stringify(manifest)) }]);
    const digest = sha(zip);
    const catalog = {
      catalog: 1, name: 'E2E catalogue',
      plugins: [{ id: 'demo-skin', name: 'Demo skin', version: '1.0.0', class: 'cosmetic', url: 'https://example.invalid/demo-skin.zip', sha256: digest }],
    };
    const catalogFile = path.join(tmp, 'catalog.json');
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    const fetchImpl = async (url, init) => {
      assert.equal(init.redirect, 'manual');
      assert.equal(url, 'https://example.invalid/demo-skin.zip');
      return new Response(zip, { status: 200 });
    };
    const { startServer } = await import('../../server/index.js');
    let srv;
    let browser;
    const problems = [];
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, fetch: fetchImpl });
      const P = (await import('puppeteer-core')).default;
      browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
      const page = await browser.newPage();
      page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('requestfailed', (r) => { if (!/\/assets\/|\/fonts\//.test(r.url())) problems.push(`${r.url()} ${r.failure()?.errorText}`); });
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__studio?.ready === true, { timeout: 30000 });
      await page.click('[data-testid="catalog-open"]');
      await page.waitForSelector('[data-testid="catalog-page"]');
      const input = await page.$('[data-testid="catalog-file"]');
      await input.uploadFile(catalogFile);
      await page.waitForSelector('[data-id="demo-skin"][data-status="available"]', { timeout: 15000 });
      await page.click('[data-testid="catalog-install"][data-id="demo-skin"]');
      await page.waitForFunction(() => /plugins\/demo-skin/.test(document.querySelector('[data-testid="catalog-note"]')?.textContent || ''), { timeout: 15000 });
      assert.equal(fs.existsSync(path.join(plugins, 'demo-skin', 'plugin.json')), true);
      assert.deepEqual(problems, []);
    } finally {
      if (browser) await browser.close();
      if (srv) await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a catalogue URL loads, installs, and the sidebar opens the plugin', { timeout: 3 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-catalog-url-e2e-'));
    const plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    const manifest = {
      manifest: 2, id: 'demo-skin', version: '1.0.0', app: '*', api: 1, class: 'cosmetic',
      scope: ['room', 'personal'], permissions: ['assets.override'], assets: {},
    };
    const zip = zipFiles([{ name: 'demo-skin/plugin.json', data: Buffer.from(JSON.stringify(manifest)) }]);
    const digest = sha(zip);
    const zipUrl = 'https://example.invalid/demo-skin.zip';
    const catalogUrl = 'https://example.invalid/catalog.json';
    const catalog = {
      catalog: 1, name: 'E2E catalogue',
      plugins: [{ id: 'demo-skin', name: 'Demo skin', version: '1.0.0', class: 'cosmetic', url: zipUrl, sha256: digest }],
    };
    const fetchImpl = async (url, init) => {
      assert.equal(init.redirect, 'manual');
      if (url === catalogUrl) return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === zipUrl) return new Response(zip, { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    };
    const { startServer } = await import('../../server/index.js');
    let srv;
    let browser;
    const problems = [];
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, fetch: fetchImpl });
      const P = (await import('puppeteer-core')).default;
      browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
      const page = await browser.newPage();
      page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('requestfailed', (r) => { if (!/\/assets\/|\/fonts\//.test(r.url())) problems.push(`${r.url()} ${r.failure()?.errorText}`); });
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__studio?.ready === true, { timeout: 30000 });
      await page.click('[data-testid="catalog-open"]');
      await page.waitForSelector('[data-testid="catalog-url"]');
      await page.type('[data-testid="catalog-url"]', catalogUrl);
      await page.click('[data-testid="catalog-load"]');
      await page.waitForSelector('[data-id="demo-skin"][data-status="available"]', { timeout: 15000 });
      await page.click('[data-testid="catalog-install"][data-id="demo-skin"]');
      await page.waitForSelector('[data-id="demo-skin"][data-status="installed"]', { timeout: 15000 });
      await page.waitForSelector('[data-testid="plugin-list"] [data-plugin="demo-skin"]', { timeout: 15000 });
      await page.click('[data-testid="plugin-list"] [data-plugin="demo-skin"]');
      await page.waitForSelector('[data-testid="plugin-status"]', { timeout: 15000 });
      assert.equal(fs.existsSync(path.join(plugins, 'demo-skin', 'plugin.json')), true);
      assert.deepEqual(problems, []);
    } finally {
      if (browser) await browser.close();
      if (srv) await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
