// 失衡 (UNBALANCE) after a push / pull — PR #392 by @xcdoge brought the state; its timing re-done from the sources
// (docs/research/13-knockback-official.md): a state machine, not a status (PRTS 失衡位移机制; 异常效果: 「不属于异常效果」), during
// which the enemy neither walks nor starts a normal attack (异常效果图鉴/失衡免疫 「失衡期间无法自主移动、发动攻击、使用技能」).
//   - a push: the 位移时间 of its 受力等级 (PRTS 游戏数据基础 推力-位移近似对应表: 0.2 / 0.4 / 0.8 / 0.9 / 32⁄30 / 35⁄30 s);
//   - a pull: its force window (推与拉 §拉力: 1 s, 0.5 s below 受力等级 −1), to its end after the 急停 too;
//   - a 静态刚体 hit by a force > 0: the 0.1 s 失衡硬直 floor, no movement (特殊机制 静态刚体); 失衡免疫: never;
//   - 浮空 ends it (术语释义 浮空); the move itself stays instant (the unbalanced() talents keyed off the jump).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { PUSH_UNBALANCE, PULL_UNBALANCE, PULL_UNBALANCE_WEAK, UNBALANCE_MIN, PUSH_TILES, TICK } from '../../server/sim/constants.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { canCast } from '../../server/sim/content/enemies/helpers.js';
import { blinkForward } from '../../server/sim/content/enemies/archetypes.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const WALL = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });

/** One walker (weight `mass`) on an open stage; `units` / `o` extra makeBattle options. */
function field({ mass = 1, enemy = {}, units = [], ...o } = {}) {
  const h = makeBattle({
    content: 'none', autoFinish: false, timeLimit: 120, captureNoisy: true, hooks: ['attack'],
    defs: { enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 1e7, speed: 1, mass, ...enemy }) }, chess: { t_wall: WALL } },
    enemies: [{ key: 'enemy_w', pos: [10, 7] }], units, ...o,
  });
  h.step();
  return { h, e: h.enemy('enemy_w') };
}
/** Seconds until `e` moves again (its position changes), up to `max`. */
function stillFor(h, e, max = 3) {
  const x = e.x, y = e.y, t0 = h.b.time;
  while (h.b.time - t0 < max) {
    h.step();
    if (!near(e.x, x) || !near(e.y, y)) return h.b.time - t0;
  }
  return Infinity;
}

test('a push holds the enemy for the 位移时间 of its 受力等级 (PRTS 游戏数据基础), then it walks on', () => {
  for (const [force, level] of [[-1, -2], [0, -1], [1, 0], [2, 1], [3, 2], [4, 3], [6, 3]]) {
    const { h, e } = field();
    const t0 = h.b.time;
    const moved = h.b.push(e, force, { from: { x: e.x + 1, y: e.y } });   // to the left: room for 3.53 tiles
    assert.ok(near(moved, PUSH_TILES[level], 1e-6), `力度 ${force}: moved ${moved}`);
    const want = PUSH_UNBALANCE[level];
    assert.ok(near(e.unbalanceUntil - t0, want), `受力等级 ${level}: ${e.unbalanceUntil - t0} s, want ${want}`);
    const t = stillFor(h, e);
    assert.ok(t >= want - 1e-9 && t <= want + 2 * TICK + 1e-9, `受力等级 ${level}: walks again after ${t.toFixed(3)} s`);
    assert.ok(!e.s.flags.stun, 'no stun status');
    checkInvariants(h.b);
  }
  assert.deepEqual([PUSH_UNBALANCE[0], PUSH_UNBALANCE[3]], [0.8, 35 / 30], 'the table: 24 and 35 frames');
});

test('no normal attack while it lasts — a 恐惧 does not walk out of it either (no exemption)', () => {
  // a ranged enemy shooting the wall operator: pushed, it holds its fire for 0.8 s, then shoots again
  const { h, e } = field({ mass: 0, enemy: { atk: 100, range: 6, bat: 0.5, speed: 0 }, units: [{ chessId: 't_wall', row: 10, col: 3 }] });
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === e), 5), 'it shoots the wall');
  const shots = () => h.hooksOf('attack').filter((c) => c.attacker === e).length;
  const n0 = shots(), t0 = h.b.time;
  h.b.push(e, 0, { from: { x: e.x - 1, y: e.y } });   // 受力等级 0: 0.8 s
  h.run(0.8 - TICK);
  assert.equal(shots(), n0, 'no attack in the 0.8 s');
  assert.ok(h.runUntil(() => shots() > n0, 3), 'then it attacks again');
  assert.ok(h.b.time - t0 >= 0.8 - 1e-9);
  // 恐惧: still held
  const f = field({ mass: 0 });
  f.h.b.applyStatus(f.e, 'fear', { duration: 5, force: true });
  f.h.b.push(f.e, 0, { from: { x: f.e.x - 1, y: f.e.y } });
  assert.ok(stillFor(f.h, f.e) >= 0.8 - 1e-9, 'a feared enemy stays put through the hold');
});

