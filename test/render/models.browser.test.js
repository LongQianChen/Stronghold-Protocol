// test/render/models.browser.test.js — user playtest #3 item 1 and user playtest #4 item 1 in headless Chrome, through the
// in-match mock (public/dev/game-mock.html: the real game screen, a mock server behind net.request):
//   #3.1  operator models never go missing: after a battle that outlasts the Spine LRU grace, the battle → prep switch
//         (every battle view destroyed, the prep views built in the same task) used to unload the bench models and hand
//         the doomed skeletons straight back (PIXI.Assets serves an unloading asset from its loader cache): invisible
//         chibis. Also a burst of rapid drags / swaps / direction-wheel previews and commits / cancels / re-drags. After
//         each: every prep piece has a view, visible, on its tile, drawing a live Spine model (textures alive) — and the
//         canvas pixels over it change when it is hidden (it really draws something).
//   #4.1  picking by tile ("地上都画好了一个一个方格，点击对应方格就选中那个方格的人物就行"): a press anywhere on a tile — board
//         (adjacent rows and columns, high ground), bench, temporary bench — selects the unit on it and an empty tile
//         nothing (a press on a unit's head, drawn over the tile behind it, is a press on that tile), in prep and in battle
//         (allies by their tile, enemies by their ground position or drawn body); a dragged unit stands on the tile under
//         the pointer while that is a legal target — wherever the pointer is on the tile, as in the official deploy drag
//         (the owner's recording of 2026-10-09; PR #403's report) — and is held under the pointer elsewhere (over the
//         shop, folded to its tab while a piece is carried: its drawn feet DRAG_HOLD_TILES below it, the model around
//         it), for a mouse and a finger (phone, 844×390); the drop, its tileHover and the direction wheel are the tile
//         under the pointer; equipment dropped on a tile equips the unit on it (not the one in front whose head is drawn
//         there); on a phone a release on a bench slot lands there and one over the shop tab goes back. Targets are aimed
//         after the pickup: picking a piece up on the own prep board zooms it (the deploy fold, GitHub #602).
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/models.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default. Screenshots → test/e2e/out/models-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cameraSettled } from '../e2e/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Page-side helpers (installed once per page): the prep pieces, their views, the invariants of item 1. */
function installHelpers() {
  const G = { HAND_ROW: 7, TEMP_ROW: 8, TEMP_C0: 4 };
  const raw = () => globalThis.__SP_VIEW__.raw;
  const priv = () => globalThis.__MOCK__.store.get().match.private;
  const texOk = (t) => !!t && !t.destroyed && !!t.baseTexture && !t.baseTexture.destroyed && t.baseTexture.valid !== false;
  window.__t = {
    pieces() {
      const p = priv(), out = [];
      (p.board || []).forEach((x) => x && out.push({ uid: x.uid, kind: x.kind, row: x.row, col: x.col }));
      (p.hand || []).forEach((x, i) => x && out.push({ uid: x.uid, kind: x.kind, row: G.HAND_ROW, col: i }));
      (p.temp || []).forEach((x, i) => x && out.push({ uid: x.uid, kind: x.kind, row: G.TEMP_ROW, col: G.TEMP_C0 + i }));
      return out;
    },
    /** Client point `up` tiles above the feet of a view (+ `dx` tiles aside); views keyed 'p:uid' (prep) or unit id. */
    at(key, up, dx = 0) {
      const R = raw(), v = R.debug.views.get(key), cv = R.debug.app.view.getBoundingClientRect();
      return { x: cv.left + v.screen.x + dx * v.screen.s, y: cv.top + v.screen.y - up * v.screen.s };
    },
    /** Item 1 invariants; returns the problems found. */
    check() {
      const R = raw(), problems = [];
      for (const p of this.pieces()) {
        const v = R.debug.views.get('p:' + p.uid), tag = `${p.uid}@${p.row},${p.col}`;
        if (!v || v.destroyed) { problems.push(`${tag}: no view`); continue; }
        if (!v.root.visible || !(v.root.alpha > 0.9)) problems.push(`${tag}: hidden (${v.root.visible}, ${v.root.alpha})`);
        if (Math.abs(v.x - p.col) > 0.05 || Math.abs(v.y - p.row) > 0.05) problems.push(`${tag}: parked at ${v.x.toFixed(2)},${v.y.toFixed(2)}`);
        if (p.kind === 'item') continue;
        if (!v.actor || !v.spineReady) { problems.push(`${tag}: no Spine model`); continue; }
        let dead = 0, n = 0;
        for (const slot of v.actor.spine.skeleton.slots) { const s = slot.currentSprite || slot.currentMesh; if (!s || !s.texture) continue; n++; if (!texOk(s.texture)) dead++; }
        if (dead) problems.push(`${tag}: ${dead}/${n} textures destroyed`);
        if (v.imp) { if (!texOk(v.imp.sprite.texture)) problems.push(`${tag}: impostor texture destroyed`); }
        else if (v.actor.spine.parent !== v.body || !v.actor.spine.visible || !(v.actor.spine.alpha > 0.9)) problems.push(`${tag}: model not shown`);
      }
      return problems;
    },
    /** Share of the pixels over each unit's body that change when the unit is hidden (≈ 0: nothing drawn). */
    drawn() {
      const R = raw(), app = R.debug.app, rd = app.renderer, gl = rd.gl, res = rd.resolution, H = rd.view.height, out = {};
      for (const p of this.pieces()) {
        if (p.kind === 'item') continue;
        const v = R.debug.views.get('p:' + p.uid);
        if (!v) continue;
        const b = v.bounds();
        const x0 = Math.max(0, Math.floor(b.x * res)), y0 = Math.max(0, Math.floor(b.y * res));
        const w = Math.max(1, Math.min(Math.floor(b.width * res), rd.view.width - x0)), h = Math.max(1, Math.min(Math.floor(b.height * res), H - y0));
        const read = () => { R.debug.ctx.impostors?.flush?.(); rd.render(app.stage); const px = new Uint8Array(w * h * 4); gl.readPixels(x0, H - y0 - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        const a = read();
        v.root.visible = false;
        const c = read();
        v.root.visible = true;
        let diff = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]) + Math.abs(a[i + 3] - c[i + 3]) > 40) diff++;
        out[p.uid] = diff / (w * h);
      }
      return out;
    },
  };
}

