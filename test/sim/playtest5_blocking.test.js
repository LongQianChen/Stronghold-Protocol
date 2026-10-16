// User playtest #5 item 4 — "如果敌人被卡在两个干员之间的话，靠后的干员死亡敌人会直接走掉，而不是换成靠前面的干员接替阻挡".
//
// Official rule (PRTS 游戏数据基础 §阻挡半径, 作战机制 §碰撞体积与位置识别 "中点判定 … 案例: 阻挡"): an unblocked ground
// enemy whose position lies within the ground block radius 0.7071 (squared 0.49999037) of a ground operator's centre is
// blocked by it while the operator has free block capacity — checked continuously, so an enemy that overlaps an
// operator when its blocker dies (or when the operator's capacity frees up) is taken over at once. Flying enemies:
// air block radius 0.8944 (起飞 / blockFly units); devices (阻隔工事 / 障碍物): 0.4472.
//
// Flat stage: lower-gate enemies walk row 9 from the gate (9,10) to the goal (9,2), i.e. towards smaller columns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { BLOCK_RADIUS } from '../../server/sim/constants.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const FRONT = 'test_front_a', BACK = 'test_back_a';
const op = (id, blockCnt = 1) => chessRec({ id, stats: { atk: 0, blockCnt, maxHp: 1e6, respawnTime: 999 }, skill: null });
const foe = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 1, ...o });

function lane(units, enemies, defs = {}) {
  return makeBattle({
    defs: {
      chess: { [FRONT]: op(FRONT, defs.frontBlock ?? 1), [BACK]: op(BACK, defs.backBlock ?? 1), ...(defs.chess || {}) },
      enemies: { enemy_x: foe('enemy_x'), enemy_e: foe('enemy_e'), enemy_heavy: foe('enemy_heavy', { blockCnt: 2 }), ...(defs.enemies || {}) },
    },
    units, enemies, timeLimit: 200, content: 'none',
  });
}
const kill = (h, u) => h.b.loseHp(u, 1e12);

test('the official block radii are the PRTS numbers', () => {
  assert.ok(Math.abs(BLOCK_RADIUS.ground - 0.7071) < 1e-3);
  assert.ok(Math.abs(BLOCK_RADIUS.fly - 0.8944) < 1e-3);
  assert.ok(Math.abs(BLOCK_RADIUS.device - 0.4472) < 1e-3);
});

test('#4: the enemy between two operators is taken over by the front one when its blocker (the rear one) dies', () => {
  // front (9,6) blocks X; E walks through the full front operator and is blocked by the rear one (9,5) — it now
  // overlaps both. X dies (front has room again), then the rear blocker dies: E must stay, blocked by the front one.
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }, { chessId: BACK, row: 9, col: 5 }],
    [{ key: 'enemy_x', time: 0 }, { key: 'enemy_e', time: 1 }]);
  const front = h.unit(FRONT), back = h.unit(BACK);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
  const e = () => h.b.enemies.find((q) => q.defId === 'enemy_e');
  assert.ok(h.runUntil(() => x()?.blockedBy === front && e()?.blockedBy === back, 30), 'X blocked by the front, E by the rear operator');
  const ex = e().x;
  assert.ok(Math.hypot(ex - 6, e().y - 9) < BLOCK_RADIUS.ground, `E overlaps the front operator too (x=${ex.toFixed(3)})`);
  kill(h, x());
  h.step(2);
  assert.equal(e().blockedBy, back, 'E stays with its blocker while the rear operator lives');
  kill(h, back);
  h.step(2);
  assert.equal(e().blockedBy, front, 'the front operator takes E over');
  h.run(5);
  assert.equal(e().blockedBy, front);
  assert.ok(Math.abs(e().x - ex) < 1e-6, 'E did not walk on');
  checkInvariants(h.b);
});

test('#4: a withdrawn or stunned blocker hands its enemy to the operator it still touches', () => {
  for (const how of ['retreat', 'stun']) {
    const h = lane([{ chessId: FRONT, row: 9, col: 6 }, { chessId: BACK, row: 9, col: 5 }],
      [{ key: 'enemy_x', time: 0 }, { key: 'enemy_e', time: 1 }]);
    const front = h.unit(FRONT), back = h.unit(BACK);
    const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
    const e = () => h.b.enemies.find((q) => q.defId === 'enemy_e');
    assert.ok(h.runUntil(() => x()?.blockedBy === front && e()?.blockedBy === back, 30));
    kill(h, x());
    if (how === 'retreat') h.b.retreat(back); else h.b.applyStatus(back, 'stun', { duration: 5 });
    h.step(2);
    assert.equal(e().blockedBy, front, how);
    checkInvariants(h.b);
  }
});