test('the −2 angle correction picks the row: a directional push off by more than 45° holds 0.2 s', () => {
  const { h, e } = field();                               // weight 1: 中力 (1) → 受力等级 0, corrected −2
  const t0 = h.b.time;
  const moved = h.b.push(e, 1, { from: { x: e.x, y: e.y - 1 }, dir: { x: 1, y: 0 } });
  assert.ok(near(moved, PUSH_TILES[-2], 1e-6), `the radial −2 push: ${moved}`);
  assert.ok(near(e.unbalanceUntil - t0, PUSH_UNBALANCE[-2]));
});

test('the row time stays when the 特效 column or a wall shortens the slide; a wall at the first step gives the 0.1 s floor', () => {
  const eff = field({ mass: 0 });
  const t0 = eff.h.b.time;
  const m = eff.h.b.push(eff.e, 0, { from: { x: eff.e.x - 1, y: eff.e.y }, effect: true });
  assert.ok(m < PUSH_TILES[0] && near(eff.e.unbalanceUntil - t0, PUSH_UNBALANCE[0]), '特效 push: shorter, same 0.8 s');
  // against the field's edge: 1.7 tiles asked, a little moved, then none
  const wall = field({ mass: 0 });
  wall.e.x = 9.6;
  const t1 = wall.h.b.time;
  const m1 = wall.h.b.push(wall.e, 0, { from: { x: wall.e.x - 1, y: wall.e.y } });
  assert.ok(m1 > 0 && m1 < PUSH_TILES[0], `stopped by the edge after ${m1}`);
  assert.ok(near(wall.e.unbalanceUntil - t1, PUSH_UNBALANCE[0]), 'still the row time [ASSUMED]');
  const m2 = wall.h.b.push(wall.e, 0, { from: { x: wall.e.x - 1, y: wall.e.y } });
  assert.equal(m2, 0, 'no room left');
  assert.ok(near(wall.e.unbalanceUntil - t1, PUSH_UNBALANCE[0]), 'a running longer state is kept');
  const w2 = field({ mass: 0 });
  w2.e.x = 9.6;
  w2.h.b.push(w2.e, 0, { from: { x: w2.e.x - 1, y: w2.e.y } });
  w2.h.run(1);
  const t2 = w2.h.b.time;
  assert.equal(w2.h.b.push(w2.e, 0, { from: { x: w2.e.x - 1, y: w2.e.y } }), 0);
  assert.ok(near(w2.e.unbalanceUntil - t2, UNBALANCE_MIN), 'stopped at once: the 0.1 s floor [ASSUMED]');
});

test('a pull holds for its force window (推与拉): 1 s, 0.5 s below 受力等级 −1, to the end after the 急停; ≤ −3 nothing', () => {
  for (const [force, mass, want] of [[1, 1, PULL_UNBALANCE], [0, 1, PULL_UNBALANCE], [-1, 1, PULL_UNBALANCE_WEAK], [-2, 1, 0]]) {
    const { h, e } = field({ mass });
    const t0 = h.b.time;
    h.b.pull(e, force, { to: { x: 3, y: 10 } });
    const got = Number.isFinite(e.unbalanceUntil) ? e.unbalanceUntil - t0 : 0;
    assert.ok(near(got, want), `力度 ${force} − 重量 ${mass}: ${got} s, want ${want}`);
  }
  // already inside the 急停 circle: no movement, the state for the whole window
  const { h, e } = field();
  const t0 = h.b.time;
  assert.equal(h.b.pull(e, 1, { to: { x: e.x - 0.3, y: e.y }, center: { x: e.x - 0.3, y: e.y } }), 0);
  assert.ok(near(e.unbalanceUntil - t0, PULL_UNBALANCE), '急停 at once: still 1 s');
  assert.ok(stillFor(h, e) >= PULL_UNBALANCE - 1e-9);
});

