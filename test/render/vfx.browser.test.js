// test/render/vfx.browser.test.js — the official battle effects (render/vfx, DESIGN §33) in headless Chrome through
// the dev viewer (public/dev/fx-viewer.html): a few extracted effects played with fixed seeds and hand-stepped frames
// on a flat grey stand-in for the board → screenshots test/e2e/out/vfx-<name>.png; each picture must show the effect
// (pixels changed around its anchor) and blend as its materials say: the additive hits only brighten the board, the
// alpha-blended debris of a death darkens it (the effect canvas's alpha composites over the board), the frozen block
// tints it blue; an attack (隐现's casts, projectile and hit from index.json) draws its streak between the two units;
// the light tier (精简) still draws; the console stays clean.
//
// Opt-in (starts Chrome, needs the effects extracted from the local client: extract.py --only fx):
//   RENDER_E2E=1 node --test test/render/vfx.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../tools/crop-board-atlas.mjs';
import { gpuArgs } from '../../tools/perfbench.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
}[process.platform];
const hasFx = existsSync(path.join(ROOT, 'public/assets/local/fx/index.json'));
const enabled = process.env.RENDER_E2E === '1' && !!CHROME && existsSync(CHROME) && hasFx;
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and the effects extracted from the local client)';

const BG = [64, 64, 64];
const W = 960, H = 540;

/** Luminance statistics of a region of a decoded screenshot: changed pixels, brighter / darker than the background. */
function region(img, cx, cy, r) {
  let changed = 0, brighter = 0, darker = 0, n = 0, maxL = 0, minL = 255, sumR = 0, sumB = 0;
  const bgL = 0.299 * BG[0] + 0.587 * BG[1] + 0.114 * BG[2];
  for (let y = Math.max(0, Math.round(cy - r)); y < Math.min(img.h, Math.round(cy + r)); y++) {
    for (let x = Math.max(0, Math.round(cx - r)); x < Math.min(img.w, Math.round(cx + r)); x++) {
      const o = (y * img.w + x) * 4, R = img.rgba[o], G = img.rgba[o + 1], B = img.rgba[o + 2];
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      n++;
      if (Math.abs(R - BG[0]) + Math.abs(G - BG[1]) + Math.abs(B - BG[2]) > 12) { changed++; sumR += R; sumB += B; }
      if (L > bgL + 25) brighter++;
      if (L < bgL - 20) darker++;
      maxL = Math.max(maxL, L); minL = Math.min(minL, L);
    }
  }
  return { n, changed, brighter, darker, maxL, minL, bgL, blueTint: changed ? (sumB - sumR) / changed : 0 };
}

describe('official battle effects in headless Chrome', { skip }, () => {
  let srv, browser, page;
  const problems = [];
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: gpuArgs() });
    mkdirSync(OUT, { recursive: true });
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/fx-viewer.html?panel=0&grid=0&bg=%23404040&key=common_hit_01`);
    await page.waitForFunction('window.__fx && window.__fx.ready', { timeout: 60000 });
    const err = await page.evaluate(() => window.__fx.error);
    assert.equal(err, null, `viewer: ${err}`);
    await page.evaluate(() => { window.__fx.stopTicker(); window.__fx.setLoop(false); });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** Play `key` (or the attack demo of `attack`), step `frames` frames of 1/60 s at 2×, screenshot, decode. */
  async function shot(name, o) {
    await page.evaluate(async (opt) => {
      const fx = window.__fx;
      fx.clear(); fx.stopDemo();
      fx.setTier(opt.tier || 'full');
      fx.setUnit(opt.unit || ''); fx.setFace(!!opt.left);
      if (opt.attack) fx.attackDemo(opt.attack, { kind: opt.kind });
      else await fx.play(opt.key, { seed: 11 });
    }, o);
    // prefabs, meshes and textures arrive while no battle time passes
    for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__fx.render()); await new Promise((r) => setTimeout(r, 25)); }
    await page.evaluate((n) => { window.__fx.step(n, 1 / 60); window.__fx.render(); }, o.frames);
    const file = path.join(OUT, `vfx-${name}.png`);
    const buf = await page.screenshot({ path: file });
    const tile = await page.evaluate(() => { const t = window.__fx.unitTile(); return { a: window.__fx.project(t.col, t.row, 0.3), b: window.__fx.project(t.col + 3, t.row, 0.3), mid: window.__fx.project(t.col + 1.5, t.row, 0.3) }; });
    return { img: decodePng(Buffer.from(buf)), ...tile, stats: await page.evaluate(() => window.__fx.stats()) };
  }

  test('an additive hit spark brightens the board around its anchor and never darkens it much', async () => {
    const r = await shot('common_magic_hit_01', { key: 'common_magic_hit_01', frames: 3 });
    const s = region(r.img, r.a.x, r.a.y, 60);
    assert.ok(s.changed > 150, `changed ${s.changed}`);
    assert.ok(s.brighter > 80 && s.maxL > s.bgL + 100, `brighter ${s.brighter}, max ${s.maxL}`);
    assert.ok(s.darker < s.changed * 0.05, `darker ${s.darker} of ${s.changed}`);
    assert.ok(r.stats.particles > 0 && r.stats.programs > 0);
  });

  test("the generic physical hit (common_hit_01): spark, flash and its dark base composite onto the board", async () => {
    const r = await shot('common_hit_01', { key: 'common_hit_01', unit: 'char_498_inside', frames: 4 });
    const s = region(r.img, r.a.x, r.a.y, 50);
    assert.ok(s.changed > 100 && s.brighter > 40, JSON.stringify(s));
  });

  test("an enemy's death: the alpha-blended debris darkens the board (the canvas alpha covers it)", async () => {
    const r = await shot('common_enemy_die_01', { key: 'common_enemy_die_01', frames: 22 });
    const s = region(r.img, r.a.x, r.a.y - 20, 110);
    assert.ok(s.darker > 40 && s.minL < s.bgL - 30, JSON.stringify(s));
  });

  test('the 冻结 loop (buff_autochess_frozen) tints the unit blue', async () => {
    const r = await shot('buff_autochess_frozen', { key: 'buff_autochess_frozen', unit: 'char_498_inside', frames: 30 });
    const s = region(r.img, r.a.x, r.a.y - 15, 70);
    assert.ok(s.changed > 600, `changed ${s.changed}`);
    assert.ok(s.blueTint > 25, `blue tint ${s.blueTint}`);
  });

  test("an attack from index.json: 隐现's shot streaks from her muzzle towards the dummy 3 tiles away", async () => {
    const r = await shot('attack-char_498_inside', { attack: 'char_498_inside', kind: 'arrow', frames: 7 });
    const s = region(r.img, r.mid.x, r.mid.y, 45);
    assert.ok(s.changed > 60 && s.brighter > 15, JSON.stringify(s));
    assert.ok(r.stats.effects >= 2, `effects ${r.stats.effects}`);
  });

  test('the light tier (精简) draws with half-size textures', async () => {
    const r = await shot('common_magic_hit_01-lite', { key: 'common_magic_hit_01', frames: 3, tier: 'lite' });
    const s = region(r.img, r.a.x, r.a.y, 60);
    assert.ok(s.changed > 100 && s.brighter > 40, JSON.stringify(s));
    assert.equal(r.stats.tier, 'lite');
  });

  test('the console stays clean', async () => {
    const fallbacks = await page.evaluate(() => window.__fx.fallbacks());
    writeFileSync(path.join(OUT, 'vfx-fallbacks.json'), JSON.stringify(fallbacks, null, 1));
    assert.deepEqual(problems, []);
  });
});