test('#4: the rear blocker dies while the front operator is still full — the enemy walks on (no room)', () => {
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }, { chessId: BACK, row: 9, col: 5 }],
    [{ key: 'enemy_x', time: 0 }, { key: 'enemy_e', time: 1 }]);
  const front = h.unit(FRONT), back = h.unit(BACK);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
  const e = () => h.b.enemies.find((q) => q.defId === 'enemy_e');
  assert.ok(h.runUntil(() => x()?.blockedBy === front && e()?.blockedBy === back, 30));
  kill(h, back);
  h.step(2);
  assert.equal(e().blockedBy, null, 'no room at the front → E walks on');
  const x0 = e().x;
  h.run(1);
  assert.ok(e().x < x0 - 0.2, 'E is walking again');
  checkInvariants(h.b);
});

test('#4: an operator whose capacity frees up blocks an enemy that still overlaps it (past its tile, inside 0.7071)', () => {
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }], [{ key: 'enemy_x', time: 0 }, { key: 'enemy_e', time: 1 }]);
  const front = h.unit(FRONT);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
  const e = () => h.b.enemies.find((q) => q.defId === 'enemy_e');
  assert.ok(h.runUntil(() => x()?.blockedBy === front, 30));
  // E walks through the full operator; free the capacity once E has left the operator's tile (x < 5.5) but is still
  // within the block radius
  assert.ok(h.runUntil(() => e() && e().x < 5.42, 30));
  assert.equal(e().blockedBy, null, 'passing through while full');
  kill(h, x());
  h.step(1);
  assert.equal(e().blockedBy, front, 'taken as soon as the operator has room');
  checkInvariants(h.b);
});

test('#4: pass-through when full — an enemy that never finds room walks past the operator', () => {
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }], [{ key: 'enemy_x', time: 0 }, { key: 'enemy_e', time: 1 }]);
  const front = h.unit(FRONT);
  const e = () => h.b.enemies.find((q) => q.defId === 'enemy_e');
  assert.ok(h.runUntil(() => e() && e().x < 4.5, 40), 'E walked past the full operator');
  assert.equal(e().blockedBy, null);
  assert.equal(front.blocking.length, 1);
  checkInvariants(h.b);
});

test('#4: contact happens at the block radius (the enemy stops ~0.71 tile from the operator, outside its tile)', () => {
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }], [{ key: 'enemy_x', time: 0 }]);
  const front = h.unit(FRONT);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
  assert.ok(h.runUntil(() => x()?.blockedBy === front, 30));
  const d = Math.hypot(x().x - 6, x().y - 9);
  assert.ok(d <= BLOCK_RADIUS.ground + 1e-9 && d > BLOCK_RADIUS.ground - 0.05, `blocked at contact (d=${d.toFixed(3)})`);
  checkInvariants(h.b);
});

test('#4: an operator beside the lane (one row off) never touches the enemies walking it', () => {
  const h = lane([{ chessId: FRONT, row: 10, col: 6 }], [{ key: 'enemy_x', time: 0 }]);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
  assert.ok(h.runUntil(() => x() && x().x < 4, 40));
  assert.equal(h.hooksOf('blocked').length, 0);
});

test('#4: block weight — a 2-weight enemy needs 2 free block', () => {
  const h1 = lane([{ chessId: FRONT, row: 9, col: 6 }], [{ key: 'enemy_heavy', time: 0 }]);
  const heavy1 = () => h1.b.enemies.find((e) => e.defId === 'enemy_heavy');
  assert.ok(h1.runUntil(() => heavy1() && heavy1().x < 4.5, 40), 'block 1 cannot hold a 2-weight enemy');
  assert.equal(heavy1().blockedBy, null);
  const h2 = lane([{ chessId: FRONT, row: 9, col: 6 }], [{ key: 'enemy_heavy', time: 0 }], { frontBlock: 2 });
  assert.ok(h2.runUntil(() => h2.b.enemies[0]?.blockedBy === h2.unit(FRONT), 30), 'block 2 holds it');
});

test('#4: of two free operators in contact the nearer one blocks', () => {
  // an enemy standing still between (9,6) and (9,5), nearer to (9,5)
  const h = lane([{ chessId: FRONT, row: 9, col: 6 }, { chessId: BACK, row: 9, col: 5 }], [],
    { enemies: { enemy_still: foe('enemy_still', { speed: 0 }) } });
  h.step(1);
  const e = h.spawn('enemy_still', { pos: [9, 5.4] });
  h.step(1);
  assert.equal(e.blockedBy, h.unit(BACK));
  checkInvariants(h.b);
});

