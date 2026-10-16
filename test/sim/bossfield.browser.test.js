// test/sim/bossfield.browser.test.js — the Final Assault / Hidden Core fields in the BROWSER sim (DESIGN §14: the
// clients simulate the boss fields; the server re-simulates them for SP_VERIFY and takeovers). A real bot co-op match
// (终极, seed 22 since 0.1.1 — the bots and the rules of 0.1.1 play seed 12 to boards without a 麻痹 or a 剑 / 锤
// transfer on every field, and seed 14 since the 22-match R11 drafts to boards without a 麻痹; seed 22's pair fields
// carry 奥术 and 剑 / 锤 transfers) is played to the Hidden Core
// with every active bond at the official 999 layers (DESIGN §20.12); its four captured boss specs (R14 假想敌：胄 boss_1, R15 隐秘核心 boss_8) run to
// the end in Node and in headless Chrome through the client's own loader (public/js/battle/runner.js loadBrowserSim)
// with the field's LocalBossPool, and must give the same result digest, the same pool and the same fx per kind.
// The fields exercise the playtest-6b sim paths: 直接乘算 bonus sums (§20.10), one 奥术 instance per target
// (applyStrongest), the drone 2 % links and the 剑 / 锤 / shell kit (§20.13), and 限伤 cancels (fx 'hitCap', §20.12).
// 瘫痪 (fx 'palsy': a 麻痹 stack interrupts an enemy attack) is checked on the same four specs with a golden 催泪瓦斯 in
// every operator's second slot (withTearGas), compared Chrome vs Node like the others: the bots' only 麻痹 had been one
// 5 % 催泪瓦斯 on one operator — a single hit at 0.1.4, none since 0.2.0's enemy damage frame (WE1) re-timed every fight.
// 限伤 (and 奥术, which the bots no longer draft either) likewise, on a third copy of the four whose first player fields a
// fixed board of 999-layer heavy hitters
// (withHeavyHitters): the bots' own hits of ≥ 300000 came from whatever 维多利亚 / 精准 / 奥术 mix they drafted — none
// since 0.2.0's CB3 (the 受到攻击时 counters answer every damage instance) re-drafted seed 22, whose best hit is now
// about half the limit; the cancel path itself is unchanged (the earlier captures still cancel the same hits).
// 无来源 HP (drone 死亡集群 links and 剑 / 锤 transfers) likewise, on a fourth copy (withTransferWindow). Shared co-op
// stock (DESIGN §29.8) re-drafted seed 22: the 999-layer boards now clear in tens of seconds, before a drone is killed
// on every field and before a blade takes a transferable hit (a forced replace is not damage). The transfer path is
// unchanged — the 0.2.3 specs of this seed still lose leader HP on every field under this sim. The copy keeps the
// drafted operators and holds 维多利亚 / 精准 / 奥术 / 卡西米尔 / 绝技 at 1 layer so the fight lasts long enough (0.3.0's bots
// re-drafted seed 22 again: one of those fields now runs to the time limit, which that copy is allowed to).
//
// Opt-in (starts Chrome): SIM_E2E=1 node --test test/sim/bossfield.browser.test.js   (or RENDER_E2E=1)
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, bondSnapshot } from '../../server/match/bondsMeta.js';
import { tileKey } from '../../server/match/board.js';
import { makeMatch, DATA } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = (process.env.RENDER_E2E === '1' || process.env.SIM_E2E === '1') && existsSync(CHROME);
const skip = enabled ? false : 'set SIM_E2E=1 or RENDER_E2E=1 (needs Chrome)';
// game seconds (Battle.runToEnd), a safety net only: every field must clear before it. The bots' boards follow the rules
// of the whole match (seed 22): since 0.2.0's last fixes (GitHub #232 re-drafted the earlier rounds) the Hidden Core b1
// board clears at about 511 s, its 催泪瓦斯 copy (the second item replaced) at about 619 s — twice that leaves room
const MAX_SECONDS = 1200;

/** The boss / hidden specs of a 4-bot co-op match (终极, seed 22, boss_1 then boss_8), every active bond at 999. */
function captureBossSpecs() {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seats, seed: 22, captureFrames: false, instant: false, clientCombat: true });
  const m = h.m;
  m.bossId = 'boss_1';
  m.hiddenBossId = 'boss_8';
  const specs = [];
  const orig = m._ccField.bind(m);
  m._ccField = (o) => { const f = orig(o); if (f.kind === 'boss' || f.kind === 'hidden') specs.push(f.spec); return f; };
  m.start();
  let last = '';
  h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) {
      last = k;
      if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 400;
      if (m.phase === PHASE.PREP && m.round === m.gd.bossRound) {
        for (const ps of m.alivePlayers()) {
          for (const id of m.gd.bondIds) if (ps.bonds[id] && ps.bonds[id].active) ps.layers[id] = BOND_LAYER_CAP;
          ps.recompute();
        }
      }
    }
    return h.ended != null || m.phase === PHASE.HIDDEN_CORE;
  }, { maxSteps: 8e6 });
  assert.equal(m.phase, PHASE.HIDDEN_CORE, 'the bots reached the Hidden Core');
  m.dispose();
  return specs;
}

