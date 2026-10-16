// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/bench-overflow.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { makeMatch } from '../match/harness.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('expandable bench display', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const mode of ['fallback', '2d', '3d']) test(`${mode}: only fifteen bench pieces render and server refill reveals the next queued piece`, async (t) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 1426 }).start().toPrep(1);
    t.after(() => h.m.dispose());
    const ps = h.ps('p_0');
    for (const p of ps.allChess()) ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
    const pieces = Array.from({ length: 24 }, () => ps.acquireItem('chess_item_2_03_e_b', { silent: true }));
    assert.ok(pieces.every(Boolean));
    assert.equal(h.m.prepFieldMeta(ps).units.filter((p) => p.area === 'temp').length, 5, 'scouts also see only five temp pieces');
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    const renderer = mode === 'fallback' ? 'fallback' : 'engine';
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&phase=PREP&render=${renderer}&board=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((kind) => globalThis.__SP_VIEW__?.kind === kind, { timeout: 30000 }, renderer);
    if (renderer === 'engine') await page.waitForFunction((on) => globalThis.__SP_VIEW__.raw.stats().board3d.on === on, {}, mode === '3d');
    const renderState = async () => {
      const priv = ps.privateView();
      await page.evaluate(({ hand, temp }) => globalThis.__MOCK__.mutate((s) => {
        s.priv.board = []; s.priv.hand = hand; s.priv.temp = temp;
      }), priv);
      const visible = [...ps.hand, ...ps.temp.slice(0, 5)].filter(Boolean).map((p) => p.uid);
      await page.waitForFunction((uids) => uids.every((uid) => globalThis.__SP_VIEW__.pieceScreenRect(uid)), {}, visible);
      const rendered = await page.evaluate((uids) => uids.filter((uid) => globalThis.__SP_VIEW__.pieceScreenRect(uid)), pieces.map((p) => p.uid));
      assert.deepEqual(rendered.sort((a, b) => a - b), visible.sort((a, b) => a - b));
      assert.equal(rendered.length, 15);
    };
    await renderState();
    if (process.env.SP_BENCH_SCREENSHOTS) {
      mkdirSync(process.env.SP_BENCH_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SP_BENCH_SCREENSHOTS, `${mode}-24-stored.png`) });
    }
    const hidden = ps.temp[5];
    assert.equal(await page.evaluate((uid) => globalThis.__SP_VIEW__.pieceScreenRect(uid), hidden.uid), null);
    assert.deepEqual(ps.destroy(ps.temp[2].uid), { ok: true });
    await renderState();
    if (process.env.SP_BENCH_SCREENSHOTS) {
      await page.screenshot({ path: path.join(process.env.SP_BENCH_SCREENSHOTS, `${mode}-refilled.png`) });
    }
    assert.ok(await page.evaluate((uid) => !!globalThis.__SP_VIEW__.pieceScreenRect(uid), hidden.uid));
    assert.deepEqual(errors, []);
    h.invariants();
  });
});
