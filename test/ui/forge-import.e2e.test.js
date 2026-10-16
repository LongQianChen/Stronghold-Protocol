// Browser check for 从 Forge 包导入 (DESIGN §32.12). Opt-in:
//   SP_E2E=1 node --test test/ui/forge-import.e2e.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { zipFiles } from '../../server/plugins/zip.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIN = path.join(ROOT, 'test', 'fixtures', 'forge', 'skin-pack');

describe('Forge import in the studio page', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('open the dialog, preview a zip, confirm, and see the plugin in the list', { timeout: 120000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-e2e-'));
    const plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    const P = (await import('puppeteer-core')).default;
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    try {
      const files = [];
      const walk = (abs, rel) => {
        for (const name of fs.readdirSync(abs)) {
          const p = path.join(abs, name);
          const next = rel ? `${rel}/${name}` : name;
          if (fs.statSync(p).isDirectory()) walk(p, next);
          else files.push({ name: next, data: fs.readFileSync(p) });
        }
      };
      walk(SKIN, '');
      const zipPath = path.join(tmp, 'rose-skin.zip');
      fs.writeFileSync(zipPath, zipFiles(files));
      const page = await browser.newPage();
      // (domcontentloaded: the studio keeps its event stream open, so the network never idles)
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="forge-import"]');
      await page.click('[data-testid="forge-import"]');
      await page.waitForSelector('[data-testid="forge-zip"]');
      const input = await page.$('[data-testid="forge-zip"]');
      await input.uploadFile(zipPath);
      // Preview waits for the file to be read (the button is disabled while reading)
      await page.waitForFunction(() => { const el = document.querySelector('[data-testid="forge-preview"]'); return el && !el.disabled; });
      await page.click('[data-testid="forge-preview"]');
      await page.waitForSelector('[data-testid="forge-report"]');
      const report = await page.$eval('[data-testid="forge-report"]', (el) => el.textContent);
      assert.match(report, /rose-skin/);
      await page.click('[data-testid="forge-confirm"]');
      await page.waitForSelector('[data-plugin="rose-skin"]');
      assert.ok(fs.existsSync(path.join(plugins, 'rose-skin', 'IMPORT-REPORT.md')));
    } finally {
      await browser.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a pack with a kit shows the script note; the no-scripts box clears the report and leaves the script plugin out', { timeout: 120000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-e2e-kit-'));
    const plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    const P = (await import('puppeteer-core')).default;
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    try {
      // built in memory: node --test runs every .js under test/, so the kit is not a fixture file
      const pair = (id, golden) => ({ chessId: id, baseId: 'chess_rose_kit_a', goldenId: 'chess_rose_kit_b', isGolden: golden, tier: 3, rarity: 4,
        name: '玫瑰行为', charId: 'char_102_texas', profession: 'SNIPER', subProfessionId: 'fastshot', position: 'RANGED', bonds: ['deputShip'],
        stats: { maxHp: 1000, atk: 400, def: 100, res: 0, cost: 12, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 70 }, rangeGrid: [[0, 0]],
        skills: [{ skillId: 'sk_rose_kit', name: '瞄准', duration: 10, spCost: 40, initSp: 0, bb: { atk: 0.3 }, isDefault: true }] });
      const zipPath = path.join(tmp, 'rose-kit.zip');
      fs.writeFileSync(zipPath, zipFiles([
        { name: 'pack.json', data: Buffer.from(JSON.stringify({ id: 'rose-kit', name: '玫瑰行为', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] })) },
        { name: 'chess.json', data: Buffer.from(JSON.stringify({ chess_rose_kit_a: pair('chess_rose_kit_a', false), chess_rose_kit_b: pair('chess_rose_kit_b', true) })) },
        { name: 'kits/chess_rose_kit_a.js', data: Buffer.from("export default function kit() { return { skill: { kind: 'passive', mods: { atkPct: 0.1 } } }; }\n") },
      ]));
      const page = await browser.newPage();
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="forge-import"]');
      await page.click('[data-testid="forge-import"]');
      await page.waitForSelector('[data-testid="forge-zip"]');
      await (await page.$('[data-testid="forge-zip"]')).uploadFile(zipPath);
      const previewReady = () => page.waitForFunction(() => { const el = document.querySelector('[data-testid="forge-preview"]'); return el && !el.disabled; });
      await previewReady();
      await page.click('[data-testid="forge-preview"]');
      await page.waitForSelector('[data-testid="forge-report"]');
      assert.match(await page.$eval('[data-testid="forge-report"]', (el) => el.textContent), /kits-rose-kit/);
      assert.ok(await page.$('[data-testid="forge-script-note"]'));
      await page.click('[data-testid="forge-no-scripts"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="forge-report"]'));
      assert.equal(await page.$eval('[data-testid="forge-confirm"]', (el) => el.disabled), true);
      await previewReady();
      await page.click('[data-testid="forge-preview"]');
      await page.waitForSelector('[data-testid="forge-report"]');
      assert.equal(await page.$('[data-testid="forge-script-note"]'), null);
      assert.doesNotMatch(await page.$eval('[data-testid="forge-report"]', (el) => el.textContent), /### script/);
      await page.click('[data-testid="forge-confirm"]');
      await page.waitForSelector('[data-plugin="rose-kit"]');
      assert.equal(fs.existsSync(path.join(plugins, 'kits-rose-kit')), false);
      assert.ok(fs.existsSync(path.join(plugins, 'rose-kit', 'IMPORT-REPORT.md')));
    } finally {
      await browser.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a second file chosen while the first report is open clears it and keeps confirm disabled', { timeout: 120000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-e2e-race-'));
    const plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    const P = (await import('puppeteer-core')).default;
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    try {
      const files = [];
      const walk = (abs, rel) => {
        for (const name of fs.readdirSync(abs)) {
          const p = path.join(abs, name);
          const next = rel ? `${rel}/${name}` : name;
          if (fs.statSync(p).isDirectory()) walk(p, next);
          else files.push({ name: next, data: fs.readFileSync(p) });
        }
      };
      walk(SKIN, '');
      const zipA = path.join(tmp, 'a.zip');
      const zipB = path.join(tmp, 'b.zip');
      fs.writeFileSync(zipA, zipFiles(files));
      fs.writeFileSync(zipB, zipFiles(files));
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        const orig = FileReader.prototype.readAsDataURL;
        FileReader.prototype.readAsDataURL = function (blob) {
          const reader = this;
          setTimeout(() => orig.call(reader, blob), 1500);
        };
      });
      await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="forge-import"]');
      await page.click('[data-testid="forge-import"]');
      await page.waitForSelector('[data-testid="forge-zip"]');
      const input = await page.$('[data-testid="forge-zip"]');
      await input.uploadFile(zipA);
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-preview"]');
        return el && !el.disabled;
      });
      await page.click('[data-testid="forge-preview"]');
      await page.waitForSelector('[data-testid="forge-report"]');
      await input.uploadFile(zipB);
      await page.waitForSelector('.st-step[data-reading="1"]');
      assert.equal(await page.$('[data-testid="forge-report"]'), null);
      assert.equal(await page.$eval('[data-testid="forge-confirm"]', (el) => el.disabled), true);
      await page.waitForFunction(() => !document.querySelector('.st-step[data-reading="1"]'), { timeout: 8000 });
      assert.equal(await page.$('[data-testid="forge-report"]'), null);
      assert.equal(await page.$eval('[data-testid="forge-confirm"]', (el) => el.disabled), true);
    } finally {
      await browser.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
