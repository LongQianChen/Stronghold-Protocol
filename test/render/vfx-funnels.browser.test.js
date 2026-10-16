// test/render/vfx-funnels.browser.test.js — the 驭械术士's floating units (浮游单元, render/vfx/funnelfx.js, DESIGN §33.18)
// in headless Chrome through the dev viewer's skill demo (public/dev/fx-viewer.html ?skilldemo): the real operators'
// units from the local extraction played through the wiring with hand-stepped frames on a flat grey board →
// screenshots test/e2e/out/vfx-funnel-<name>.png. Each picture must show the unit's own effects (their keys live,
// pixels changed where they sit): 荒芜拉普兰德's wolf at home and its lunge with her normal attack, S3's dispersed wolves
// (their flights, the trace and latched marks, a hit); 洛洛's drone at home, its shot, S2's hits beside the dummy and the
// overload look; 耶拉's token, S2's two tokens and their hits; 至简's drone and its shot; 澄闪's S3 drones; the light tier;
// the kit fx they stand for are claimed (no procedural pillar); the console stays clean.
//
// Opt-in (starts Chrome, needs the effects extracted from the local client: extract.py --only fx --fx-set used):
//   RENDER_E2E=1 node --test test/render/vfx-funnels.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
// the full set (the units' floating units are not in the Phase 1a sample)
const hasFx = existsSync(INDEX) && (() => { try { return !!JSON.parse(readFileSync(INDEX, 'utf8')).units?.char_1038_whitw2; } catch { return false; } })();
const enabled = process.env.RENDER_E2E === '1' && !!CHROME && existsSync(CHROME) && hasFx;
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and the full set of effects extracted from the local client)';

const BG = [64, 64, 64];
const W = 960, H = 540;

/** Pixels of a region that differ from the flat background. */
function changed(img, cx, cy, r) {
  let n = 0;
  for (let y = Math.max(0, Math.round(cy - r)); y < Math.min(img.h, Math.round(cy + r)); y++) {
    for (let x = Math.max(0, Math.round(cx - r)); x < Math.min(img.w, Math.round(cx + r)); x++) {
      const o = (y * img.w + x) * 4;
      if (Math.abs(img.rgba[o] - BG[0]) + Math.abs(img.rgba[o + 1] - BG[1]) + Math.abs(img.rgba[o + 2] - BG[2]) > 12) n++;
    }
  }
  return n;
}

