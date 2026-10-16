// SP_E2E=1, run this file alone. Requires a listening socket and headless Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';
const enabled = process.env.SP_E2E === '1' && hasChrome();
/** Resolve once `file` exists (a finished download: Chrome writes to a .crdownload name until then). */
async function waitForFile(file, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (fs.existsSync(file)) return;
  assert.fail(`no download ${path.basename(file)}`);
}

test('operator wizard -> borrowed official kit -> saved attributes -> trial -> game-renderer replay and comparison', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gameplay-e2e-'));
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: path.join(tmp, 'plugins'), assetIndex: false });
  const P = (await import('puppeteer-core')).default;
  let browser;
  const errors = [];
  try {
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--mute-audio'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000 });
    page.on('pageerror', e => errors.push(e.message));
    // the pack button downloads the zip: into this test's folder, never the user's Downloads (and a download left
    // waiting for a prompt would keep Chrome from closing)
    const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads);
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__studio?.ready);
    await page.click('[data-testid="new-plugin"]'); await page.click('[data-template="operator"]');
    await page.type('[data-testid="target-search"]', '德克萨斯');
    await page.waitForSelector('[data-target="operator:char_102_texas"]'); await page.click('[data-target="operator:char_102_texas"]');
    await page.waitForFunction(() => /^[a-z0-9][a-z0-9-]{1,31}$/.test(document.querySelector('[data-testid="create-id"]')?.value || ''));
    await page.click('[data-testid="create-confirm"]');
    await page.waitForSelector('[data-testid="operator-wizard"]');
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="operator-wizard"] details[open] .st-stat-grid label:nth-child(2) input')?.value) > 0);
    const made = await page.evaluate(() => globalThis.__studio.state);
    assert.equal(made.check.ok, true);
    const record = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', made.id, 'data/operator.json')));
    assert.equal(record.kit.ref, 'chess_char_1_08_a');
    assert.match(record.charId, /^char_x_/);
    const atk = '[data-testid="operator-wizard"] details[open] .st-stat-grid label:nth-child(2) input';
    await page.waitForSelector(atk); await page.click(atk, { count: 3 }); await page.type(atk, '900');
    await page.click('[data-testid="save-wizard"]');
    await page.waitForFunction(() => globalThis.__studio?.state?.authoring?.options?.normal?.atk === 900);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-operator.png'), fullPage: true });
    await page.click('[data-tab="trial"]'); await page.click('[data-testid="run-trial"]');
    await page.waitForSelector('[data-testid="trial-comparison"]', { timeout: 45000 });
    const result = await page.evaluate(() => globalThis.__studio.trial);
    assert.equal(result.ok, true); assert.ok(result.plugin.damage > result.vanilla.damage);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].filter(e => e.dataset.ready === 'true').length === 2, { timeout: 45000 });
    // the game renderer: a three.js board canvas under the Pixi canvas in each of the two replays
    assert.equal(await page.$$eval('[data-testid="trial-replay"]', els => els.filter(e => e.querySelector('canvas')).length), 2);
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-trial.png'), fullPage: true });
    await page.click('[data-testid="replay-trial"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].every(e => e.dataset.ready === 'true'));
    await page.click('[data-testid="pack"]');
    await page.waitForSelector('[data-testid="pack-result"].is-ok');
    assert.ok(fs.existsSync(path.join(tmp, 'plugins', made.id, 'plugin.lock.json')));
    await waitForFile(path.join(downloads, `${made.id}-1.0.0.zip`));
    const zip = await page.evaluate(async id => {
      const r = await fetch(`/studio/api/plugins/${id}/zip`); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    }, made.id);
    assert.equal(zip.status, 200); assert.ok(zip.bytes > 100);
    // The UI wizard also uses the real game's frame host with fake data and opaque origin.
    const ui = await page.evaluate(async () => {
      const api = await import('/studio/js/api.js');
      return api.post('plugins', { template: 'ui', id: 'preview-widget', name: 'Preview', options: { slot: 'room.panel', title: 'Preview' } });
    });
    assert.equal(ui.check.ok, true);
    await page.goto(srv.studio.pageUrl(srv.url).replace('/studio/#', '/studio/?plugin=preview-widget#'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ui-sandbox-preview"] iframe');
    assert.equal(await page.$eval('[data-testid="ui-sandbox-preview"] iframe', e => e.getAttribute('sandbox')), 'allow-scripts');
    // every message the host posts, by type: the frame answers each demo battle with a storage write, so the last
    // message is usually the storage reply, not the battle
    await page.waitForFunction(() => !!globalThis.__SP_UI_PLUGINS__);
    await page.evaluate(() => {
      const api = globalThis.__SP_UI_PLUGINS__; let last = api.last; api.posted = [];
      Object.defineProperty(api, 'last', { configurable: true, get: () => last, set: m => { last = m; if (m?.t) api.posted.push(m.t); } });
    });
    await page.waitForFunction(() => globalThis.__SP_UI_PLUGINS__.posted.includes('battle'), { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-widget.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});


test('DSL wizard edits a compact operator, refuses failed validation, then runs and packs a real replay', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dsl-e2e-'));
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: path.join(tmp, 'plugins'), assetIndex: false });
  let browser;
  try {
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads);
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__studio?.ready);
    await page.click('[data-testid="new-plugin"]'); await page.click('[data-template="dsl"]');
    await page.waitForFunction(() => /^[a-z0-9][a-z0-9-]{1,31}$/.test(document.querySelector('[data-testid="create-id"]')?.value || ''));
    await page.click('[data-testid="create-confirm"]');
    await page.waitForSelector('[data-testid="dsl-validation"].is-ok');
    const made = await page.evaluate(() => globalThis.__studio.state);
    const refuse = r => { if (r.url().endsWith('/studio/api/validate-dsl')) r.abort('failed'); else r.continue(); };
    await page.setRequestInterception(true);
    page.on('request', refuse);
    const value = '[data-testid="dsl-form"] .st-dsl-mods input[type="number"]';
    await page.click(value, { count: 3 }); await page.type(value, '0.75');
    await page.waitForFunction(() => document.querySelector('[data-testid="dsl-validation"]')?.textContent.includes('校验未完成'));
    await page.click('[data-testid="save-wizard"]');
    await page.waitForSelector('[data-testid="authoring-error"]');
    assert.equal(await page.evaluate(() => globalThis.__studio.state.authoring.revision), made.authoring.revision);
    page.off('request', refuse); await page.setRequestInterception(false);
    await page.click('[data-testid="save-wizard"]');
    await page.waitForFunction(() => globalThis.__studio.state.authoring.options.dsl?.skill.mods.atkPct === 0.75);
    await page.waitForSelector('[data-testid="dsl-validation"].is-ok');
    const saved = await page.evaluate(() => globalThis.__studio.state);
    const op = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', made.id, saved.manifest.operators[0])));
    assert.equal(op.kit.dsl.skill.mods.atkPct, 0.75); assert.ok(saved.manifest.dsl.length);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-dsl.png'), fullPage: true });
    await page.click('[data-tab="trial"]'); await page.click('[data-testid="run-trial"]');
    await page.waitForSelector('[data-testid="trial-comparison"]', { timeout: 45000 });
    const result = await page.evaluate(() => globalThis.__studio.trial);
    assert.equal(result.ok, true); assert.deepEqual(result.plugin.errors, []); assert.ok(result.plugin.damage > 0);
    assert.match(result.plugin.units[0].defId, /chess_x_.*_caster_a/);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].filter(e => e.dataset.ready === 'true').length === 2, { timeout: 45000 });
    await page.click('[data-testid="pack"]'); await page.waitForSelector('[data-testid="pack-result"].is-ok');
    assert.ok(fs.existsSync(path.join(tmp, 'plugins', made.id, 'plugin.lock.json')));
    await waitForFile(path.join(downloads, `${made.id}-1.0.0.zip`));
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
