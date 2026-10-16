// test/render/vfx-skills.browser.test.js — the official skill, talent and charge effects (render/vfx/skillfx.js, DESIGN
// §33 Phase 3b) in headless Chrome through the dev viewer's skill demo (public/dev/fx-viewer.html ?skilldemo): real
// operators' skills from the local extraction played through the wiring with hand-stepped frames on a flat grey board →
// screenshots test/e2e/out/vfx-skill-<name>.png. Each picture must show the skill's own effects (their keys live, pixels
// changed where they sit): 克莱门莎 S1's cast and hit (an instant skill with its attack), her S3 mark on the dummy's
// tile (FX_BINDINGS: the 'lock' fx), 伊芙利特 S3's loops and range and S2's cast, range and the burn on the dummy, 深靛's
// three stored energies and their release beside the shot, a passive's loop (砾 S2), a ready loop (阿罗玛 S1), the light
// tier; index v2 (Phase 3c): an enemy's skill by its 'cast' slot (enemy_1209_sfden), a single-skill enemy's window from
// the snapshot's SKILL anim (enemy_10001_trslim: its loop held until the window ends), a MultiHit mode attack (char_4009_irene:
// hit 1 and hit 2 play their own groups), a blocked enemy's combat (enemy_10027_vtsk); index v3 (Phase 3d): a multi-skill
// leader's windows by slot (鼠王 enemy_1509_mousek), a 重生 (“复仇者” enemy_1539_reid: the handler loop, then its end), a
// deploy talent (耀骑士临光 char_1014_nearl2's birth); the console stays clean.
//
// Opt-in (starts Chrome, needs the effects extracted from the local client: extract.py --only fx):
//   RENDER_E2E=1 node --test test/render/vfx-skills.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
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

/** Pixels of a box that differ from the flat background. */
function changedBox(img, x0, y0, x1, y1) {
  let n = 0;
  for (let y = Math.max(0, Math.round(Math.min(y0, y1))); y < Math.min(img.h, Math.round(Math.max(y0, y1))); y++) {
    for (let x = Math.max(0, Math.round(Math.min(x0, x1))); x < Math.min(img.w, Math.round(Math.max(x0, x1))); x++) {
      const o = (y * img.w + x) * 4;
      if (Math.abs(img.rgba[o] - BG[0]) + Math.abs(img.rgba[o + 1] - BG[1]) + Math.abs(img.rgba[o + 2] - BG[2]) > 12) n++;
    }
  }
  return n;
}