describe('user playtest #3 items 1 and 7 (mock match, headless Chrome)', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--force-device-scale-factor=1'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(query, w = 1920, h = 1080) {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?shot=1&render=engine&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)') && !!globalThis.__SP_VIEW__?.raw?.debug, { timeout: 30000 });
    await page.evaluate(installHelpers);
    await sleep(2000); // Spine models
    return { page, problems };
  }
  const setPhase = (page, ph) => page.evaluate(async (p) => { const { PHASE } = await import('/shared/constants.js'); globalThis.__MOCK__.setPhase(PHASE[p]); }, ph);
  const uidAt = (page, row, col) => page.evaluate((r, c) => globalThis.__MOCK__.S().priv.board.find((p) => p.row === r && p.col === c)?.uid ?? null, row, col);
  const assertAllDrawn = async (page, label) => {
    assert.deepEqual(await page.evaluate(() => window.__t.check()), [], `${label}: every prep model alive and in place`);
    const drawn = await page.evaluate(() => window.__t.drawn());
    for (const [uid, frac] of Object.entries(drawn)) assert.ok(frac > 0.05, `${label}: unit ${uid} draws pixels (${frac.toFixed(3)})`);
  };

  test('1: the prep models come back alive after a battle that outlasts the Spine LRU grace', async () => {
    const { page, problems } = await open('phase=PREP');
    await assertAllDrawn(page, 'first prep');
    // a short grace stands in for a long battle (default 15 s)
    await page.evaluate(async () => { const { assets } = await import('/js/assets.js'); assets.spine.cache.idleGrace = 400; });
    for (let round = 0; round < 2; round++) {
      await setPhase(page, 'COMBAT');
      await sleep(2000);
      await setPhase(page, 'PREP');
      await sleep(2500);
      await assertAllDrawn(page, `prep after battle ${round + 1}`);
    }
    const st = await page.evaluate(async () => (await import('/js/assets.js')).assets.spine.stats());
    assert.equal(st.unloading, 0);
    await page.screenshot({ path: path.join(OUT, 'models-after-battles.png') });
    await page.close();
    assert.deepEqual(problems, []);
  });

  test('1: rapid drags, swaps, wheel previews (all four directions) with commit / Esc / ✕ and re-drags keep every model', async () => {
    const { page, problems } = await open('phase=PREP', 1600, 900);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const tiles = await page.evaluate(() => { const st = globalThis.__MOCK__.S().stage; return [...st.deployTiles.normal.melee, ...st.deployTiles.normal.rangedOnly]; });
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
      await page.mouse.up();
    };
    const wheel = async (how) => {
      const g = await page.evaluate(() => { const el = document.querySelector('.fwheel__dia'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height / 2 }; });
      if (!g) return;
      if (how === 'esc') { await page.keyboard.press('Escape'); return; }
      if (how === 'x') { await page.click('.fwheel__cancel').catch(() => {}); return; }
      await page.mouse.move(g.x, g.y); await page.mouse.down();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) await page.mouse.move(g.x + dx * g.h * 0.6, g.y + dy * g.h * 0.6, { steps: 3 });
      if (how === 'up') await page.mouse.move(g.x, g.y - g.h * 0.6, { steps: 2 });
      await page.mouse.up();
    };
    for (let burst = 0; burst < 2; burst++) {
      for (let k = 0; k < 16; k++) {
        const units = (await page.evaluate(() => window.__t.pieces())).filter((p) => p.kind !== 'item');
        const p = units[Math.floor(rnd() * units.length)];
        const [row, col] = rnd() < 0.8 ? tiles[Math.floor(rnd() * tiles.length)] : [7, Math.floor(rnd() * 10)];
        const from = await page.evaluate((u) => window.__t.at('p:' + u, 0.1), p.uid); // on its own tile
        const to = await page.evaluate((r, c) => globalThis.__SP_VIEW__.raw.tileScreen(r, c), row, col);
        await drag(from, to);
        await sleep(40 + rnd() * 80);
        await wheel(['up', 'up', 'left', 'esc', 'x'][Math.floor(rnd() * 5)]);
        await sleep(rnd() < 0.5 ? 20 : 300); // re-drag before the mock server answered, or after
      }
      await page.keyboard.press('Escape');
      await sleep(1800);
      await assertAllDrawn(page, `burst ${burst + 1}`);
    }
    await page.close();
    assert.deepEqual(problems, []);
  });

  /** Client point on a board-space tile's top face: (u, v) ∈ [−1, 1] from its centre towards its left / right and near /
   * far edges (view.tileScreen poly: far-left, far-right, near-right, near-left). */
  const tileSpot = (page, row, col, u = 0, v = 0) => page.evaluate((r, c, u, v) => {
    const t = globalThis.__SP_VIEW__.raw.tileScreen(r, c);
    if (!t) return null;
    const [fl, fr, nr, nl] = t.poly, a = (u + 1) / 2, b = (v + 1) / 2;
    const near = [nl[0] + (nr[0] - nl[0]) * a, nl[1] + (nr[1] - nl[1]) * a], far = [fl[0] + (fr[0] - fl[0]) * a, fl[1] + (fr[1] - fl[1]) * a];
    return { x: near[0] + (far[0] - near[0]) * b, y: near[1] + (far[1] - near[1]) * b };
  }, row, col, u, v);
  /** Press on `from` and pick the piece up with a short move, then wait for the camera: picking a piece up on the own
   * prep board folds the shop and zooms the board (the deploy fold, GitHub #602), so targets are aimed after it. Returns
   * the point the pointer rests on. */
  const pickUp = async (page, from) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 3; i++) { await page.mouse.move(from.x, from.y - i * 4); await sleep(16); }
    await cameraSettled(page);
    return { x: from.x, y: from.y - 12 };
  };
  /** The centre of the folded shop's tab (DOM over the canvas while a piece is carried), or null. */
  const shopTab = (page) => page.evaluate(() => {
    const r = document.querySelector('.shopbar-tab')?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  /** The render engine's own pick at a client point (render/pick.js through app.js pieceAt / battleUnitAt). */
  const pickAt = (page, pt, battle = false) => page.evaluate((x, y, b) => {
    const R = globalThis.__SP_VIEW__.raw, cv = R.debug.app.view.getBoundingClientRect();
    if (!b) return R.debug.pick.pieceAt(x - cv.left, y - cv.top)?.uid ?? null;
    return R.debug.pick.battleUnitAt(x - cv.left, y - cv.top)?.id ?? null;
  }, pt.x, pt.y, battle);
  const listenClicks = (page) => page.evaluate(() => {
    window.__picked = [];
    window.__offPick?.();
    window.__offPick = globalThis.__SP_VIEW__.raw.on('pieceClick', (e) => window.__picked.push(e.unitId ?? e.uid ?? null));
  });
  const clickAt = async (page, pt) => {
    await page.mouse.click(pt.x, pt.y);
    await sleep(90);
    const got = await page.evaluate(() => window.__picked.splice(0));
    await page.keyboard.press('Escape');
    await sleep(40);
    return got;
  };
  // spots of a tile's top face that show on screen: its centre, 0.3 tile out to the sides and 0.4 to the far edge, 0.15
  // towards the near edge (a raised tile in front hides the strip of this one just behind it: a 0.3-high block the
  // nearest 0.17 tile, the 0.55 separator wall in front of the bench 0.22 — the press there is on the block's top)
  const SPOTS = [[0, 0], [-0.6, 0], [0.6, 0], [0, -0.3], [0, 0.8], [-0.6, 0.6], [0.6, 0.6], [-0.6, -0.3], [0.6, -0.3]];

  test('#4.1 prep: a press anywhere on a tile selects the unit on it — board, high ground, bench, temp; an empty tile nothing', async () => {
    const { page, problems } = await open('phase=PREP&variant=temp');
    const pieces = await page.evaluate(() => window.__t.pieces());
    const on = (r, c) => pieces.find((p) => p.row === r && p.col === c)?.uid ?? null;
    assert.ok(on(9, 3) && on(9, 4) && on(9, 5) && on(10, 4) && on(11, 4), 'premise: neighbours in a row (9, 3–5) and a column (9–11, 4; rows 10–12 high ground)');
    assert.ok(pieces.filter((p) => p.row === 7).length >= 5 && pieces.filter((p) => p.row === 8).length >= 2, 'premise: bench and temp pieces');
    await listenClicks(page);
    for (const p of pieces) {
      for (const [u, v] of SPOTS) {
        const pt = await tileSpot(page, p.row, p.col, u, v);
        assert.equal(await pickAt(page, pt), p.uid, `${p.kind} ${p.uid} on (${p.row},${p.col}) at (${u}, ${v})`);
      }
      // the whole press path (canvas pointer events → the drag controller → pieceClick) at the centre and a corner
      for (const [u, v] of [[0, 0], [0.6, 0.6]]) {
        const got = await clickAt(page, await tileSpot(page, p.row, p.col, u, v));
        assert.deepEqual(got.slice(-1), [p.uid], `click on (${p.row},${p.col}) at (${u}, ${v})`);
      }
    }
    // a press on a unit's head, drawn over the tile behind it: the unit on that tile — or nothing when it is empty
    const head = (uid) => page.evaluate((u) => window.__t.at('p:' + u, 1.0), uid);
    assert.equal(await pickAt(page, await head(on(9, 4))), on(10, 4), 'the head of (9,4) is drawn over (10,4)');
    assert.equal(on(10, 3), null, 'premise: (10,3) is a forbidden block');
    assert.equal(await pickAt(page, await head(on(9, 3))), null, 'the head of (9,3) over the empty (10,3)');
    assert.deepEqual(await clickAt(page, await head(on(9, 3))), [], 'no pieceClick');
    // the nearest strip of (9,3) is hidden by the forbidden block (8,3) in front of it: a press there is on that block
    const hidden = await tileSpot(page, 9, 3, 0, -0.9);
    assert.deepEqual(await page.evaluate((x, y) => { const R = globalThis.__SP_VIEW__.raw, cv = R.debug.app.view.getBoundingClientRect(), g = R.debug.pick.groundTile(x - cv.left, y - cv.top); return g && [g.row, g.col]; }, hidden.x, hidden.y), [8, 3]);
    assert.equal(await pickAt(page, hidden), null);
    await page.screenshot({ path: path.join(OUT, 'models-pick-prep.png') });
    await page.close();
    assert.deepEqual(problems, []);
  });

  test('#4.1 battle: allies by the tile under the pointer, enemies by their ground position or drawn body', async () => {
    const { page, problems } = await open('phase=PREP');
    await setPhase(page, 'COMBAT');
    await sleep(6000); // several enemies spawned (one every 0.9 s)
    // freeze the mock battle (one last snapshot): the enemies stand still for the presses
    await page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      const S = globalThis.__MOCK__.S();
      const last = await new Promise((resolve) => { const off = net.on('b.snap', (m) => { off(); resolve(m); }); });
      clearInterval(S.battle.timer);
      net._emit('b.snap', { ...last, gt: last.gt + 0.2 });
    });
    await sleep(800);
    const units = await page.evaluate(() => {
      const R = globalThis.__SP_VIEW__.raw, cv = R.debug.app.view.getBoundingClientRect(), out = [];
      for (const [id, v] of R.debug.views) {
        if (!v.info || !v.alive || v.culled || v.info.kind === 'device') continue;
        const g = R.debug.cam.project(v.x, v.y, v.z);
        out.push({ id, side: v.info.side, x: v.x, y: v.y, row: Math.round(v.y), col: Math.round(v.x), fly: !!v.flying, feet: { x: cv.left + g.x, y: cv.top + g.y },
          body: { x: cv.left + v.screen.x, top: cv.top + v.screen.top, feet: cv.top + v.screen.y, s: v.screen.s } });
      }
      return out;
    });
    const allies = units.filter((u) => u.side === 'ally'), foes = units.filter((u) => u.side === 'enemy' && !u.fly);
    assert.ok(allies.length >= 7 && foes.length >= 3, `premise: allies ${allies.length}, walking enemies ${foes.length}`);
    await listenClicks(page);
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    /** Tiles between a client point and an enemy's drawn body (the line from its feet up to its head). */
    const bodyDist = (b, pt) => Math.hypot(pt.x - b.x, pt.y - Math.max(b.top, Math.min(b.feet, pt.y))) / b.s;
    // the rule (render/pick.js), from the spot's own ground coordinates and client point: the ally on the tile, unless
    // an enemy's ground position or drawn body is nearer (within 0.6 tile)
    const expected = (a, g, pt) => {
      let best = a, bd = near(a, g);
      for (const f of foes) { const d = Math.min(near(f, g), bodyDist(f.body, pt)); if (d <= 0.6 && d < bd - 1e-6) { best = f; bd = d; } }
      return best.id;
    };
    let byEnemy = 0;
    for (const a of allies) {
      for (const [u, v] of SPOTS) {
        const pt = await tileSpot(page, a.row, a.col, u, v);
        const g = await page.evaluate((x, y) => { const R = globalThis.__SP_VIEW__.raw, cv = R.debug.app.view.getBoundingClientRect(); return R.debug.pick.groundTile(x - cv.left, y - cv.top); }, pt.x, pt.y);
        const want = expected(a, g, pt);
        if (want !== a.id) byEnemy++;
        assert.equal(await pickAt(page, pt, true), want, `ally ${a.id} on (${a.row},${a.col}) at (${u}, ${v})`);
      }
      if (expected(a, { x: a.col, y: a.row }, await tileSpot(page, a.row, a.col)) === a.id) assert.deepEqual((await clickAt(page, await tileSpot(page, a.row, a.col))).slice(-1), [a.id], `click on ally ${a.id}`);
    }
    assert.ok(byEnemy < allies.length * SPOTS.length / 3, `most spots of the allies' tiles are the allies' (${byEnemy} went to an enemy standing nearer)`);
    for (const f of foes) {
      // at its feet, and on its drawn torso / head (a tall enemy's body is drawn over the ground a tile behind it)
      for (const [k, pt] of [['feet', f.feet], ['torso', { x: f.body.x, y: (f.body.top + f.body.feet) / 2 }], ['head', { x: f.body.x, y: f.body.top + 0.1 * f.body.s }]]) {
        const got = await pickAt(page, pt, true);
        const other = units.find((u) => u.id === got);
        assert.ok(got === f.id || (other && other.side === 'enemy' && near(other, f) < 0.3), `enemy ${f.id} at its ${k} (got ${got})`);
      }
    }
    const f = foes.find((x) => !foes.some((y) => y !== x && near(x, y) < 0.3)) || foes[0];
    const got = await clickAt(page, f.feet);
    assert.ok(got.length === 1 && units.find((u) => u.id === got[0])?.side === 'enemy', `a click at an enemy's feet selects an enemy (${got})`);
    await page.screenshot({ path: path.join(OUT, 'models-pick-battle.png') });
    await page.close();
    assert.deepEqual(problems, []);
  });

  /** The dragged view against the pointer (client px): its drawn feet, px per tile, and the Spine model's drawn bounds;
   * its world point (wx = col, wy = row, wz) and the height of the board tile under it (hz). */
  const ghostAt = (page, uid) => page.evaluate((u) => {
    const R = globalThis.__SP_VIEW__.raw, cv = R.debug.app.view.getBoundingClientRect(), v = R.debug.views.get('p:' + u);
    const b = v.actor && v.spineReady && !v.imp ? v.actor.spine.getBounds() : null;
    return { lift: v.lift, x: cv.left + v.screen.x, y: cv.top + v.screen.y, s: v.screen.s, model: b && { x0: cv.left + b.x, y0: cv.top + b.y, x1: cv.left + b.x + b.width, y1: cv.top + b.y + b.height },
      wx: v.x, wy: v.y, wz: v.z, hz: R.debug.tiles.heightAt(Math.round(v.y), Math.round(v.x)) };
  }, uid);
  /** Over a legal target the model stands on the pointer's tile (the official deploy drag): its world point is that
   * tile — the tile's top on the board, the bench pad on the bench — and it is lifted. */
  const assertStands = (g, [row, col], label) => {
    assert.ok(g.lift > 0, `${label}: lifted`);
    assert.ok(Math.abs(g.wx - col) < 1e-6 && Math.abs(g.wy - row) < 1e-6, `${label}: stands on (${row},${col}) (at ${g.wx.toFixed(3)},${g.wy.toFixed(3)})`);
    if (row !== 7) assert.ok(Math.abs(g.wz - g.hz) < 1e-6, `${label}: on the tile's top (z ${g.wz} vs ${g.hz})`);
    else assert.ok(g.wz > 0, `${label}: on the bench pad (z ${g.wz})`);
  };
  /** Elsewhere the model is under the pointer: its feet DRAG_HOLD_TILES (0.45) below it, the pointer inside its drawn body. */
  const assertHeld = (g, ptr, label) => {
    assert.ok(g.lift > 0, `${label}: lifted`);
    assert.ok(Math.abs(g.x - ptr.x) < 1.5 && Math.abs(g.y - ptr.y - 0.45 * g.s) < 1.5, `${label}: feet 0.45 tile below the pointer (feet ${g.x.toFixed(1)},${g.y.toFixed(1)}, pointer ${ptr.x.toFixed(1)},${ptr.y.toFixed(1)}, s ${g.s.toFixed(1)})`);
    if (g.model) {
      const m = g.model, k = (ptr.y - m.y0) / (m.y1 - m.y0);
      assert.ok(ptr.x > m.x0 && ptr.x < m.x1 && k > 0.2 && k < 0.8, `${label}: the pointer on the drawn model (${JSON.stringify(m)}, k ${k.toFixed(2)})`);
    }
  };

  test('#4.1 drag (mouse): the unit stands on the pointer\'s tile over a legal target, held under the pointer elsewhere; target, tileHover and the direction wheel are the pointer\'s tile', async () => {
    const { page, problems } = await open('phase=PREP');
    const hand = await page.evaluate(() => { const p = globalThis.__MOCK__.S().priv; const i = p.hand.findIndex((x) => x && x.kind === 'chess'); return { uid: p.hand[i].uid, idx: i }; });
    await page.evaluate(() => { window.__hover = []; globalThis.__SP_VIEW__.raw.on('tileHover', (t) => window.__hover.push(t && [t.row, t.col])); });
    const from = await tileSpot(page, 7, hand.idx);
    const p0 = await pickUp(page, from); // (the deploy fold's zoom: aimed after it)
    const to = await tileSpot(page, 9, 4, 0.3, 0.4); // an occupied melee tile (a swap), off its centre
    for (let i = 1; i <= 12; i++) { await page.mouse.move(p0.x + ((to.x - p0.x) * i) / 12, p0.y + ((to.y - p0.y) * i) / 12); await sleep(16); }
    await sleep(150);
    const first = await ghostAt(page, hand.uid);
    assertStands(first, [9, 4], 'mouse');
    assert.deepEqual(await page.evaluate(() => window.__hover.at(-1)), [9, 4], 'tileHover = the tile under the pointer');
    await page.screenshot({ path: path.join(OUT, 'models-drag-ghost.png') });
    // the pointer moving about inside the tile leaves the model where it is (the official recording: the finger moves,
    // the model stays on its tile)
    for (const [u, v] of [[-0.6, -0.3], [0.6, -0.3], [-0.5, 0.7], [0, 0]]) { // (the nearest strip is hidden by row 8: SPOTS)
      const pt = await tileSpot(page, 9, 4, u, v);
      await page.mouse.move(pt.x, pt.y);
      await sleep(40);
      const g = await ghostAt(page, hand.uid);
      assertStands(g, [9, 4], `mouse at (${u}, ${v}) of the tile`);
      assert.ok(Math.abs(g.x - first.x) < 0.5 && Math.abs(g.y - first.y) < 0.5, `mouse at (${u}, ${v}): the model did not move on screen`);
    }
    // the whole way: on a legal tile the model stands on the pointer's tile, elsewhere it is under the pointer (sampled
    // at every step of a second drag leg; the legal tiles are the view's own 'legal' highlight)
    const legal = new Set(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.tiles.highlights.get('legal').tiles.map(([r, c]) => `${r},${c}`)));
    const leg = await tileSpot(page, 10, 5);
    const seen = { stands: 0, held: 0 };
    for (let i = 1; i <= 6; i++) {
      const pt = { x: to.x + ((leg.x - to.x) * i) / 6, y: to.y + ((leg.y - to.y) * i) / 6 };
      await page.mouse.move(pt.x, pt.y);
      await sleep(40);
      const tile = await page.evaluate(() => window.__hover.at(-1));
      if (legal.has(`${tile}`)) { seen.stands++; assertStands(await ghostAt(page, hand.uid), tile, `mouse step ${i}`); }
      else { seen.held++; assertHeld(await ghostAt(page, hand.uid), pt, `mouse step ${i}`); }
    }
    assert.ok(seen.stands > 0, `the leg crosses legal tiles (${JSON.stringify(seen)})`);
    // over the shop (DOM over the canvas: no target — while a piece is carried the bar is folded to its tab, GitHub #602)
    // the model is held under the pointer, so the player still sees what they carry
    const bar = await shopTab(page);
    assert.ok(bar, 'premise: the folded shop tab');
    assert.ok(await page.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('.shopbar-tab'), bar.x, bar.y), 'premise: the point is on the shop tab');
    await page.mouse.move(bar.x, bar.y, { steps: 6 });
    await sleep(60);
    assert.equal(await page.evaluate(() => window.__hover.at(-1)), null, 'no tile under the shop tab');
    assertHeld(await ghostAt(page, hand.uid), bar, 'mouse over the shop tab');
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await sleep(60);
    assertStands(await ghostAt(page, hand.uid), [9, 4], 'mouse back on (9,4)');
    await page.mouse.move(to.x, to.y);
    await sleep(60);
    await page.mouse.up();
    await page.waitForSelector('.fwheel__dia', { timeout: 3000 });
    const w = await page.evaluate(() => { const r = document.querySelector('.fwheel__dia').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const c = await tileSpot(page, 9, 4);
    assert.ok(Math.hypot(w.x - c.x, w.y - c.y) < 2, `the wheel opens on the pointer's tile (${w.x},${w.y} vs ${c.x},${c.y})`);
    await page.keyboard.press('Escape');
    await page.close();
    assert.deepEqual(problems, []);
  });

  test('#4.1 equipment dropped on a tile equips the unit on it (the one behind, a bench operator); an empty tile takes nothing', async () => {
    const { page, problems } = await open('phase=PREP');
    const S = () => page.evaluate(() => { const p = globalThis.__MOCK__.S().priv; return { board: p.board.map((x) => ({ uid: x.uid, row: x.row, col: x.col, items: x.items.map((i) => i.uid) })), hand: p.hand.map((x) => x && { uid: x.uid, kind: x.kind, items: (x.items || []).map((i) => i.uid) }) }; });
    // three items in the hand (slots 0, 1, 4 are free / an item in the mock)
    await page.evaluate(() => globalThis.__MOCK__.mutate((M) => {
      const src = M.priv.hand.find((x) => x && x.kind === 'item');
      for (const i of [0, 1]) if (!M.priv.hand[i]) M.priv.hand[i] = { ...src, uid: 900 + i };
    }));
    await sleep(800);
    let st = await S();
    const items = st.hand.map((x, i) => x && x.kind === 'item' && { uid: x.uid, idx: i }).filter(Boolean);
    const target = st.board.find((b) => b.row === 10 && b.col === 4), front = st.board.find((b) => b.row === 9 && b.col === 4);
    const benchIdx = st.hand.findIndex((x) => x && x.kind === 'chess');
    assert.ok(items.length >= 3 && target && front && benchIdx >= 0, 'premise');
    // `spot` is read after the pickup (the deploy fold zooms the board, GitHub #602)
    const dragTo = async (it, spot) => {
      await cameraSettled(page);
      const from = await tileSpot(page, 7, it.idx);
      const p0 = await pickUp(page, from);
      const to = await spot();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(p0.x + ((to.x - p0.x) * i) / 10, p0.y + ((to.y - p0.y) * i) / 10); await sleep(16); }
      await sleep(120);
      await page.mouse.up();
      await sleep(700);
    };
    // (10,4) behind (9,4): the tile of the one behind — near its front edge, where the front one's head is drawn
    await dragTo(items[0], () => tileSpot(page, 10, 4, 0, -0.6));
    st = await S();
    assert.ok(st.board.find((b) => b.uid === target.uid).items.includes(items[0].uid), 'equipped on the unit behind');
    assert.ok(!st.board.find((b) => b.uid === front.uid).items.includes(items[0].uid), 'not on the one in front');
    await dragTo(items[1], () => tileSpot(page, 7, benchIdx, 0.4, 0.4));
    st = await S();
    assert.ok(st.hand[benchIdx].items.includes(items[1].uid), 'equipped on the bench operator');
    // the empty high-ground tile behind (12,4)? use a free deploy tile: the item stays in the hand
    const free = await page.evaluate(() => { const S = globalThis.__MOCK__.S(), used = new Set(S.priv.board.map((b) => `${b.row},${b.col}`)); return S.stage.deployTiles.normal.melee.find(([r, c]) => !used.has(`${r},${c}`)); });
    await dragTo(items[2], () => tileSpot(page, free[0], free[1]));
    st = await S();
    assert.ok(st.hand.some((x) => x && x.uid === items[2].uid), 'an empty tile takes nothing: the item is back in the hand');
    await page.close();
    assert.deepEqual(problems, []);
  });

  // a phone (touch, landscape 844×390): the finger drags the model like the mouse — standing on the finger's tile over a
  // legal target, under the finger elsewhere (no lift above the finger); on the bench (the lowest canvas row, the shop
  // bar right under it) a release on the slot lands there, one on the shop bar goes back
  test('#4.1 touch (phone): stands on the finger\'s tile (under the finger over the shop bar), dropped on the tile under it; a release over the shop bar goes back', async () => {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?shot=1&render=engine&phase=PREP`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)') && !!globalThis.__SP_VIEW__?.raw?.debug, { timeout: 30000 });
    await page.evaluate(installHelpers);
    await page.evaluate(() => globalThis.__MOCK__.mutate((S) => { S.priv.hand[5] = null; }));
    await sleep(2000);
    // `spot` is read after the pickup (the deploy fold zooms the board and folds the shop, GitHub #602); `hold` gets it
    const touchDrag = async (from, spot, { hold = null } = {}) => {
      await cameraSettled(page);
      await page.touchscreen.touchStart(from.x, from.y);
      for (let i = 1; i <= 3; i++) { await page.touchscreen.touchMove(from.x, from.y - i * 4); await sleep(16); }
      await cameraSettled(page);
      const p0 = { x: from.x, y: from.y - 12 }, to = await spot();
      for (let i = 1; i <= 12; i++) { await page.touchscreen.touchMove(p0.x + ((to.x - p0.x) * i) / 12, p0.y + ((to.y - p0.y) * i) / 12); await sleep(16); }
      await sleep(100);
      if (hold) await hold(to);
      await page.touchscreen.touchEnd();
      await sleep(800);
      return to;
    };
    // a tap on a unit's tile selects it — and only that: the tap's compatibility click used to land on the underframe
    // that had just opened over the tile (clamped under the top bar for rows 11–12) and pressed 撤退 (the unit left)
    for (const row of [9, 10, 11, 12]) {
      const u = await page.evaluate((r) => { const b = globalThis.__MOCK__.S().priv.board.find((p) => p.row === r && p.col === 4); return b && { uid: b.uid, n: globalThis.__MOCK__.S().requests.length }; }, row);
      assert.ok(u, `premise: a unit on (${row},4)`);
      const t = await tileSpot(page, row, 4);
      await page.touchscreen.tap(t.x, t.y);
      await sleep(600);
      const s = await page.evaluate((u) => ({ onBoard: globalThis.__MOCK__.S().priv.board.some((p) => p.uid === u.uid), uframe: !!document.querySelector(`.uframe[data-uid="${u.uid}"]`), sent: globalThis.__MOCK__.S().requests.slice(u.n).map((r) => r[0]).filter((q) => q !== 'g.unitStats') }), u);
      assert.deepEqual(s, { onBoard: true, uframe: true, sent: [] }, `a tap on (${row},4) selects its unit, nothing else`);
      await page.keyboard.press('Escape');
      await sleep(200);
    }
    // a bench operator onto the board: standing on the finger's tile, the wheel on that tile
    const hand = await page.evaluate(() => { const p = globalThis.__MOCK__.S().priv; const i = p.hand.findIndex((x) => x && x.kind === 'chess'); return { uid: p.hand[i].uid, idx: i }; });
    await touchDrag(await tileSpot(page, 7, hand.idx), () => tileSpot(page, 9, 4, -0.3, 0.3), { hold: async () => assertStands(await ghostAt(page, hand.uid), [9, 4], 'touch') });
    await page.waitForSelector('.fwheel__dia', { timeout: 3000 });
    const w = await page.evaluate(() => { const r = document.querySelector('.fwheel__dia').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const c = await tileSpot(page, 9, 4);
    assert.ok(Math.hypot(w.x - c.x, w.y - c.y) < 2, 'the wheel opens on the finger\'s tile');
    await page.evaluate(() => document.querySelector('.fwheel__cancel')?.click());
    await sleep(500);
    // a board unit back onto the free bench slot 5: the finger on the slot → lands; on the shop (folded to its tab while
    // a piece is carried, GitHub #602 — DOM over the canvas) → back
    const unit = await page.evaluate(() => { const u = globalThis.__MOCK__.S().priv.board[0]; return { uid: u.uid, row: u.row, col: u.col }; });
    await touchDrag(await tileSpot(page, unit.row, unit.col), () => shopTab(page), { hold: async (to) => { assert.ok(to, 'premise: the folded shop tab'); assertHeld(await ghostAt(page, unit.uid), to, 'touch over the shop tab'); } });
    assert.ok(await page.evaluate((u) => globalThis.__MOCK__.S().priv.board.some((b) => b.uid === u), unit.uid), 'released over the shop tab: back on the board');
    await touchDrag(await tileSpot(page, unit.row, unit.col), () => tileSpot(page, 7, 5), { hold: async () => assertStands(await ghostAt(page, unit.uid), [7, 5], 'touch on the free bench slot') });
    assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.hand[5]?.uid ?? null), unit.uid, 'released on the bench slot: it is there');
    await page.screenshot({ path: path.join(OUT, 'models-touch-phone.png') });
    await page.close();
    assert.deepEqual(problems, []);
  });
});
