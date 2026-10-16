// test/render/board3d.browser.test.js — the official 3D board scene (DESIGN §15) in headless Chrome through the dev
// demo (public/dev/render-demo.html): all 8 active stages in prep and in combat (recorded battles), at 1920×1080 and
// 1280×720 → screenshots test/e2e/out/board3d-<stage>-<prep|combat>-<1080|720>.png; the Pixi layer (units, drag,
// hit-testing) and the three.js layer project every tile centre to the same pixel; the 2D fallback (?board=2d, a
// lost WebGL context) keeps rendering; FPS / draw calls → test/e2e/out/board3d-perf.json.
//
// Opt-in (starts Chrome, needs the local-client art): RENDER_E2E=1 node --test test/render/board3d.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasArt = existsSync(path.join(ROOT, 'public/assets/local/map/autochess/TX_autochessi_D.png'));
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets')) && hasArt;
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome, downloaded assets and the local-client board art)';

const STAGES = [
  ['act1autochess_m01', 'normal-a1m01'], ['act1autochess_m02', 'normal-a1m02'], ['act1autochess_m03', 'normal-a1m03'], ['act1autochess_m04', 'normal-a1m04'],
  ['act2autochess_m01', 'normal-m01'], ['act2autochess_m02', 'normal-m02'], ['act2autochess_m03', 'normal-m03'], ['act2autochess_m04', 'normal-m04'],
];
const SIZES = [[1920, 1080], [1280, 720]];

