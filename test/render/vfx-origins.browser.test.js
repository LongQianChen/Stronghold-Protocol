// test/render/vfx-origins.browser.test.js — where official shots and weapon effects leave a unit (DESIGN §32.14.36), in a
// real battle in headless Chrome (public/dev/battle-perf.html: a custom lineup against hard-normal-r13's wave, 官方特效
// 完整): 灰毫's shell leaves her raised barrel (its bone at the strike frame — the skin's static Muzzle lay below her
// feet) and lobs about one tile (ParacurveMovement — it rose six); 安洁莉娜's S2 orbs leave her staff held over her head
// and her S2 glow sits on the staff, laid along it (FollowMountPoint with the bone's rotation); 惊蛰 flies her trail, never
// the chain line authored in world space; the console stays clean. Frozen frames → test/e2e/out/vfx-origin-<name>.png.
//
// Opt-in (starts Chrome, needs the local art and the effects extracted from the local client):
//   RENDER_E2E=1 node --test test/render/vfx-origins.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuArgs } from '../../tools/perfbench.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
}[process.platform];
const hasFx = existsSync(path.join(ROOT, 'public/assets/local/fx/index.json'));
const hasArt = existsSync(path.join(ROOT, 'public/assets/spine/op/char_431_ashlok/front/char_431_ashlok.skel'));
const enabled = process.env.RENDER_E2E === '1' && !!CHROME && existsSync(CHROME) && hasFx && hasArt;
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome, the local art and the effects extracted from the local client)';

// [chessId, row, col, dir, skillIndex]: 灰毫 (S2), 安洁莉娜 (S2), 惊蛰 (S1, a stat skill: her normal chains)
const LINEUP = [['chess_char_2_18_b', 11, 4, 'RIGHT', 1], ['chess_char_5_20_b', 12, 4, 'RIGHT', 1], ['chess_char_1_03_b', 10, 4, 'RIGHT', 0]];