/**
 * A copy of `spec` where every operator carries a golden 催泪瓦斯 (攻击时有5%概率使目标获得一层麻痹) in its second slot —
 * two slots, as in the game: a 麻痹 source on every field whatever the bots drafted (seed 22's own was a single 5 % roll).
 */
const TEAR_GAS = 'chess_item_5_01_e_b';
function withTearGas(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  for (const p of s.players || []) {
    for (const u of p.units || []) {
      if (u.kind === 'chess') u.items = [...(u.items || []).filter((id) => !String(id).startsWith('chess_item_5_01_e')).slice(0, 1), TEAR_GAS];
    }
  }
  return s;
}

/**
 * A copy of `spec` whose first player's first five operators become a fixed 限伤 board on the same tiles, each with a
 * 维式重锤: elite 焰影苇草 (维多利亚 + 精准), 洛洛 (维多利亚 + 奥术), 深靛 (奥术 + 精准), 刺玫 (维多利亚) and 远牙 (精准) — all
 * ranged, so any tile takes them; the tokens of the operators replaced go with them. That player's bonds are recomputed
 * for the new board as the match computes them (server/match/bondsMeta.js computeBonds), every active one at 999
 * layers: 精准 (3: every ranged operator) ATK ×13, 维多利亚 ×9.2 damage with equipment and 奥术 ×11 法术伤害 taken on the
 * leader put the arts hits of 焰影苇草, 洛洛 and 刺玫 at up to 1.3 M — hundreds per field past 限伤's 300000, whatever
 * the bots drafted (every field of seeds 1–40 at 0.2.0).
 */
const HEAVY_HITTERS = ['chess_char_6_08_b', 'chess_char_2_10_b', 'chess_char_1_17_b', 'chess_char_1_06_b', 'chess_char_4_20_b'];
const HAMMER = 'chess_item_1_01_e_a'; // 维式重锤: 攻击力+15%
function withHeavyHitters(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  const p = s.players[0];
  const replaced = new Set();
  p.units = p.units.map((u) => {
    if (u.kind !== 'chess' || replaced.size >= HEAVY_HITTERS.length) return u;
    const chessId = HEAVY_HITTERS[replaced.size];
    replaced.add(u.uid);
    return { uid: u.uid, kind: 'chess', chessId, row: u.row, col: u.col, dir: u.dir, items: [HAMMER] };
  }).filter((u) => !(u.kind === 'token' && replaced.has(u.ownerUid)));
  const gd = new GameData(DATA, s.modeId);
  const board = new Map(p.units.filter((u) => u.kind === 'chess').map((u) => [tileKey(u.row, u.col), { kind: 'chess', id: u.chessId, items: (u.items || []).map((id) => ({ id })) }]));
  const layers = Object.fromEntries(gd.bondIds.map((id) => [id, BOND_LAYER_CAP]));
  p.bonds = bondSnapshot(computeBonds(gd, { board, hand: [], layers, bondCountBonus: {} }));
  for (const b of Object.values(p.bonds)) if (!b.active) b.layers = 0;
  return s;
}

/**
 * A copy of `spec` whose 维多利亚 / 精准 / 奥术 / 卡西米尔 / 绝技 layers are held at 1. At 999 those bonds end seed 22's
 * shared-stock boards before a 死亡集群 drone dies on every field and before a 斩胄之剑 / 破胄之锤 takes damage
 * (DESIGN §29.8). One layer keeps the bond and lets the parts land; the operators stay the ones the bots drafted.
 */
const TRANSFER_BONDS = ['victoriaShip', 'preciShip', 'arcaneShip', 'kazimierzShip', 'suntShip'];
function withTransferWindow(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  for (const p of s.players || []) {
    for (const id of TRANSFER_BONDS) {
      const b = p.bonds && p.bonds[id];
      if (b && b.active && b.layers > 1) b.layers = 1;
    }
  }
  return s;
}

/**
 * Runs a spec to the end (the same code in Node and in the page: `S` = spec module, `ds` = data source) and returns
 * its digest, the local pool, the fx count per kind and the leader-side checks (奥术 instances, 无来源 HP losses).
 * Serialised into the page with Function#toString, so it uses nothing from this module's scope.
 */
function runField(S, ds, spec, maxSeconds) {
  const b = S.createBattleFromSpec(spec, ds, { quiet: true, recordEvents: false });
  const fx = {};
  const fx0 = b.fx.bind(b);
  b.fx = (k, p) => { fx[k] = (fx[k] || 0) + 1; return fx0(k, p); };
  let hpLoss = 0;
  b.on('damaged', (c) => { if (c.target && c.target.isBoss && c.dmg && c.dmg.tags && c.dmg.tags.includes('hpLoss')) hpLoss++; }, { priority: -1e9 });
  let maxArcane = 0;
  b.on('tick', () => {
    for (const e of b.enemies) {
      if (!e.alive || !e.isBoss) continue;
      const n = e.buffs.filter((x) => String(x.key).startsWith('bond:arcaneShip')).length;
      if (n > maxArcane) maxArcane = n;
    }
  });
  const r = b.runToEnd(maxSeconds);
  const d = S.resultDigest(r);
  return { hash: d.hash, json: d.json, reason: r ? r.reason : null, poolHp: b.sharedBoss ? b.sharedBoss.hp : null, fx, hpLoss, maxArcane };
}