test('a 静态刚体 hit by a force > 0 gets the 0.1 s floor and never moves; 失衡免疫 never enters it', () => {
  const s = field({ enemy: { motion: 'FLY' } });
  s.e.def = { ...s.e.def, staticBody: true };
  const x0 = s.e.x, t0 = s.h.b.time;
  assert.equal(s.h.b.push(s.e, 3, { from: { x: s.e.x - 1, y: s.e.y } }), 0);
  assert.equal(s.e.x, x0, 'not moved');
  assert.ok(near(s.e.unbalanceUntil - t0, UNBALANCE_MIN), '0.1 s');
  const s2 = field({ enemy: { motion: 'FLY' } });
  s2.e.def = { ...s2.e.def, staticBody: true };
  s2.h.b.pull(s2.e, -3, { to: { x: 3, y: 10 } });            // 受力等级 −4: force 0
  assert.ok(!Number.isFinite(s2.e.unbalanceUntil), 'no force, no state');
  const im = field();
  im.h.b.addBuff(im.e, { key: 'test:immune', flags: { noDisplace: true } });
  im.h.b.push(im.e, 3, { from: { x: im.e.x - 1, y: im.e.y } });
  im.h.b.pull(im.e, 3, { to: { x: 3, y: 10 } });
  assert.ok(!Number.isFinite(im.e.unbalanceUntil), '失衡免疫: never');
});

test('浮空 ends the state at once (术语释义 浮空)', () => {
  const { h, e } = field({ mass: 0 });
  h.b.push(e, 3, { from: { x: e.x - 1, y: e.y } });
  assert.ok(e.unbalanceUntil > h.b.time);
  h.b.applyStatus(e, 'levitate', { duration: 0.5, force: true });
  h.step();
  assert.ok(!(e.unbalanceUntil > h.b.time), 'cleared');
});

test('the displace fx carries the state\'s game seconds for the client\'s slide', () => {
  const { h, e } = field({ mass: 0 });
  h.b.drainEvents();
  h.b.push(e, 1, { from: { x: e.x - 1, y: e.y } });
  const fx = (h.b.drainEvents() || []).find((t) => t[0] === 'fx' && t[1] === 'displace');
  assert.ok(fx && near(fx[4].dur, PUSH_UNBALANCE[1]), JSON.stringify(fx));
});

// ---------------------------------------------------------------------------------------------------------------
// the branch review (fb7-unbalance): exact frames, a 静态刚体 pulled, 弧光锋卫's bleed, skills and scripted moves, the
// forced state switches

test('every push row holds its exact frames at 30 fps (6, 12, 24, 27, 32, 35) — the enemy walks on the next frame', () => {
  for (const [force, frames] of [[-1, 6], [0, 12], [1, 24], [2, 27], [3, 32], [4, 35]]) {
    const { h, e } = field();
    h.b.push(e, force, { from: { x: e.x + 1, y: e.y } });
    const x = e.x, y = e.y;
    let k = 0;
    while (k < 60) { h.step(); k++; if (!near(e.x, x) || !near(e.y, y)) break; }
    assert.equal(k, frames + 1, `力度 ${force} (受力等级 ${force - 1}): held ${k - 1} frames, want ${frames}`);
  }
});

test('a 静态刚体 pulled is held for the pull\'s force window (1 s; 0.5 s below 受力等级 −1), a pushed one 0.1 s — never moved', () => {
  for (const [kind, force, want] of [['pull', 1, PULL_UNBALANCE], ['pull', -1, PULL_UNBALANCE_WEAK], ['push', 3, UNBALANCE_MIN]]) {
    const s = field({ enemy: { motion: 'FLY' } });
    s.e.def = { ...s.e.def, staticBody: true };
    const x0 = s.e.x, t0 = s.h.b.time;
    if (kind === 'pull') s.h.b.pull(s.e, force, { to: { x: 3, y: 10 } });
    else s.h.b.push(s.e, force, { from: { x: s.e.x - 1, y: s.e.y } });
    assert.equal(s.e.x, x0, `${kind}: not moved`);
    assert.ok(near(s.e.unbalanceUntil - t0, want), `${kind} 力度 ${force}: ${s.e.unbalanceUntil - t0} s, want ${want}`);
  }
});

const REAL = { skip: !hasGeneratedData() };
/** A pinned real enemy (data/enemies.json) on the open stage, with its content kit. */
function real(key, o = {}) {
  const h = makeBattle({ content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 60, captureNoisy: true,
    hooks: ['damaged'], defs: { chess: { t_wall: { ...WALL, stats: { ...WALL.stats, blockCnt: 3 } } } }, ...o });
  h.step();
  const e = h.spawn(key, { pos: o.pos ?? [10, 7], routeIndex: 0, mods: { speedMul: o.move ? 1 : 0 } });
  h.step();
  return { h, e };
}