describe('official skill effects in headless Chrome', { skip }, () => {
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
   * Start the skill demo of `unit` (o: skillDemo options, `tier`), run `script` — [cmd, a, b] or a number of frames — then
   * screenshot: { img, keys (live effect keys), src / tgt (screen px of the unit's and the dummy's chest), plan }.
   */
  async function shot(name, unit, o, script) {
    const plan = await page.evaluate(async (u, opt) => {
      const fx = window.__fx;
      fx.clear(); fx.stopDemo();
      fx.setTier(opt.tier || 'full');
      const r = fx.skillDemo(u, { ...opt, manual: true });   // no cycle: the script drives it
      return r.plan ? { modeName: r.plan.modeName, kind: r.plan.kind, sid: r.sid } : { sid: r.sid };
    }, unit, o);
    await settle();
    for (const s of script) {
      if (typeof s === 'number') await page.evaluate((n) => window.__fx.step(n, 1 / 60), s);
      else await page.evaluate((c) => window.__fx.skillCmd(c[0], c[1], c[2]), s);
    }
    await page.evaluate(() => window.__fx.render());
    const file = path.join(OUT, `vfx-skill-${name}.png`);
    const buf = await page.screenshot({ path: file });
    const geo = await page.evaluate(() => {
      const fx = window.__fx;
      const { src, tgt } = fx.skillUnits();
      return { src: fx.project(src.x, src.y, 0.4), tgt: fx.project(tgt.x, tgt.y, 0.4), keys: fx.liveKeys(), playing: fx.liveKeys(true), stats: fx.stats() };
    });
    return { img: decodePng(Buffer.from(buf)), plan, ...geo };
  }

  test('克莱门莎 S1 (an instant skill with its attack): the skill\'s cast on her and its hit on the dummy', async () => {
    const r = await shot('clemnt-s1', 'char_4231_clemnt', { s: 0, kind: 'none', dist: 1 }, [['on'], ['attack'], ['off'], 8]);
    assert.equal(r.plan.sid, 'skchr_clemnt_1');
    for (const k of ['clemnt_skill_01_start_01', 'clemnt_skill_01_hit_01']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(!r.keys.includes('clemnt_attack_01_start_01'), "the normal attack's cast is replaced");
    assert.ok(changed(r.img, r.src.x, r.src.y, 70) > 300, 'her cast');
  });

  test('克莱门莎 S3: the kit\'s lock plays the skill projectile\'s mark and strikes on the dummy\'s tile', async () => {
    const r = await shot('clemnt-s3-mark', 'char_4231_clemnt', { s: 2 }, [['on'], ['fx', 'lock', { id: 2, src: 1 }], 70]);
    assert.ok(r.keys.includes('clemnt_skill_03_mark_all_01'), String(r.keys));
    assert.ok(changed(r.img, r.tgt.x, r.tgt.y, 80) > 800, 'the mark on the tile');
  });

  test('伊芙利特 S3: the skill\'s loops and its range while it lasts', async () => {
    const r = await shot('ifrit-s3', 'char_134_ifrit', { s: 2 }, [['on'], 50]);
    for (const k of ['ifrit_skill_03_start', 'ifrit_skill_03_buff', 'ifrit_skill_03_range']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(changed(r.img, r.src.x, r.src.y, 90) > 1500);
    // off: the loops stop (with their own fade)
    await page.evaluate(() => { window.__fx.skillCmd('off'); window.__fx.step(2, 1 / 60); });
    const left = await page.evaluate(() => window.__fx.liveKeys(true));
    assert.ok(!left.includes('ifrit_skill_03_buff'), String(left));
  });

  test('伊芙利特 S2: the skill attack\'s cast and range on her, the hit and the burn on the dummy', async () => {
    const r = await shot('ifrit-s2', 'char_134_ifrit', { s: 1, kind: 'none', dist: 2 }, [['on'], ['attack'], ['off'], 14]);
    for (const k of ['ifrit_skill_02_start', 'ifrit_skill_02_range', 'common_firemagic_hit_01', 'buff_burn']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(changed(r.img, r.tgt.x, r.tgt.y, 60) > 200, 'the burn on the dummy');
  });

  test('深靛: three stored energies light their slots; the release flies them beside the shot', async () => {
    const r = await shot('indigo-charge', 'char_469_indigo', { charge: 3 }, [['energy', 1], 10, ['energy', 2], 10, ['energy', 3], 30]);
    for (const k of ['indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(changed(r.img, r.src.x, r.src.y - 20, 70) > 400);
    // the release: the sim empties the store with the attack (the snapshot reads 0 from then on)
    const s = await shot('indigo-release', 'char_469_indigo', { charge: 3 }, [['energy', 3], 20, ['attack', 'bolt'], ['energy', 0], 6]);
    const trails = s.keys.filter((k) => k === 'indigo_attack_01_trail').length;
    assert.equal(trails, 4, `the shot + 3 stored energies: ${s.keys}`);
    assert.ok(!s.playing.includes('indigo_attack_charge_02'), `released: the slots go dark (${s.playing})`);
  });

  test('a passive (砾 S2): its loop while deployed', async () => {
    const r = await shot('gravel-passive', 'char_237_gravel', { s: 1, passive: true }, [30]);
    assert.ok(r.keys.includes('gravel_skill_02_buff'), String(r.keys));
    assert.ok(changed(r.img, r.src.x, r.src.y, 70) > 200);
  });

  test('a ready loop (阿罗玛 S1): while the SP bar is full and the skill off', async () => {
    const r = await shot('aroma-ready', 'char_446_aroma', { s: 0 }, [['sp', 10], 30]);
    assert.ok(r.keys.includes('aroma_skill_01_buff_01'), String(r.keys));
    await page.evaluate(() => { window.__fx.skillCmd('on'); window.__fx.step(2, 1 / 60); });
    assert.ok(!(await page.evaluate(() => window.__fx.liveKeys(true))).includes('aroma_skill_01_buff_01'), 'the cast ends the ready loop');
  });

  test('the light tier (精简) draws the skills too', async () => {
    const r = await shot('ifrit-s3-lite', 'char_134_ifrit', { s: 2, tier: 'lite' }, [['on'], 50]);
    assert.equal(r.stats.tier, 'lite');
    assert.ok(r.keys.includes('ifrit_skill_03_buff'));
    assert.ok(changed(r.img, r.src.x, r.src.y, 90) > 800);
  });

  test("an enemy's skill (index v2, enemy_1209_sfden's InvisibleShield): the 'cast' slot plays its range on the enemy", async () => {
    const r = await shot('enemy-sfden-cast', 'enemy_1209_sfden', { s: 0 }, [['cast', 0], 40]);
    assert.equal(r.plan.sid, 'invisibleshield');
    assert.ok(r.keys.includes('enemy_sfden_skill_range_01'), String(r.keys));
    assert.ok(changed(r.img, r.src.x, r.src.y, 100) > 300, 'the range around the enemy');
  });

  test("a single-skill enemy's window (enemy_10001_trslim's StartRun): the snapshot's SKILL anim opens it, its loop lasts until the window ends", async () => {
    const r = await shot('enemy-trslim-window', 'enemy_10001_trslim', { s: 0 }, [['anim', 3], 14]);
    for (const k of ['enemy_trslim_skill_01', 'enemy_trslim_skill_buff_01']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(changed(r.img, r.src.x, r.src.y, 80) > 500);
    // the anim leaves SKILL: after the grace (0.3 s) the window ends and its loop stops (no longer playing: its stop
    // fade and the prefab's _delayToFinish linger follow)
    await page.evaluate(() => { window.__fx.skillCmd('anim', 0); window.__fx.step(30, 1 / 60); });
    const left = await page.evaluate(() => window.__fx.ofx.effects.filter((e) => e.state === 'play').map((e) => e.def?.key));
    assert.ok(!left.includes('enemy_trslim_skill_buff_01'), String(left));
  });

  test("a MultiHit mode attack (char_4009_irene's Default): the blow's cast, hit 1 and hit 2 each play their own group", async () => {
    const r = await shot('irene-multihit', 'char_4009_irene', { kind: 'none', dist: 1, hits: 2 }, [['attack'], 3]);
    for (const k of ['irene_attack_start_front_01', 'irene_attack_hit_01', 'irene_attack_hit_02']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(!r.keys.includes('common_hit_01'), 'its own hits: no generic hit');
    assert.ok(changed(r.img, r.tgt.x, r.tgt.y, 70) > 300, 'the hits on the dummy');
    // one hit only: group 1, never group 2
    const one = await shot('irene-onehit', 'char_4009_irene', { kind: 'none', dist: 1, hits: 1 }, [['attack'], 3]);
    assert.ok(one.keys.includes('irene_attack_hit_01') && !one.keys.includes('irene_attack_hit_02'), String(one.keys));
  });

  test("a blocked enemy's blow plays its mode's combat, a free one its shot (index v2, enemy_10027_vtsk)", async () => {
    const r = await shot('enemy-vtsk-combat', 'enemy_10027_vtsk', { kind: 'none', dist: 1, block: true }, [['attack'], 10]);
    for (const k of ['enemy_vtsk_attack_weapon_01', 'enemy_vtsk_attack_start_01', 'enemy_vtsk_attack_hit_01']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    assert.ok(!r.keys.includes('enemy_vtsk_skill_01_trail_01'), 'not the shot');
    const f = await shot('enemy-vtsk-shot', 'enemy_10027_vtsk', { kind: 'enemy', dist: 3 }, [['attack'], 6]);
    assert.ok(f.keys.includes('enemy_vtsk_skill_01_trail_01'), String(f.keys));
    assert.ok(!f.keys.includes('enemy_vtsk_attack_start_01'), 'not the combat');
  });

  test("a multi-skill leader's windows by slot (index v3 sim cast event, 鼠王 enemy_1509_mousek): DriftSand's slot 0, SandStorm's slot 1", async () => {
    // the data record's order (data/enemies.json: DriftSand, SandStorm, Mark) — the slots the sim's 'cast' names
    const order = ['DriftSand', 'SandStorm', 'Mark'];
    const r = await shot('enemy-mousek-slot0', 'enemy_1509_mousek', { s: 0, dist: 2, skills: order }, [['cast', 0], 12]);
    const keys0 = await page.evaluate(() => {
      const fx = window.__fx, u = fx.wiring.idx.units.enemy_1509_mousek;
      return (u.skills.driftsand.uses || []).flatMap((x) => x.keys).map((k) => k.toLowerCase());
    });
    assert.ok(keys0.some((k) => r.keys.includes(k)), `DriftSand ${keys0} in ${r.keys}`);
    const s = await shot('enemy-mousek-slot1', 'enemy_1509_mousek', { s: 1, dist: 2, skills: order }, [['cast', 1, 15], 12]);
    const keys1 = await page.evaluate(() => (window.__fx.wiring.idx.units.enemy_1509_mousek.skills.sandstorm.uses || []).flatMap((x) => x.keys).map((k) => k.toLowerCase()));
    assert.ok(keys1.some((k) => s.keys.includes(k)), `SandStorm ${keys1} in ${s.keys}`);
    assert.ok(changed(s.img, s.src.x, s.src.y, 120) > 200);
  });

  test("a 重生 (“复仇者” enemy_1539_reid): the knock-out plays its handler loop until the stand-up, then its end", async () => {
    const r = await shot('enemy-reid-reborn', 'enemy_1539_reid', { s: 0 }, [['form', 'reborn', { dur: 5 }], 20]);
    assert.ok(r.keys.includes('enemy_reid_revive_01'), String(r.keys));
    assert.ok(changed(r.img, r.src.x, r.src.y, 100) > 200, 'the 重生 loop');
    await page.evaluate(() => { window.__fx.skillCmd('form', 'form2', { kind: 'reborn' }); window.__fx.step(10, 1 / 60); window.__fx.render(); });
    const after = await page.evaluate(() => window.__fx.ofx.effects.filter((e) => e.state === 'play').map((e) => e.def?.key));
    assert.ok(!after.includes('enemy_reid_revive_01'), String(after));
    assert.ok((await page.evaluate(() => window.__fx.liveKeys())).includes('enemy_reid_revive_02'));
    await page.screenshot({ path: path.join(OUT, 'vfx-skill-enemy-reid-standup.png') });
  });

  test("a deploy talent (耀骑士临光 char_1014_nearl2's AppearTalent): its birth effect at the deploy", async () => {
    const r = await shot('nearl2-deploy', 'char_1014_nearl2', { s: 0 }, [['deploy'], 14]);
    assert.ok(r.keys.includes('nearl2_birth_01_start'), String(r.keys));
    assert.ok(changed(r.img, r.src.x, r.src.y, 120) > 300);
  });

  // round 46 (history §32.14.38): the maintainer's reports of 2026-10-15
  test('溯光星源 S3 (char_1047_halo2): her lightning falls on the target from the upper left, the range lies on her range', async () => {
    const r = await shot('halo2-s3', 'char_1047_halo2', { s: 2, kind: 'bolt', dist: 2 }, [['on'], 20, ['attack'], 12]);
    for (const k of ['halo2_skill_03_trail_01', 'halo2_skill_03_range_01', 'halo2_skill_03_buff_03']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    // the bolt's way down (toTargetOnStart of index.json projectile_chr_halo2_s3: its node runs from (−2.82, 7.13) to the
    // dummy) lies up and to the left of the dummy, not to its right
    const tile = Math.abs(r.tgt.x - r.src.x) / 2;
    const left = changedBox(r.img, r.tgt.x - 1.4 * tile, r.tgt.y - 4 * tile, r.tgt.x - 0.15 * tile, r.tgt.y - 0.9 * tile);
    const right = changedBox(r.img, r.tgt.x + 0.15 * tile, r.tgt.y - 4 * tile, r.tgt.x + 1.4 * tile, r.tgt.y - 0.9 * tile);
    assert.ok(left > 300 && left > 3 * right, `the bolt comes down from the upper left: ${left} px left, ${right} px right`);
    const h = await page.evaluate(() => { window.__fx.step(12, 1 / 60); return window.__fx.liveKeys(); });
    assert.ok(h.includes('halo2_skill_03_hit_01'), `its hit once it lands: ${h}`);
  });

  test('铃兰 S3 (char_358_lisa): the fox tails sit around her; no strip across the board', async () => {
    const r = await shot('lisa-s3', 'char_358_lisa', { s: 2, kind: 'none', dist: 2 }, [['on'], 40]);
    assert.ok(r.keys.includes('lisa_skill_03_buff_02'), String(r.keys));
    const tile = Math.abs(r.tgt.x - r.src.x) / 2;
    assert.ok(changed(r.img, r.src.x, r.src.y - 0.3 * tile, 0.7 * tile) > 400, 'the tails around her');
    // her range reaches one tile behind her: nothing is drawn three tiles behind (the skinned strip ran to the edge)
    let far = 0;
    for (const dy of [-2, -1, 0, 1]) far += changed(r.img, r.src.x - 3.2 * tile, r.src.y + dy * tile, 0.5 * tile);
    assert.ok(far < 40, `no strip behind her: ${far} px`);
  });

  test('野鬃 S2 (char_496_wildmn): the ring of lances (order −3) draws in the ground pass, behind the units', async () => {
    await shot('wildmn-s2', 'char_496_wildmn', { s: 1, kind: 'none', dist: 1 }, [['on'], 20]);
    const where = await page.evaluate(() => {
      const it = window.__fx.ofx.items;
      const name = (e) => `${e.effect.def.key}/${e.effect.def.nodes[e.node]?.name}`;
      return { ground: it.ground.map(name), over: it.over.map(name) };
    });
    assert.ok(where.ground.includes('wildmn_skill_02_buff/huan'), `ground: ${where.ground}`);
    assert.ok(!where.over.includes('wildmn_skill_02_buff/huan'));
    assert.ok(where.over.some((n) => n.startsWith('wildmn_skill_02_buff/suduxian')), 'its speed lines (order 2) stay over the units');
  });

  // (merged with §32.14.36: a chain's line is not flown — the client draws it between the chain's targets as the shot
  // reaches them —; a harpoon's rope runs from the shooter to the head)
  test('异客 (char_472_pasngr): the shot flies its own trail, never its chain line', async () => {
    const r = await shot('pasngr-chain', 'char_472_pasngr', { s: 0, kind: 'bolt', dist: 3 }, [['attack'], 6]);
    assert.ok(r.keys.includes('pasngr_attack_trail'), String(r.keys));
    assert.ok(!r.keys.includes('pasngr_attack_line'), `no chain line in flight: ${r.keys}`);
  });

  test('歌蕾蒂娅 S2 (char_474_glady): the harpoon flies its own head, its rope from her to it', async () => {
    const r = await shot('glady-s2-rope', 'char_474_glady', { s: 1, kind: 'arrow', dist: 3 }, [['on'], ['attack'], 6]);
    for (const k of ['glady_skill_02_trail', 'glady_skill_02_line']) assert.ok(r.keys.includes(k), `${k} in ${r.keys}`);
    const pts = await page.evaluate(() => {
      const fx = window.__fx.ofx.effects.find((e) => e.def?.key === 'glady_skill_02_line');
      return fx ? [...fx.linePts.values()].map((p) => p.map((q) => q.slice())) : null;
    });
    assert.ok(pts && pts.length && pts.every((p) => p.length === 2 && p[1][0] > p[0][0]), `the rope's end points are set: ${JSON.stringify(pts)}`);
  });

  test('the console stays clean', () => {
    assert.deepEqual(problems, []);
  });
});