describe('official shot and weapon-effect origins in a battle', { skip }, () => {
  let srv, browser, page;
  const problems = [];
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    const msg = JSON.parse(readFileSync(path.join(ROOT, 'public/dev/perf/hard-normal-r13.json'), 'utf8'));
    const p = msg.spec.players[0];
    p.units = LINEUP.map(([chessId, row, col, dir, skillIndex], i) => ({ uid: 900 + i, kind: 'chess', chessId, row, col, dir, items: [], skillIndex }));
    p.bonds = []; p.playerEffects = [];
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...gpuArgs(), '--window-size=1280,720'] });
    mkdirSync(OUT, { recursive: true });
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().includes('/dev/perf/origins.json')) r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(msg) });
      else r.continue();
    });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/battle-perf.html?spec=origins&fx=full&panel=0&quality=high`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__perf && (window.__perf.ready || window.__perf.error), { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__perf.error && String(window.__perf.error)), null);
    // every flight: its shooter, its effects and, for the wanted shooter, its path (the flying effect's anchor each frame)
    await page.evaluate(() => {
      const view = window.__perf.view;
      view.setSettings({ damageNumbers: false });
      const W = view.debug.wiring, ofx = view.debug.ofx, cam = view.debug.cam;
      const pj = (u) => { const q = cam.project(u[0] + 10, u[1] + 9, -u[2]); return { x: q.x, y: q.y }; };
      const st = window.__orig = { shots: [], want: null, done: null };
      let cur = null;
      const spawn = ofx.spawn.bind(ofx);
      ofx.spawn = (key, place, opts) => { const h = spawn(key, place, opts); if (cur && h) cur.push({ key, h, pos: place?.pos?.slice() }); return h; };
      const fly = W._fly.bind(W);
      W._fly = function (proj, src, tgt, kind, time, o = {}) {
        cur = [];
        let r;
        try { r = fly(proj, src, tgt, kind, time, o); } finally {
          const mine = cur; cur = null;
          const s = { spine: src?.info?.spine, skill: !!((src?.flags | 0) & 16), keys: mine.map((m) => m.key) };
          st.shots.push(s);
          const w = st.want;
          if (w && !st.done && s.spine === w.spine && (w.skill == null || w.skill === s.skill) && mine[0]) {
            st.want = null;
            const feet = cam.project(src.x, src.y, src.z || 0);
            const head = mine[0], path = [pj(head.pos)];
            const tick = () => {
              const e = head.h.effect;
              if (e && !e.done && e.state === 'play') { path.push(pj(e.anchor)); requestAnimationFrame(tick); return; }
              // the staff glow of 安洁莉娜's S2 (aglina_skill_02_start): where it sits, which way its +x points
              const glow = ofx.effects.find((f) => f.def?.key === 'aglina_skill_02_start' && f.mountRot);
              let gx = null;
              if (glow) {
                const [x, y, z, ww] = glow.mountRot;
                // rotate (1, 0, 0) by the quaternion (Unity frame)
                gx = { pos: pj(glow.anchor), dir: [1 - 2 * (y * y + z * z), 2 * (x * y + z * ww), 2 * (x * z - y * ww)] };
              }
              st.done = { ...s, feet: { x: feet.x, y: feet.y }, s: feet.s, path, glow: gx };
            };
            requestAnimationFrame(tick);
            // the frame right after the shot left: frozen for the screenshot (released by the test)
            setTimeout(() => { view.debug.app.ticker.stop(); st.frozen = true; }, 30);
          }
        }
        return r;
      };
    });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** Wait for a shot of `spine` (skill on / off / either), screenshot its frozen frame, then let the battle go on. */
  async function shot(name, spine, skill) {
    await page.evaluate((w) => { Object.assign(window.__orig, { want: w, done: null, frozen: false }); }, { spine, skill });
    await page.waitForFunction(() => window.__orig.frozen, { timeout: 60000, polling: 20 });
    await page.screenshot({ path: path.join(OUT, `vfx-origin-${name}.png`) });
    await page.evaluate(() => window.__perf.view.debug.app.ticker.start());
    await page.waitForFunction(() => !!window.__orig.done, { timeout: 15000, polling: 50 });
    return page.evaluate(() => window.__orig.done);
  }

  test('灰毫: the shell leaves her raised barrel and lobs about a tile (the static Muzzle lay under her feet, the arc rose six)', async () => {
    const r = await shot('ashlok', 'char_431_ashlok', false);
    assert.deepEqual(r.keys.slice(0, 1), ['ashlok_attack_01_trail']);
    const [start] = r.path;
    const up = (r.feet.y - start.y) / r.s, right = (start.x - r.feet.x) / r.s;
    assert.ok(up > 0.4 && up < 1.0, `the barrel above her feet: ${up.toFixed(2)} tiles on screen`);
    assert.ok(right > 0.6 && right < 1.4, `in front of her: ${right.toFixed(2)} tiles`);
    // a world tile of height draws half a tile up under the 30° camera: raiseHeight 1 above the muzzle ≈ 0.5 tile on screen
    const top = Math.min(...r.path.map((p) => p.y));
    const rise = (start.y - top) / r.s;
    assert.ok(rise > 0.25 && rise < 0.9, `the arc over the muzzle: ${rise.toFixed(2)} tiles on screen (${r.path.length} frames)`);
  });

  test('安洁莉娜 S2: the orbs leave her staff over her head; the S2 glow sits on the staff, laid along it', async () => {
    const r = await shot('aglina-s2', 'char_291_aglina', null);
    assert.ok(r.keys.includes('aglina_skill_02_trail'), String(r.keys));
    const up = (r.feet.y - r.path[0].y) / r.s;
    assert.ok(up > 1.0, `the staff's tip over her head: ${up.toFixed(2)} tiles (the static MuzzlePoint was at her feet)`);
    assert.ok(r.glow, 'the S2 glow plays with its mount point\'s rotation');
    assert.ok((r.feet.y - r.glow.pos.y) / r.s > 0.4, 'on the staff, not on the ground');
    assert.ok(r.glow.dir[1] > 0.5, `its +x points up the staff: ${r.glow.dir.map((x) => x.toFixed(2))}`);
  });

  test('惊蛰: her trail flies, never the chain line authored in world space', async () => {
    const r = await shot('leizi', 'char_306_leizi', null);
    assert.deepEqual(r.keys.slice(0, 1), ['leizi_attack_01_trail']);
    const lines = await page.evaluate(() => window.__orig.shots.filter((s) => s.spine === 'char_306_leizi' && s.keys.includes('leizi_attack_02_line')).length);
    assert.equal(lines, 0);
  });

  test('the console stays clean', () => {
    assert.deepEqual(problems, []);
  });
});