test('弧光锋卫 bleeds 400 true damage every 0.066 s for as long as the state lasts (PRTS 天赋) — a push, a 急停 pull, a wall-shortened slide', REAL, () => {
  const bleed = (act) => {
    const { h, e } = real('enemy_1328_cbjedi');
    const hp0 = e.hp;
    act(h, e);
    h.run(2);
    const hits = h.hooksOf('damaged').filter((c) => c.target === e && c.dmg.tags?.includes('unbalanced'));
    return { lost: hp0 - e.hp, hits: hits.length };
  };
  // weight 1: 力度 1 → 受力等级 0, 0.8 s → 12 × 400; a 急停 pull (no movement) 1 s → 15 × 400; the wall keeps the 0.8 s row
  assert.deepEqual(bleed((h, e) => h.b.push(e, 1, { from: { x: e.x + 1, y: e.y } })), { lost: 4800, hits: 12 });
  assert.deepEqual(bleed((h, e) => h.b.pull(e, 2, { to: { x: e.x - 0.3, y: e.y }, center: { x: e.x - 0.3, y: e.y } })), { lost: 6000, hits: 15 });
  assert.deepEqual(bleed((h, e) => { e.x = 9.6; h.b.push(e, 1, { from: { x: e.x - 1, y: e.y } }); }), { lost: 4800, hits: 12 });
});

test('no skill, blink or scripted move while it lasts (失衡免疫 「失衡期间无法自主移动、发动攻击、使用技能」)', REAL, () => {
  // the skill gate and the blink
  const { h, e } = field();
  h.b.pull(e, 1, { to: { x: e.x - 0.3, y: e.y }, center: { x: e.x - 0.3, y: e.y } });    // 1 s, no movement
  assert.equal(canCast(e, false, h.b), false, 'canCast');
  const x0 = e.x;
  assert.equal(blinkForward(h.b, e, 1.5), null, 'blinkForward');
  assert.equal(e.x, x0);
  h.run(1.05);
  assert.equal(canCast(e, false, h.b), true, 'after the state');
  // 枯朽之种 (a 静态刚体 flyer): the pull holds it before it enters the 2-tile launch range.
  const s = real('enemy_1269_nhfly', { units: [{ chessId: 't_wall', row: 10, col: 6 }], pos: [10, 8.2], move: true });
  const t0 = s.h.b.time;
  s.h.b.pull(s.e, 3, { to: { x: 3, y: 10 } });
  assert.ok(near(s.e.unbalanceUntil - t0, PULL_UNBALANCE));
  const sx = s.e.x, sy = s.e.y;
  s.h.run(0.9);
  assert.ok(s.e.alive && near(s.e.x, sx) && near(s.e.y, sy), 'still where it was, not launched');
  assert.equal(s.h.b.projectiles.list.some((p) => p.source === s.e), false, 'no projectile during the pull');
  assert.ok(s.h.runUntil(() => !s.e.alive, 5), 'then it enters range, launches and blows up');
});

test('乌顶巨角卢鲁: a 失衡 that does not move it holds its clash until the state ends', REAL, () => {
  const { h, e } = real('enemy_10144_xdelk_2', { units: [{ chessId: 't_wall', row: 10, col: 6 }], move: true });
  assert.ok(h.runUntil(() => h.eventsOf('fx').some((x) => x[1] === 'telegraph' && x[4]?.kind === 'elkCharge'), 10), 'the charge starts');
  const start = h.b.time, dur = 8;
  h.run(dur - 0.5);
  h.b.pull(e, 5, { to: { x: e.x + 0.2, y: e.y }, center: { x: e.x + 0.2, y: e.y } });   // 急停 at once: 1 s, no movement
  const until = e.unbalanceUntil;
  assert.ok(until > start + dur, 'the state outlasts the charge timer');
  const clash = () => h.eventsOf('fx').some((x) => x[1] === 'explode' && x[4]?.kind === 'elkClash');
  assert.ok(h.runUntil(clash, 3), 'it clashes');
  assert.ok(h.b.time >= until - 1e-9, `not before the state ends (${h.b.time.toFixed(3)} vs ${until.toFixed(3)})`);
});

test('a route APPEAR (a forced relocation) and a 逐火 重生 end the state', REAL, () => {
  const { h, e } = field({ mass: 0 });
  h.b.push(e, 3, { from: { x: e.x - 1, y: e.y } });
  assert.ok(e.unbalanceUntil > h.b.time);
  e.route.legs.splice(e.route.legIdx, 0, { t: 'appear', r: 10, c: 3 });
  h.step();
  assert.equal(e.x, 3, 'relocated');
  assert.ok(!(e.unbalanceUntil > h.b.time), 'APPEAR ended it');
  const w = real('enemy_1288_duskls');
  w.h.b.push(w.e, 4, { from: { x: w.e.x + 1, y: w.e.y } });
  assert.ok(w.e.unbalanceUntil > w.h.b.time);
  w.h.b.dealDamage(null, w.e, { amount: 1e9, type: 'true' });
  assert.ok(w.e.alive, 'it fell into its 余烬 (重生)');
  assert.ok(!(w.e.unbalanceUntil > w.h.b.time), 'the 重生 ended it');
});