describe('the floating units in headless Chrome', { skip }, () => {
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
    await page.evaluate(() => { window.__fx.stopTicker(); window.__fx.setLoop(false); window.__fx.clear(); });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** Let prefabs, meshes and textures arrive while no battle time passes. */
  async function settle() {
    for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__fx.render()); await new Promise((r) => setTimeout(r, 25)); }
  }

  /**
   * Start the skill demo of `unit` (o: skillDemo options, `tier`), run `script` — [cmd, a, b] (skillCmd) or a number of
   * frames — then screenshot: { img, keys (live effect keys), ret (the commands' results), src / tgt (screen px of the
   * unit's and the dummy's chest), s0 (screen px of the unit's SpecialPoint0) }.
   */
  async function shot(name, unit, o, script) {
    await page.evaluate(async (u, opt) => {
      const fx = window.__fx;
      fx.clear(); fx.stopDemo();
      fx.setTier(opt.tier || 'full');
      fx.skillDemo(u, { ...opt, manual: true });   // no cycle: the script drives it
    }, unit, o);
    await settle();
    const ret = [];
    for (const s of script) {
      if (typeof s === 'number') await page.evaluate((n) => window.__fx.step(n, 1 / 60), s);
      else ret.push(await page.evaluate((c) => window.__fx.skillCmd(c[0], c[1], c[2]), s));
    }
    await page.evaluate(() => window.__fx.render());
    const file = path.join(OUT, `vfx-funnel-${name}.png`);
    const buf = await page.screenshot({ path: file });
    const geo = await page.evaluate(() => {
      const fx = window.__fx;
      const { src, tgt } = fx.skillUnits();
      const w = fx.wiring;
      const skin = w.skinOf(w.unitOf(src));
      const p = skin ? fx.unitPointOf(skin, 's0', w.pose(src)) : null;
      return { src: fx.project(src.x, src.y, 0.4), tgt: fx.project(tgt.x, tgt.y, 0.4), s0: p ? fx.project(p[0] + 10, p[1] + 9, -p[2]) : null, keys: fx.liveKeys(), playing: fx.liveKeys(true) };
    });
    return { img: decodePng(Buffer.from(buf)), ret, ...geo };
  }
  const count = (keys, k) => keys.filter((x) => x === k).length;

  test("荒芜拉普兰德: her wolf floats at its Special point; her normal attack sends it at the dummy (its lunge), then it comes back", async () => {
    const r = await shot('whitw2-home', 'char_1038_whitw2', { s: 2, kind: 'drone', dist: 2 }, [['deploy'], 30]);
    assert.ok(r.playing.includes('whitw2_token_01'), String(r.playing));
    assert.ok(!r.playing.includes('whitw2_token_02'), 'S3 equipped: one wolf');
    assert.ok(r.s0 && changed(r.img, r.s0.x, r.s0.y, 30) > 150, 'the wolf at SpecialPoint0');
    const a = await shot('whitw2-attack', 'char_1038_whitw2', { s: 2, kind: 'drone', dist: 2, hits: 2 }, [['deploy'], 30, ['attack'], 14]);
    for (const k of ['whitw2_attack_01_start', 'whitw2_token_end_01', 'whitw2_token_hit_01']) assert.ok(a.keys.includes(k), `${k} in ${a.keys}`);
    assert.ok(!a.playing.includes('whitw2_token_01'), 'away from home while it lunges');
    assert.ok(changed(a.img, a.tgt.x, a.tgt.y, 70) > 400, 'the lunge on the dummy');
    await page.evaluate(() => { window.__fx.step(110, 1 / 60); window.__fx.render(); });
    assert.ok((await page.evaluate(() => window.__fx.liveKeys(true))).includes('whitw2_token_01'), 'home again');
  });

  test("荒芜拉普兰德 S3: 'drones' releases the dispersed wolves, 'droneLock' sends one after the dummy, it latches and hits; no pillar", async () => {
    const bb = { 'attack@cnt': 2, 'attack@times': 1.3 };
    const r = await shot('whitw2-s3', 'char_1038_whitw2', { s: 2, kind: 'drone', dist: 2, bb },
      [['deploy'], 20, ['on'], ['fx', 'drones', { x: 5, y: 10, n: 3 }], 90, ['fx', 'droneLock', { id: 2, src: 1 }], 120, ['fx', 'drone', { id: 1 }], 8]);
    assert.equal(r.ret[2], true, "'drones' claimed (no light pillar)");
    assert.equal(r.ret[3], true, "'droneLock' claimed (no reticle)");
    assert.equal(r.ret[4], true, "'drone' claimed");
    assert.equal(count(r.playing, 'whitw2_skill_03_token_trail_01'), 3, String(r.playing));
    for (const k of ['whitw2_skill_03_mark_01', 'whitw2_skill_03_mark_02']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(r.keys.some((k) => /^whitw2_token_hit_0\d$/.test(k)), `a hit: ${r.keys}`);
    assert.ok(changed(r.img, r.tgt.x, r.tgt.y, 80) > 600, 'the latched wolf and its hit on the dummy');
    await page.evaluate(() => { window.__fx.skillCmd('off'); window.__fx.step(60, 1 / 60); });
    const left = await page.evaluate(() => window.__fx.liveKeys(true));
    assert.ok(!left.includes('whitw2_skill_03_token_trail_01'), `the skill's end: ${left}`);
    assert.ok(left.includes('whitw2_token_01'), 'the wolf home again');
    // the release: the home wolf leaves, her start loop (WolvesDispersed's 3 s buff), the wolves spreading from her
    const s = await shot('whitw2-s3-release', 'char_1038_whitw2', { s: 2, kind: 'drone', dist: 2, bb }, [['deploy'], 20, ['on'], ['fx', 'drones', { x: 5, y: 10, n: 3 }], 24]);
    for (const k of ['whitw2_token_end_01', 'whitw2_skill_03_buff_start', 'whitw2_skill_03_token_trail_01']) assert.ok(s.keys.includes(k), `${k} in ${s.keys}`);
    assert.ok(changed(s.img, s.src.x, s.src.y, 90) > 800, 'around her');
  });

  test('洛洛: her drone at home, its shot with her attack; S2: the drone beside the dummy hit after hit, the overload look', async () => {
    const r = await shot('rockr-attack', 'char_4040_rockr', { s: 1, kind: 'drone', dist: 2, hits: 2 }, [['deploy'], 30, ['attack'], 6]);
    assert.ok(r.playing.includes('rockr_token_01'), String(r.playing));
    for (const k of ['rockr_attack_trail_01', 'rockr_token_trail_01']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    const s = await shot('rockr-s2', 'char_4040_rockr', { sid: 'skchr_rockr_2', kind: 'drone', dist: 2, bb: { 'attack@cnt': 0 } },
      [['deploy'], 20, ['on'], ['fx', 'drone', { id: 1 }], 12, ['fx', 'drone', { id: 1 }], 10]);
    assert.equal(s.ret[2], true, "'drone' claimed (no light pillar)");
    for (const k of ['rockr_token_hide_01', 'rockr_token_skill_02_hit_l_01', 'rockr_token_skill_02_hit_r_01']) assert.ok(s.keys.includes(k), `${k} in ${s.keys}`);
    assert.ok(!s.playing.includes('rockr_token_01'), 'out with the dummy');
    assert.ok(changed(s.img, s.tgt.x, s.tgt.y, 80) > 300, 'beside the dummy');
    await page.evaluate(() => { window.__fx.skillCmd('fx', 'overload', { id: 1 }); window.__fx.skillCmd('fx', 'drone', { id: 1 }); window.__fx.step(6, 1 / 60); });
    assert.ok((await page.evaluate(() => window.__fx.liveKeys())).includes('rockr_token_skill_02_hit_l_overload_01'), 'the overload groups');
  });

  test("耶拉: her token at home, its cast and shot; S2: two tokens shown, each hits the dummy with its own groups", async () => {
    const r = await shot('kjera-attack', 'char_4013_kjera', { s: 1, kind: 'drone', dist: 2, hits: 2 }, [['deploy'], 30, ['attack'], 6]);
    assert.ok(r.playing.includes('kjera_token_default'), String(r.playing));
    for (const k of ['kjera_token_attack_start_01', 'kjera_token_attack_trail_01']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    const s = await shot('kjera-s2', 'char_4013_kjera', { sid: 'skchr_kjera_2', kind: 'drone', dist: 2, bb: { 'attack@cnt': 1 } },
      [['deploy'], 20, ['on'], 10, ['fx', 'drone', { id: 1 }], ['fx', 'drone', { id: 1 }], 10]);
    for (const k of ['kjera_token_show_01', 'kjera_token_show_02', 'kjera_token_hide_01', 'kjera_token_hide_02', 'kjera_token_skill_02_hit_f_l_01', 'kjera_token_skill_02_hit_f_r_02']) {
      assert.ok(s.keys.includes(k), `${k} in ${s.keys}`);
    }
    assert.ok(changed(s.img, s.tgt.x, s.tgt.y, 80) > 300, 'the tokens beside the dummy');
  });

  test('至简: her drone at home and its shot; 澄闪 S3: three drones hit the dummy; the light tier draws them too', async () => {
    const r = await shot('malist-attack', 'char_4054_malist', { s: 1, kind: 'drone', dist: 2, hits: 2 }, [['deploy'], 30, ['attack'], 6]);
    assert.ok(r.playing.includes('malist_drone'), String(r.playing));
    assert.ok(r.keys.includes('malist_drone_trail'), String(r.keys));
    assert.ok(r.s0 && changed(r.img, r.s0.x, r.s0.y, 25) > 60, 'the drone at SpecialPoint0');
    const g = await shot('gdglow-s3', 'char_377_gdglow', { sid: 'skchr_gdglow_3', kind: 'drone', dist: 2, bb: { 'attack@cnt': 2 } },
      [['deploy'], 20, ['on'], ['fx', 'drones', { x: 5, y: 10, n: 3 }], ['fx', 'drone', { id: 1 }], ['fx', 'drone', { id: 1 }], ['fx', 'drone', { id: 1 }], 10]);
    assert.ok(g.keys.filter((k) => /^gdglow_token_hit_[lr]_0\d$/.test(k)).length >= 3, String(g.keys));
    assert.ok(count(g.keys, 'gdglow_token_hide_01') + count(g.keys, 'gdglow_token_hide_02') + count(g.keys, 'gdglow_token_hide_03') >= 3, String(g.keys));
    const l = await shot('rockr-s2-lite', 'char_4040_rockr', { sid: 'skchr_rockr_2', kind: 'drone', dist: 2, tier: 'lite' }, [['deploy'], 20, ['on'], ['fx', 'drone', { id: 1 }], 10]);
    assert.ok(l.keys.includes('rockr_token_skill_02_hit_l_01'), String(l.keys));
    assert.ok(changed(l.img, l.tgt.x, l.tgt.y, 80) > 150);
  });

  test('the console stays clean', () => {
    assert.deepEqual(problems, []);
  });
});