describe('3D board in headless Chrome', { skip }, () => {
  let srv, browser;
  const perf = { generated: new Date().toISOString(), views: [] };
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    try { writeFileSync(path.join(OUT, 'board3d-perf.json'), JSON.stringify(perf, null, 1)); } catch { /* ignore */ }
    await browser?.close();
    await srv?.close();
  });

  async function open(query, w, h) {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?${query}&panel=0`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    return { page, problems };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const short = (id) => id.replace('autochess_', '-');

  for (const [stageId, rec] of STAGES) {
    for (const [w, h] of SIZES) {
      for (const phase of ['prep', 'combat']) {
        test(`${stageId} ${phase} ${w}×${h}: 3D board on, clean console, few draw calls`, async () => {
          const q = phase === 'prep' ? `scene=prep&stage=${stageId}` : `scene=${rec}&t=30`;
          const { page, problems } = await open(q, w, h);
          await wait(2600);
          const st = await page.evaluate(() => window.__demo.stats());
          await page.screenshot({ path: path.join(OUT, `board3d-${short(stageId)}-${phase}-${h}.png`) });
          await page.close();
          perf.views.push({ stageId, phase, w, h, fps: st.fps, frameMs: st.frameMs, cpuMs: st.cpuMs, renderMs: st.renderMs, calls: st.board3d?.calls, triangles: st.board3d?.triangles, board3dMs: st.board3d?.cpuMs });
          assert.deepEqual(problems, []);
          assert.equal(st.board3d?.on, true, `3D board on (${st.board3d?.error || ''})`);
          assert.ok(st.board3d.calls > 3 && st.board3d.calls <= 20, `draw calls ${st.board3d.calls}`);
          assert.ok(st.fps > 30, `fps ${st.fps}`);
          assert.equal(st.mode, phase === 'prep' ? 'prep' : 'battle');
        });
      }
    }
  }

  test('both layers project every tile centre to the same pixel (units / drag / hit-testing stay aligned)', async () => {
    const { page, problems } = await open('scene=prep&stage=act2autochess_m01', 1600, 900);
    await wait(1500);
    const out = await page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const v = window.__demo.view;
      const res = [];
      for (const kind of ['prep', 'normal', 'unite', 'boss', 'pen']) {
        v.setCamera(kind, { instant: true });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cam = v.debug.cam, b = v.debug.board3d;
        const canvas = b.renderer.domElement;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        b.camera.updateMatrixWorld(true);
        let worst = 0;
        const p = new THREE.Vector3();
        for (let r = 0; r < 19; r++) for (let c = 0; c < 21; c++) {
          const z = v.debug.tiles.heightAt(r, c);
          if (cam.depthOf(c, r, z) < 0.5) continue;
          const a = cam.project(c, r, z);
          p.set(c, r, z).project(b.camera);
          worst = Math.max(worst, Math.abs((p.x + 1) / 2 * W - a.x), Math.abs((1 - p.y) / 2 * H - a.y));
        }
        res.push({ kind, worst, W, H, pixi: [v.debug.app.view.clientWidth, v.debug.app.view.clientHeight] });
      }
      return res;
    });
    await page.close();
    assert.deepEqual(problems, []);
    for (const r of out) {
      assert.ok(r.worst < 0.01, `${r.kind}: ${r.worst} px`);
      assert.deepEqual(r.pixi, [r.W, r.H], 'both canvases cover the same box');
    }
  });

  test('camera transitions rebuild the built areas (normal field → Final Assault boss field → back)', async () => {
    const { page, problems } = await open('scene=prep&stage=act2autochess_m02', 1280, 720);
    await wait(1200);
    const keys = await page.evaluate(async () => {
      const v = window.__demo.view, b = () => v.debug.board3d;
      const k = [b().areaKey];
      v.setCamera('boss');
      await new Promise((r) => setTimeout(r, 200));
      k.push(b().areaKey);                        // union while flying
      await new Promise((r) => setTimeout(r, 1200));
      k.push(b().areaKey);                        // the boss field only
      v.setCamera('prep', { instant: true });
      k.push(b().areaKey);
      return k;
    });
    await page.screenshot({ path: path.join(OUT, 'board3d-transition.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(keys[0], keys[3], 'back to the normal area');
    // the prep board builds the enemy pen block (the maintainer's decision of 2026-10-15: the pen shows in 休整期; user
    // playtest #2 item 6 had kept it to the pen camera), with the field's separator row 13 (user playtest #5 item 6:
    // act2 m01's blowers stand on it); a flight from the prep camera into a battle camera drops the pen at once, so the
    // union while flying is the prep field + the boss field
    assert.equal(keys[0], '13,18,6,14;6,13,0,10', 'prep: the board with the pen block');
    assert.equal(keys[1], '0,6,0,20;6,13,0,10', `union while flying, without the pen: ${keys[1]}`);
    assert.equal(keys[2], '0,6,0,20');
  });

  test('Final Assault prep builds the boss field; battle crates survive a camera flight and a lost context (→ 2D boxes)', async () => {
    const { page, problems } = await open('scene=prep&stage=act1autochess_m01', 1280, 720);
    await wait(1200);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view, b = () => v.debug.board3d;
      const out = {};
      // a 'prep' camera on the boss rows (the right-hand player's half): the boss field is built, drawn and lit
      v.setCamera('prep', { rect: { r0: 0, r1: 5, c0: 10, c1: 20 }, side: 'R', instant: true });
      out.faArea = b().areaKey; out.faBand = v.debug.tiles.band; out.faCamTx = v.debug.cam.tx;
      v.setCamera('prep', { rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, side: 'L', instant: true });
      out.prepArea = b().areaKey;
      // boss battle with two crate devices entered while the camera flies prep → boss (two area rebuilds)
      v.enterBattle({ fieldId: 'fa', kind: 'boss', rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, stageId: 'act1autochess_m01', units: [
        { id: 1, kind: 'device', side: 'enemy', defId: 'trap_1105_accrate', x: 5, y: 4, maxHp: 100 },
        { id: 2, kind: 'device', side: 'enemy', defId: 'trap_1105_accrate', x: 5, y: 3, maxHp: 100 },
      ] });
      v.setCamera('boss', { rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, side: 'L' });
      v.pushEvents({ ev: [['deploy', 1], ['deploy', 2]], gt: 0 });
      for (let i = 0; i < 16; i++) {
        v.pushSnapshot({ fieldId: 'fa', gt: i * 0.1, units: [[1, 5, 4, 100, 100, 0, 0, 0, 0], [2, 5, 3, 100, 100, 0, 0, 0, 0]] });
        await new Promise((res) => setTimeout(res, 100));
      }
      out.bossArea = b().areaKey;
      out.devices = b().devices.size;
      out.attached = b().dynamic.children.filter((m) => m.visible).length;
      // lost context → 2D board: the crates become Pixi boxes (parented in the unit layer)
      b().renderer.forceContextLoss();
      await new Promise((res) => setTimeout(res, 600));
      out.on = !!v.debug.board3d;
      out.pixiBoxes = [1, 2].map((id) => { const dv = v.debug.views.get(id); return !!(dv && dv.box && dv.box.mesh && dv.box.mesh.parent); });
      return out;
    });
    await page.screenshot({ path: path.join(OUT, 'board3d-fa-crates-2d.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(r.faArea, '0,6,0,20', 'FA prep builds the boss field');
    assert.deepEqual(r.faBand, [0, 13]);
    assert.ok(r.faCamTx > 10, `right-hand boss prep camera (tx ${r.faCamTx})`);
    assert.equal(r.prepArea, '13,18,6,14;6,13,0,10', 'prep board with the pen block (the decision of 2026-10-15) and the row-13 wall');
    assert.equal(r.bossArea, '0,6,0,20');
    assert.equal(r.devices, 2);
    assert.equal(r.attached, 2, 'both crate meshes still in the scene after the flight');
    assert.equal(r.on, false);
    assert.deepEqual(r.pixiBoxes, [true, true]);
  });

  test('fallbacks: ?board=2d draws the atlas board; a lost WebGL context switches to 2D without errors', async () => {
    const a = await open('scene=prep&stage=act2autochess_m03&board=2d', 1280, 720);
    await wait(1500);
    const s2 = await a.page.evaluate(() => window.__demo.stats());
    await a.page.screenshot({ path: path.join(OUT, 'board3d-fallback-2d.png') });
    await a.page.close();
    assert.deepEqual(a.problems, []);
    assert.equal(s2.board3d.on, false);
    assert.equal(s2.boardArt, true, '2D atlas board with the real art');
    const b = await open('scene=normal-m03&t=20', 1280, 720);
    await wait(1500);
    const lost = await b.page.evaluate(async () => {
      const v = window.__demo.view;
      const before = v.stats().board3d.on;
      v.debug.board3d.renderer.forceContextLoss();
      await new Promise((r) => setTimeout(r, 500));
      const after = v.stats().board3d;
      const back = await v.setBoardMode('3d');
      return { before, after: after.on, back };
    });
    await wait(800);
    await b.page.screenshot({ path: path.join(OUT, 'board3d-context-restored.png') });
    await b.page.close();
    assert.deepEqual(b.problems, []);
    assert.deepEqual(lost, { before: true, after: false, back: true });
  });

  test('no local-art manifest: 2D board, three.js is never downloaded; settings quality toggles the 3D shadows', async () => {
    const page = await browser.newPage();
    const problems = [], three = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().includes('/vendor/three')) three.push(r.url());
      if (r.url().endsWith('/data/local-assets.json')) r.respond({ status: 404, body: '' }); else r.continue();
    });
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&panel=0`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    await wait(1200);
    const s = await page.evaluate(() => window.__demo.stats());
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(s.board3d.on, false);
    assert.deepEqual(three, [], 'three.js not fetched without the board art');
    const q = await open('scene=prep&stage=act2autochess_m02', 1280, 720);
    await wait(1200);
    const sh = await q.page.evaluate(async () => {
      const v = window.__demo.view, out = [];
      for (const quality of ['low', 'high']) {
        v.setSettings({ quality });
        await new Promise((r) => setTimeout(r, 300));
        out.push(v.debug.board3d.renderer.shadowMap.enabled);
      }
      return out;
    });
    await q.page.close();
    assert.deepEqual(q.problems, []);
    assert.deepEqual(sh, [false, true]);
  });

  test('stress: 120 units over the 3D board keep 60 fps-class frame times', async () => {
    const { page, problems } = await open('scene=stress', 1920, 1080);
    await wait(6000);
    const st = await page.evaluate(() => window.__demo.stats());
    await page.screenshot({ path: path.join(OUT, 'board3d-stress.png') });
    await page.close();
    perf.stress = { fps: st.fps, frameMs: st.frameMs, cpuMs: st.cpuMs, renderMs: st.renderMs, units: st.units, calls: st.board3d?.calls, board3dMs: st.board3d?.cpuMs };
    assert.deepEqual(problems, []);
    assert.equal(st.board3d.on, true);
    assert.equal(st.units, 120);
    assert.ok(st.fps > 45, `fps ${st.fps}`);
    assert.ok(st.board3d.cpuMs < 3, `3D board JS per frame ${st.board3d.cpuMs} ms`);
  });

  test('summary written', () => {
    if (perf.views.length) {
      const fps = perf.views.map((v) => v.fps);
      perf.summary = { views: perf.views.length, minFps: Math.min(...fps), meanFps: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length * 10) / 10, maxCalls: Math.max(...perf.views.map((v) => v.calls || 0)) };
    }
    writeFileSync(path.join(OUT, 'board3d-perf.json'), JSON.stringify(perf, null, 1));
    assert.ok(JSON.parse(readFileSync(path.join(OUT, 'board3d-perf.json'), 'utf8')));
  });
});