test('#4: a blocker attacks the enemy it blocks even when it stands outside its range (可以选择且优先选择阻挡单位)', () => {
  // facing LEFT (away from the gate): its range (9,6),(9,5) never holds the enemy blocked at x ≈ 6.71 (tile (9,7))
  const h = makeBattle({
    defs: { chess: { t_back: chessRec({ id: 't_back', stats: { atk: 100, blockCnt: 1, maxHp: 1e6 }, skill: null }) }, enemies: { enemy_x: foe('enemy_x') } },
    units: [{ chessId: 't_back', row: 9, col: 6, dir: 'LEFT' }], enemies: [{ key: 'enemy_x', time: 0 }], timeLimit: 60,
    hooks: ['damaged'], captureNoisy: true,
  });
  const u = h.unit('t_back');
  const x = () => h.b.enemies[0];
  assert.ok(h.runUntil(() => x()?.blockedBy === u, 30));
  assert.ok(!u.rangeKeySet.has(Math.round(x().y) * 21 + Math.round(x().x)), 'outside its range');
  h.run(3);
  assert.ok(h.hooksOf('damaged').some((c) => c.source === u && c.target === x()), 'it hits its blocked enemy');
});

test('#4 (revised by the user after playtest #6): a ranged operator on a melee tile also hits and casts for the enemy it holds behind it', () => {
  // The playtest #5 QA had made blocked-first melee-only (PRTS 索敌的概念 "阻挡（近战限定）"); the user's rule after
  // playtest #6 — "阻挡了就一定要能打到": whatever blocks an enemy can hit it, where it stands. Facing LEFT, the range
  // (9,6),(9,5) never holds the enemy blocked at x ≈ 6.71 (its 0.1 collider ends at 6.61); the ranged blocker hits it and casts its DEFAULT skill like a melee one (帮助: the blocked enemy satisfies the
  // target condition).
  const run = (id, profession) => {
    const h = makeBattle({
      defs: { chess: { [id]: chessRec({ id, profession, stats: { atk: 100, blockCnt: 1, maxHp: 1e6 }, skill: { spCost: 1, initSp: 1, duration: 5 } }) }, enemies: { enemy_x: foe('enemy_x') } },
      units: [{ chessId: id, row: 9, col: 6, dir: 'LEFT' }], enemies: [{ key: 'enemy_x', time: 0 }], timeLimit: 60,
      content: 'generic', kits: { [id]: () => ({ skill: { kind: 'duration', duration: 5 } }) }, hooks: ['damaged'], captureNoisy: true,
    });
    const u = h.unit(id);
    const x = () => h.b.enemies[0];
    assert.ok(h.runUntil(() => x()?.blockedBy === u, 30), `${profession} blocks`);
    assert.ok(!u.rangeKeySet.has(Math.round(x().y) * 21 + Math.round(x().x)), 'outside its range');
    h.run(3);
    checkInvariants(h.b);
    return { hits: h.hooksOf('damaged').filter((c) => c.source === u && c.target === x()).length, casts: u.skill.activations, still: x().blockedBy === u };
  };
  for (const [id, profession] of [['t_rg', 'SNIPER'], ['t_ml', 'WARRIOR']]) {
    const r = run(id, profession);
    assert.ok(r.hits > 0, `${profession}: hits the enemy it blocks behind it`);
    assert.equal(r.casts, 1, `${profession}: and casts its skill`);
    assert.ok(r.still, `${profession}: it still holds the enemy`);
  }
});

test('#4: "melee" is the deploy position — a 领主 with a ranged attack (银灰) still hits the enemy it holds behind it', () => {
  // data position MELEE, attackKind ranged (领主 / 哨戒铁卫 / 要塞 / 钩索师 …): a melee unit for the blocked-first selector
  const id = 'chess_char_4_22_a';
  const h = makeBattle({
    defs: { enemies: { enemy_x: foe('enemy_x') } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 9, col: 6, dir: 'LEFT' }], enemies: [{ key: 'enemy_x', time: 0 }],
  });
  const u = h.unit(id);
  const x = () => h.b.enemies[0];
  assert.equal(u.def.position, 'MELEE');
  assert.equal(u.profile.attack, 'ranged', 'a ranged attack profile');
  assert.ok(h.runUntil(() => x()?.blockedBy === u, 30), 'blocks');
  assert.ok(!u.rangeKeySet.has(Math.round(x().y) * 21 + Math.round(x().x)), 'outside its range (behind it)');
  h.run(4);
  assert.ok(h.hooksOf('damaged').some((c) => c.source === u && c.target === x()), 'it hits the enemy it blocks');
});