describe('Final Assault / Hidden Core fields in the browser sim', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('real boss specs at 999 layers: Chrome and Node give the same digest, pool and fx; 限伤, drones, 瘫痪 and 奥术 all occur', { timeout: 180000 }, async () => {
    const specs = captureBossSpecs();
    assert.deepEqual(specs.map((s) => `${s.kind}:${s.bossId}`).sort(), ['boss:boss_1', 'boss:boss_1', 'hidden:boss_8', 'hidden:boss_8']);
    // the four as captured, the same four with a 麻痹 source on every field (withTearGas), with 限伤-sized hits
    // on every field (withHeavyHitters), and with the damage bonds held at 1 layer (withTransferWindow)
    const runs = [...specs, ...specs.map(withTearGas), ...specs.map(withHeavyHitters), ...specs.map(withTransferWindow)];
    const ds = new DataSource(DATA, null);
    const node = runs.map((spec) => runField({ createBattleFromSpec, resultDigest }, ds, spec, MAX_SECONDS));

    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // (a failed request is reported by the response handler with its URL; the favicon 404 is not a problem)
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    // the test rebuilds runField from its source inside the page (new Function); the site's CSP (0.3.0) allows no eval
    await page.setBypassCSP(true);
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const chrome = await page.evaluate(async (all, src, maxSeconds) => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { spec: S, ds } = await loadBrowserSim();
      const run = new Function(`return (${src})`)();
      return all.map((spec) => run(S, ds, spec, maxSeconds));
    }, runs, runField.toString(), MAX_SECONDS);
    await page.close();
    assert.deepEqual(problems, []);

    const copies = ['', ' +催泪瓦斯', ' +heavy hitters', ' +transfer window'];
    runs.forEach((spec, i) => {
      const at = `${spec.kind} ${spec.fieldId} ${spec.bossId}${copies[Math.floor(i / specs.length)]}`;
      // the copy with the damage bonds held at 1 layer exists to cost the leader 无来源 HP; it may run to the time limit on a
      // field (0.3.0's bots: Hidden Core b1 keeps ~5.4 M pool HP after 1200 s) — Chrome and Node must still agree
      if (i < 3 * specs.length) assert.equal(node[i].reason, 'cleared', `${at}: the 999-layer pair clears the field`);
      assert.equal(chrome[i].json, node[i].json, `${at}: browser and Node results are identical`);
      assert.equal(chrome[i].hash, node[i].hash, at);
      assert.equal(chrome[i].poolHp, node[i].poolHp, `${at}: same local pool`);
      assert.deepEqual(chrome[i].fx, node[i].fx, `${at}: same fx per kind`);
      assert.equal(chrome[i].hpLoss, node[i].hpLoss, `${at}: same 无来源 HP losses on the leader`);
      assert.ok(node[i].maxArcane <= 1, `${at}: one 奥术 instance on the leader at a time (${node[i].maxArcane})`);
    });
    const real = node.slice(0, specs.length);
    const gassed = node.slice(specs.length, 2 * specs.length);
    const heavy = node.slice(2 * specs.length, 3 * specs.length);
    const opened = node.slice(3 * specs.length);
    const sum = (rows, k) => rows.reduce((a, r) => a + (r.fx[k] || 0), 0);
    assert.ok(sum(heavy, 'hitCap') >= 1, `a 999-layer hit reached 300000 and was cancelled (限伤: ${heavy.map((r) => r.fx.hitCap || 0)} with the heavy hitters, ${sum(real, 'hitCap')} on the bots' own boards)`);
    assert.ok(sum(gassed, 'palsy') >= 1, `瘫痪 occurred with the 催泪瓦斯 (${gassed.map((r) => r.fx.palsy || 0)})`);
    assert.ok(opened.every((r) => r.hpLoss >= 1), `holding the damage bonds at 1 layer, every field cost the leader 无来源 HP (drone links / 剑 · 锤 transfers: ${opened.map((r) => r.hpLoss)}; the 999-layer boards: ${real.map((r) => r.hpLoss)})`);
    // 奥术 on the bots' own boards or on the heavy-hitter copy (洛洛 + 深靛 = 奥术 2): seed 22's bots stopped drafting it
    // when 0.2.0's last fixes re-drafted the earlier rounds
    assert.ok([...real, ...heavy].some((r) => r.maxArcane === 1), `the leader carried 奥术 (bots' boards ${real.map((r) => r.maxArcane)}, heavy hitters ${heavy.map((r) => r.maxArcane)})`);
  });
});