test('#4 (revised after playtest #6): blocked-first holds for every blocker — a ranged blocker keeps shooting the enemy it blocks', () => {
  // range (9,5)–(9,7) facing RIGHT: the walker it blocks stands on (9,7); a flyer passes over the operator towards the
  // goal. Melee or ranged, the blocker keeps hitting the enemy it blocks (user's rule: the blocked enemy stands in front
  // of its blocker officially) — the ranged one no longer switches to the flyer nearer the goal.
  const run = (id, o) => {
    const h = makeBattle({
      defs: {
        chess: { [id]: chessRec({ id, rangeGrid: [[0, -1], [0, 0], [0, 1]], stats: { atk: 1, bat: 0.2, blockCnt: 1, maxHp: 1e6 }, skill: null, ...o }) },
        enemies: { enemy_x: foe('enemy_x'), enemy_fl: foe('enemy_fl', { motion: 'FLY' }) },
      },
      units: [{ chessId: id, row: 9, col: 6 }], enemies: [{ key: 'enemy_x', time: 0 }, { key: 'enemy_fl', time: 5, route: 2 }], timeLimit: 60,
      content: 'none', hooks: ['damaged'], captureNoisy: true,
    });
    const u = h.unit(id);
    const walker = () => h.b.enemies.find((e) => e.defId === 'enemy_x');
    const flyer = () => h.b.enemies.find((e) => e.defId === 'enemy_fl');
    assert.ok(h.runUntil(() => walker()?.blockedBy === u, 30), 'the walker is blocked');
    assert.ok(h.runUntil(() => flyer() && flyer().x < 4.4, 30), 'the flyer passed');
    assert.equal(walker().blockedBy, u);
    return { fl: h.hooksOf('damaged').filter((c) => c.source === u && c.target === flyer()).length, wk: h.hooksOf('damaged').filter((c) => c.source === u && c.target === walker()).length };
  };
  for (const [id, o] of [['t_rg2', { profession: 'SNIPER' }], ['t_ml2', { profession: 'WARRIOR', attackKind: 'melee', canHitFly: true }]]) {
    const r = run(id, o);
    assert.equal(r.fl, 0, `${o.profession}: kept to its blocked enemy`);
    assert.ok(r.wk > 0, `${o.profession}: hit the walker it blocks`);
  }
});

test('#4: a skywalker (起飞: blockFly) blocks flyers at the air block radius 0.8944', () => {
  const h = makeBattle({
    defs: { chess: { t_sky: chessRec({ id: 't_sky', subProfessionId: 'skywalker', stats: { atk: 0, blockCnt: 2, maxHp: 1e6 }, skill: null }) },
      enemies: { enemy_fl: foe('enemy_fl', { motion: 'FLY' }) } },
    units: [{ chessId: 't_sky', row: 9, col: 6 }], enemies: [{ key: 'enemy_fl', route: 2 }], timeLimit: 60,
  });
  const sky = h.unit('t_sky');
  const f = () => h.b.enemies[0];
  assert.ok(h.runUntil(() => f()?.blockedBy === sky, 30), 'the flyer is blocked');
  const d = Math.hypot(f().x - 6, f().y - 9);
  assert.ok(d <= BLOCK_RADIUS.fly + 1e-9 && d > BLOCK_RADIUS.ground, `at the air radius (d=${d.toFixed(3)})`);
  checkInvariants(h.b);
});

test('#4: 瑕光 S2 puts the enemy she blocks to sleep although it stands outside her tile (PRTS: 自身这格内…及自身阻挡的敌人)', () => {
  const ds = getDefaultSource();
  const id = 'chess_char_3_12_a';
  const skillIndex = ds.rawChess(id).skills.find((s) => s.skillId === 'skchr_blemsh_2').index;
  const h = makeBattle({
    // (a MANUAL 重装 skill: cast by the blocked enemy's hit — TAKE_DAMAGE)
    defs: { enemies: { enemy_x: foe('enemy_x', { atk: 100, bat: 1 }) } }, timeLimit: 60,
    units: [{ chessId: id, row: 9, col: 6, skillIndex }], enemies: [{ key: 'enemy_x', time: 0 }],
  });
  const u = h.unit(id);
  const x = () => h.b.enemies[0];
  assert.ok(h.runUntil(() => x()?.blockedBy === u, 30));
  assert.notEqual(Math.round(x().x), 6, 'the blocked enemy is on the tile in front of her');
  u.skill.gainSp(u.skill.spCost * u.skill.maxCharges + 1, 'test');
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.step();
  assert.ok(x().s.flags.sleep, 'asleep');
});
