// User playtest #6, workstream WF (combat rules) — reports #17, #14, #18.
//
// #17 "两个干员之间卡了敌人，靠后的干员死亡之后敌人确实会被靠前的干员阻挡了，但是只有敌人攻击干员，靠前的干员不会攻击那个敌人":
//     PRTS 选择器 "可以选择且优先选择阻挡单位" — and the user's rule after playtest #6, "阻挡了就一定要能打到", where the
//     enemy stands: EVERY blocker — a ranged operator on a melee tile included
//     (the playtest #5 QA had made that melee-only, PRTS 索敌的概念 "阻挡（近战限定）") — attacks the enemies it blocks, in
//     range or not, whatever its facing, and takes them first. The real sim does for every blocking chess of the pool in
//     a plain block and in the user's layout, whether the take-over happens at once or once the enemy slid behind the
//     front operator's tile (the regressions below); only healers and 停止攻击 skills never hit it.
//     Fixed on the way: 流形's melee copy (data position ALL) ignored the enemy it held outside its range; heavy slows
//     (沼泽 −50 + 寒霜 −50) took ASPD down to 10 (interval 10 × BAT) — officially ASPD never drops below 20 (PRTS 数值范围
//     ATTACK_SPEED 默认下限 20; 游戏数据基础 "攻击速度属性实际被限制了下限为20"), so it attacks every 5 × BAT.
// #14 "敌人的重量以及可以推动敌人的干员技能的力度…感觉野鬃干员开技能能把推动好多敌人": official 位移 = 力度 − 重量 (PRTS 游戏数据基础
//     §重量公式, 推与拉): a 中力 push moves weight 0 / 1 / 2 / 3 enemies 2.14 / 1.7 / 0.44 / 0.12 tiles and heavier ones not at
//     all; the remake pushed 1 tile scaled by 25 % per missing level, so weight 3–5 enemies still flew 0.75–0.25 tiles.
// #18 "炎祐错误的吃到了医疗干员造成的治疗": PRTS “炎佑” 天赋 "{{特殊机制|我方单位}}，{{异常效果|孤立}}" — 孤立 = "无法被同阵营选中"
//     (PRTS 异常效果 ALLY_TARGET_FREE); summons holding 禁疗 (HEAL_FREE) are never healed either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { effectiveProfile } from '../../server/sim/ai.js';
import { PUSH_TILES, PUSH_TILES_EFFECT, PULL_STOP_RADIUS, ASPD_MIN, COLS } from '../../server/sim/constants.js';
import { alliesInGridOf } from '../../server/sim/content/kits/shared/tier1.js';
import { Unit } from '../../server/sim/units.js';
import { spawnYanyou, TOKEN_IDS } from '../../server/sim/content/tokens.js';

const REAL = { skip: !hasGeneratedData() };
const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);

// =====================================================================================================================
// #17 — the enemy held between two operators

const REAR = 'test_rear_a';
const foe = (key, o = {}) => enemyRec({ key, hp: 1e8, speed: 1, atk: 0, ...o });

/**
 * The user's layout on act2 m01: the lane goes up column 7 from the lower gate row; the front operator F stands on
 * (10,7), the rear one R on (11,7). F's block is filled by decoys so the next enemy E walks through it and is held by R —
 * between the two. The decoys die, then R dies: F takes E over. Returns { h, F, E, hits, couldAttack } over `secs` s.
 */
function heldBetween(chessId, dir, secs = 8, { late = false } = {}) {
  const ds = getDefaultSource();
  const cap = ds.rawChess(chessId).stats.blockCnt;
  const enemies = { enemy_e: foe('enemy_e') };
  const spawns = [];
  for (let i = 0; i < cap; i++) { enemies[`enemy_x${i}`] = foe(`enemy_x${i}`); spawns.push({ key: `enemy_x${i}`, time: i * 0.6 }); }
  spawns.push({ key: 'enemy_e', time: cap * 0.6 + 0.3 });
  const h = makeBattle({
    stageId: 'act2autochess_m01', timeLimit: 200, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { [REAR]: chessRec({ id: REAR, stats: { atk: 0, blockCnt: 1, maxHp: 1e9, respawnTime: 999 }, skill: null }) }, enemies },
    units: [{ chessId, row: 10, col: 7, dir }, { chessId: REAR, row: 11, col: 7, dir }],
    enemies: spawns,
  });
  const F = h.unit(chessId), R = h.unit(REAR);
  const decoys = () => h.b.enemies.filter((e) => e.defId.startsWith('enemy_x'));
  const E = () => h.b.enemies.find((e) => e.defId === 'enemy_e');
  const held = h.runUntil(() => decoys().length === cap && decoys().every((x) => x.blockedBy === F) && E()?.blockedBy === R, 40);
  if (!held) return null; // (a summoner's own summon took a decoy: not this layout)
  const e = E();
  if (!late) {
    for (const x of decoys()) h.b.loseHp(x, 1e12);
    h.step(2);
    h.b.loseHp(R, 1e12);
  } else {
    // the rear operator dies while the front one is still full: the enemy walks on past it, and the front one frees a
    // slot once the enemy is beyond its own tile but still inside the contact radius (0.52–0.69 tile from its centre)
    h.b.loseHp(R, 1e12);
    let ok = false;
    for (let i = 0; i < 120 && e.alive; i++) {
      h.step();
      const d = Math.hypot(e.x - F.x, e.y - F.y);
      if (d > 0.52 && d < 0.69) { ok = true; break; }
    }
    if (!ok) return null;
    for (const x of decoys()) h.b.loseHp(x, 1e12);
  }
  h.step(2);
  const t0 = h.b.time;
  let couldAttack = 0, inRange = false;
  const end = t0 + secs;
  while (h.b.time < end && e.alive) {
    h.step();
    const p = effectiveProfile(F);
    if (F.canAct && !p.noAttack && !(p.noAttackUnlessSkill && !F.skill?.active) && !F.s.flags.disarm && p.dmgType !== 'heal' && e.blockedBy === F) couldAttack += 1 / 30;
    if (F.rangeKeySet?.has(Math.round(e.y) * COLS + Math.round(e.x))) inRange = true;
  }
  const hits = h.hooksOf('damaged').filter((c) => c.source === F && c.target === e && c.t > t0).length;
  return { h, F, E: e, hits, couldAttack, inRange };
}

test('#17 the user\'s case on act2 m01: the front operator takes over the enemy held between the two AND attacks it — every blocking chess, 4 directions', REAL, () => {
  // the held enemy stands ≈ 0.29 tile behind the front operator's centre, on its own tile: a melee unit may always hit
  // it (blocked-first), a ranged one on a melee tile has it in range too (its own tile) and hits it by its own order
  const ds = getDefaultSource();
  const blockers = Object.values(ds.raw.chess).filter((c) => c.stats && c.visible !== false && !c.isGolden && c.stats.blockCnt > 0);
  assert.ok(blockers.filter((c) => c.position === 'MELEE').length >= 50, 'every melee blocker of the pool');
  const branches = new Set();
  let checked = 0;
  for (const c of blockers) {
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      const r = heldBetween(c.chessId, dir);
      if (!r) continue;
      checked++;
      branches.add(c.subProfessionId);
      if (r.E.alive && r.E.blockedBy !== r.F) {
        // only a status that cannot be blocked (妮芙's 恐惧, 浮空 …) or a displacement out of contact lets it go
        const f = r.E.s.flags;
        assert.ok(f.fear || f.unblockable || f.levitate || f.attract || Math.hypot(r.E.x - r.F.x, r.E.y - r.F.y) > 0.7071, `${c.name} ${dir}: takes the enemy over`);
        continue;
      }
      // healers, and skills that say 停止攻击 (泡泡 “挨打”, 凯瑟琳 战火淬炼 …) / attack only while active (阵法术师), are the
      // only reasons not to hit it
      if (r.couldAttack >= 2) assert.ok(r.hits > 0, `${c.name} (${c.subProfessionId}, ${c.position}) ${dir}: attacks the enemy it took over (could attack ${r.couldAttack.toFixed(1)} s)`);
    }
  }
  assert.ok(checked >= 350, `layouts checked: ${checked}`);
  assert.ok(branches.size >= 45, `branches: ${branches.size}`);
});

test('#17 a late take-over (the enemy slid behind the front operator\'s tile): every blocker hits it, ranged ones on melee tiles included (the user\'s rule)', REAL, () => {
  // the rear operator dies while the front one is full; the front one frees a slot when the enemy is 0.52–0.69 tile past
  // its centre (outside its tile, inside the 0.7071 contact radius) and takes it over. Every blocking chess of the pool,
  // the hidden ones too (见行者, 崖心, 百炼嘉维尔), × 4 directions
  const ds = getDefaultSource();
  const blockers = Object.values(ds.raw.chess).filter((c) => c.stats && !c.isGolden && c.stats.blockCnt > 0 && (c.visible !== false || c.isHidden));
  assert.ok(blockers.some((c) => c.isHidden && c.position === 'MELEE'), 'hidden melee chess included');
  let melee = 0, ranged = 0, rangedOut = 0;
  const branches = new Set();
  for (const c of blockers) {
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      const r = heldBetween(c.chessId, dir, 8, { late: true });
      if (!r || r.couldAttack < 2) continue; // (no take-over, or a 停止攻击 skill / healer: never attacks)
      branches.add(c.subProfessionId);
      if (c.position === 'MELEE') melee++; else { ranged++; if (!r.inRange) rangedOut++; }
      assert.ok(r.hits > 0, `${c.name} (${c.subProfessionId}, ${c.position}) ${dir}: hits the enemy it took over behind its tile${r.inRange ? '' : ', out of its range'} (could attack ${r.couldAttack.toFixed(1)} s)`);
    }
  }
  assert.ok(melee >= 150, `melee take-overs checked: ${melee}`);
  assert.ok(ranged >= 10 && rangedOut >= 10, `ranged take-overs checked: ${ranged} (${rangedOut} out of range)`);
  assert.ok(branches.size >= 40, `branches: ${branches.size}`);
});

/**
 * A plain block on act2 m01: the blocker alone on (10,7) facing `dir`, one walker coming up the lane. Returns
 * { F, E, hits, couldAttack, inRange } over `secs` s once it blocks, or null (a summon of its own took the walker).
 */
function plainBlock(chessId, dir, secs = 8) {
  const h = makeBattle({
    stageId: 'act2autochess_m01', timeLimit: 200, hooks: ['damaged'], captureNoisy: true,
    defs: { enemies: { enemy_e: foe('enemy_e') } },
    units: [{ chessId, row: 10, col: 7, dir }],
    enemies: [{ key: 'enemy_e', time: 0.3 }],
  });
  const F = h.unit(chessId);
  const E = () => h.b.enemies.find((e) => e.defId === 'enemy_e');
  if (!h.runUntil(() => E()?.blockedBy === F, 40)) return null;
  const e = E();
  const t0 = h.b.time;
  let couldAttack = 0, inRange = true;
  while (h.b.time < t0 + secs && e.alive) {
    h.step();
    const p = effectiveProfile(F);
    if (F.canAct && !p.noAttack && !(p.noAttackUnlessSkill && !F.skill?.active) && !F.s.flags.disarm && p.dmgType !== 'heal' && e.blockedBy === F) couldAttack += 1 / 30;
    if (!F.rangeKeySet?.has(Math.round(e.y) * COLS + Math.round(e.x))) inRange = false;
  }
  const hits = h.hooksOf('damaged').filter((c) => c.source === F && c.target === e && c.t > t0).length;
  return { F, E: e, hits, couldAttack, inRange };
}

test('#17 a plain block, every blocking chess × 4 facings: the blocker damages the enemy it blocks — in range or not (the user\'s rule)', REAL, () => {
  // "阻挡了就一定要能打到" (user, after playtest #6): melee and ranged blockers alike, whichever way they face; healers and
  // skills that stop attacking (泡泡 “挨打”, 凯瑟琳 战火淬炼 … — couldAttack) are the only exceptions
  const ds = getDefaultSource();
  const blockers = Object.values(ds.raw.chess).filter((c) => c.stats && !c.isGolden && c.stats.blockCnt > 0 && (c.visible !== false || c.isHidden));
  let checked = 0, out = 0, ranged = 0;
  for (const c of blockers) {
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      const r = plainBlock(c.chessId, dir);
      if (!r || r.couldAttack < 2) continue;
      checked++;
      if (!r.inRange) out++;
      if (c.position !== 'MELEE') ranged++;
      assert.ok(r.hits > 0, `${c.name} (${c.subProfessionId}, ${c.position}) ${dir}: hits the enemy it blocks${r.inRange ? '' : ' (out of its range)'} — could attack ${r.couldAttack.toFixed(1)} s`);
    }
  }
  assert.ok(checked >= 350, `blocks checked: ${checked}`);
  assert.ok(out >= 50, `blocked enemies outside the blocker's range at some point: ${out}`);
  assert.ok(ranged >= 20, `ranged blockers: ${ranged}`);
});

test('#17 skills that pick their own targets keep the enemy the operator blocks (QA residual): 迷迭香 S3, 荒芜拉普兰德 S2, 佩佩 S2', REAL, () => {
  // the flat stage: the blocker on (9,6) faces LEFT, so the walker it stops coming from the gate (its right) stays outside
  // its range while a still enemy on (9,4) stands inside it. These skills chose from the range only and never hit the
  // blocked one again; 普罗旺斯 S2 keeps its official text ("普通攻击不再以生命值高于80%的敌人作为目标") — the exception
  const ds = getDefaultSource();
  const cases = [['迷迭香', 'skchr_rosmon_3', true], ['荒芜拉普兰德', 'skchr_whitw2_2', true], ['佩佩', 'skchr_pepe_2', true], ['普罗旺斯', 'skchr_prove_2', false]];
  for (const [name, skillId, hitsIt] of cases) {
    for (const gold of [false, true]) {
      const c = Object.values(ds.raw.chess).find((x) => x.name === name && !!x.isGolden === gold);
      const skillIndex = c.skills.findIndex((s) => s.skillId === skillId);
      assert.ok(skillIndex >= 0, `${name} ${skillId}`);
      const h = makeBattle({
        timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
        defs: { enemies: { enemy_e: foe('enemy_e'), enemy_o: foe('enemy_o', { speed: 0 }) } },
        units: [{ chessId: c.chessId, row: 9, col: 6, dir: 'LEFT', skillIndex }],
        enemies: [{ key: 'enemy_e', time: 0.2 }, { key: 'enemy_o', time: 0.1, route: { motion: 'WALK', start: [9, 4], end: [9, 2], checkpoints: [] } }],
      });
      const F = h.unit(c.chessId);
      const E = () => h.b.enemies.find((x) => x.defId === 'enemy_e');
      assert.ok(h.runUntil(() => E()?.blockedBy === F, 40), `${name}: blocks the walker`);
      const e = E();
      h.step(30);
      if (!F.skill.active) F.skill.activate('manual', { free: true });
      assert.ok(F.skill.active && F.skill.id === skillId, `${name}: ${skillId} on`);
      const t0 = h.b.time;
      let outside = true;
      while (h.b.time < t0 + 6) {
        h.step();
        if (F.rangeKeySet?.has(Math.round(e.y) * COLS + Math.round(e.x))) outside = false;
      }
      assert.ok(outside, `${name}: the blocked walker stays outside the range`);
      const hits = h.hooksOf('damaged').filter((x) => x.t > t0 && x.source === F && x.target === e).length;
      if (hitsIt) assert.ok(hits > 0, `${name}${gold ? ' (golden)' : ''} ${skillId}: hits the enemy it blocks (${hits})`);
      else assert.equal(hits, 0, `${name} ${skillId}: official — no normal attack on an enemy above 80 % HP, blocked or not`);
      checkInvariants(h.b);
    }
  }
});

test('#17 流形\'s melee copy (a summon of no fixed position) attacks the enemy it blocks outside its range', REAL, () => {
  // 缪尔赛思's 流形 copies the melee guard; facing LEFT its copied range (its tile + the one to its left) never holds the
  // enemy it stops coming from the gate side (≈ 0.71 tile to its right)
  const guard = chessRec({ id: 'test_guard_a', profession: 'WARRIOR', position: 'MELEE', stats: { atk: 500, blockCnt: 2, maxHp: 1e6, def: 0 }, skill: null });
  const h = makeBattle({
    defs: { chess: { test_guard_a: guard }, enemies: { enemy_w: foe('enemy_w') } }, timeLimit: 120, hooks: ['damaged'], captureNoisy: true,
    units: [
      { chessId: 'chess_char_6_11_a', row: 12, col: 3 },
      { chessId: 'test_guard_a', row: 12, col: 6 },
      { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 9, col: 6, ownerUid: 1, dir: 'LEFT' },
    ],
    enemies: [{ key: 'enemy_w', time: 9 }],
  });
  const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  assert.ok(h.runUntil(() => tok()?.mem.mlyss && !tok().mem.mlyss.ranged, 9), 'a melee copy');
  const e = () => h.b.enemies.find((x) => x.defId === 'enemy_w');
  assert.ok(h.runUntil(() => e()?.blockedBy === tok(), 30), 'the copy blocks the walker');
  const t = tok();
  assert.ok(!t.rangeKeySet.has(Math.round(e().y) * 21 + Math.round(e().x)), 'outside its range (behind its facing)');
  const t0 = h.b.time;
  h.run(4);
  assert.ok(h.hooksOf('damaged').some((c) => c.source === t && c.target === e() && c.t > t0), 'it hits the enemy it blocks');
  checkInvariants(h.b);
});

test('#17 heavy slows: ASPD never drops below 20 (PRTS 数值范围) — two −50 slows on a BAT 1.2 unit give a 6 s interval, not 12 s', () => {
  assert.equal(ASPD_MIN, 20);
  const u = new Unit({ id: 1, side: 'ally', kind: 'op', base: { maxHp: 1000, atk: 100, def: 0, res: 0, aspd: 100, bat: 1.2 } });
  u.alive = true;
  u.buffs.push({ key: 'terrain:mire', stacks: 1, mods: { aspd: -50 } }, { key: 'ab:frost', stacks: 1, mods: { aspd: -50 } });
  u.markDirty();
  assert.equal(u.s.aspd, 20);
  approx(u.s.interval, 6, 1e-9, 'interval = 1.2 × 100 / 20');
  u.buffs.push({ key: 'more', stacks: 1, mods: { aspd: -300 } });
  u.markDirty();
  assert.equal(u.s.aspd, 20, 'still 20 under any slow');
});

test('#17 the user\'s case under heavy slows: the front blocker that took the enemy over hits it every 5 × BAT', () => {
  // the held enemy between two operators on act2 m01 (as above); the front one stands on 沼泽 next to a 寒霜 aura
  // (ASPD −50 each): officially it still attacks every 1.2 × 100 / 20 = 6 s — v2.4.1 swung every 12 s
  const front = chessRec({ id: 'test_front_a', profession: 'TANK', subProfessionId: 'guardian', position: 'MELEE', stats: { atk: 100, def: 0, blockCnt: 1, maxHp: 1e9, bat: 1.2 }, skill: null });
  const rear = chessRec({ id: REAR, stats: { atk: 0, blockCnt: 1, maxHp: 1e9, respawnTime: 999 }, skill: null });
  const h = makeBattle({
    stageId: 'act2autochess_m01', timeLimit: 200, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { test_front_a: front, [REAR]: rear }, enemies: { enemy_x0: foe('enemy_x0'), enemy_e: foe('enemy_e') } },
    units: [{ chessId: 'test_front_a', row: 10, col: 7 }, { chessId: REAR, row: 11, col: 7 }],
    enemies: [{ key: 'enemy_x0', time: 0 }, { key: 'enemy_e', time: 0.9 }],
  });
  const F = h.unit('test_front_a'), R = h.unit(REAR);
  const x = () => h.b.enemies.find((e) => e.defId === 'enemy_x0');
  const E = () => h.b.enemies.find((e) => e.defId === 'enemy_e');
  assert.ok(h.runUntil(() => x()?.blockedBy === F && E()?.blockedBy === R, 40), 'held between the two');
  h.b.loseHp(x(), 1e12);
  h.b.loseHp(R, 1e12);
  h.step(2);
  assert.equal(E().blockedBy, F, 'taken over');
  h.b.addBuff(F, { key: 'terrain:mire', persist: true, mods: { aspd: -50 } });
  h.b.addBuff(F, { key: 'ab:frost', persist: true, mods: { aspd: -50 } });
  assert.equal(F.s.aspd, 20);
  const t0 = h.b.time;
  h.run(30);
  const hits = h.hooksOf('damaged').filter((c) => c.source === F && c.target === E() && c.t > t0).length;
  assert.ok(hits >= 4 && hits <= 6, `≈ 30 / 6 hits in 30 s (got ${hits}; ASPD 10 would give ≤ 3)`);
});

// =====================================================================================================================
// #14 — 力度 vs 重量

const PUSH = [[-3, 0], [-2, 0.12], [-1, 0.44], [0, 1.7], [1, 2.14], [2, 2.96], [3, 3.53], [4, 3.53]];

function lane(extraEnemies = {}, units = []) {
  const enemies = {};
  for (let m = 0; m <= 10; m++) enemies[`enemy_m${m}`] = foe(`enemy_m${m}`, { speed: 0, mass: m });
  return makeBattle({ defs: { enemies: { ...enemies, ...extraEnemies } }, units, content: 'full', autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true });
}

test('#14 the official push table: 受力等级 = 力度 − 重量 (PRTS 游戏数据基础 §重量公式 / 推与拉)', () => {
  for (const [lvl, tiles] of PUSH) {
    if (lvl >= -2 && lvl <= 3) approx(PUSH_TILES[lvl], tiles, 1e-9, `table ${lvl}`);
  }
  const h = lane();
  h.step();
  for (let m = 0; m <= 6; m++) {
    for (const force of [-1, 0, 1, 2, 3]) {
      const e = h.spawn(`enemy_m${m}`, { pos: [10, 3] });
      assert.equal(h.b.forceLevel(e, force), force - m);
      const want = PUSH.find(([l]) => l === Math.max(-3, Math.min(4, force - m)))[1];
      const moved = h.b.push(e, force, { from: { x: 2, y: 10 } });
      approx(moved, want, 1e-9, `force ${force} vs weight ${m}`);
      approx(e.x, 3 + want, 1e-9, 'radial: straight away from the pusher');
      h.b.loseHp(e, 1e12);
    }
  }
  // 失重 counts (current weight); 失衡免疫 and leaders never move
  const w = h.spawn('enemy_m3', { pos: [10, 3] });
  h.b.addBuff(w, { key: 'weightless', mods: { massFlat: -1 } });
  approx(h.b.push(w, 1, { from: { x: 2, y: 10 } }), 0.44, 1e-9, '失重 weight 3 → 2');
  const f = h.spawn('enemy_m0', { pos: [11, 3] });
  h.b.addBuff(f, { key: 'noDisp', flags: { noDisplace: true } });
  assert.equal(h.b.push(f, 5, { from: { x: 2, y: 11 } }), 0, '失衡免疫');
  checkInvariants(h.b);
});

test('#14 directional pushes: > 45° off the direction or nearer than 0.25 → radial with 受力等级 −2, unless fixed (见行者 / 圣聆初雪)', () => {
  const h = lane();
  h.step();
  const from = { x: 3, y: 10 }, right = { x: 1, y: 0 };
  const a = h.spawn('enemy_m1', { pos: [10, 4] });
  approx(h.b.push(a, 1, { from, dir: right }), 1.7, 1e-9, 'straight ahead: 中力 vs 1 = 1.7 along the direction');
  approx(a.y, 10, 1e-9);
  const b = h.spawn('enemy_m1', { pos: [11, 3.5] }); // 63° off the direction
  const moved = h.b.push(b, 1, { from, dir: right });
  approx(moved, 0.12, 1e-9, 'radial, 受力等级 0 − 2 = −2');
  assert.ok(b.y > 11, 'pushed away from the pusher, not along its direction');
  const c = h.spawn('enemy_m1', { pos: [11, 3.5] });
  approx(h.b.push(c, 1, { from, dir: right, fixed: true }), 1.7, 1e-9, 'fixed: along the direction, full force');
  approx(c.y, 11, 1e-9);
  // 见行者 S2 (PRTS 备注 waives only the angle): 63° off → along the direction at full force; nearer than 0.25 → radial −2
  const d = h.spawn('enemy_m1', { pos: [12, 3.5] });
  approx(h.b.push(d, 1, { from: { x: 3, y: 11 }, dir: right, fixedAngle: true }), 1.7, 1e-9, 'fixedAngle: angle waived');
  approx(d.y, 12, 1e-9);
  const n = h.spawn('enemy_m1', { pos: [9, 3.1] });
  approx(h.b.push(n, 1, { from: { x: 3, y: 9 }, dir: right, fixedAngle: true }), 0.12, 1e-9, 'fixedAngle: < 0.25 tile still radial −2');
  const n2 = h.spawn('enemy_m1', { pos: [8, 3.1] });
  approx(h.b.push(n2, 1, { from: { x: 3, y: 8 }, dir: right, fixed: true }), 1.7, 1e-9, 'fixed (圣聆初雪): < 0.25 tile waived too');
  checkInvariants(h.b);
});

test('#14 见行者 S2 惊爆射击: angle waived, a target nearer than 0.25 tile radial −2 — and only a real wall lengthens the stun', REAL, () => {
  const id = 'chess_char_3_07_a';
  const ds = getDefaultSource();
  const bb = ds.rawChess(id).skill.bb;
  const run = (pos) => {
    const h = makeBattle({
      defs: { enemies: { enemy_t: foe('enemy_t', { speed: 0, mass: 0 }) } }, units: [{ chessId: id, row: 10, col: 3, dir: 'RIGHT', carryState: { sp: 1e3 } }],
      enemies: [{ key: 'enemy_t', pos }], autoFinish: false, timeLimit: 30, hooks: ['statusApplied'], captureNoisy: true,
    });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => h.hooksOf('statusApplied').some((c) => c.source === u && c.status === 'stun'), 6), 'cast');
    const st = h.hooksOf('statusApplied').find((c) => c.source === u && c.status === 'stun');
    return { e: h.b.enemies[0], stun: st.duration };
  };
  // straight ahead, open ground: 中力 vs weight 0 = 受力等级 1 — a 特效 push (PRTS 推与拉 names 见行者's skills 特效类):
  // 1.987 tiles along her direction, the short stun
  const a = run([10, 4]);
  approx(a.e.x, 4 + PUSH_TILES_EFFECT[1], 1e-6, 'ahead: 1.987');
  approx(a.stun, bb['forcer_s_2[hit_directly].stun'], 1e-9, 'open ground: hit_directly stun');
  // on her own tile, nearer than 0.25: radial at 受力等级 1 − 2 = −1 (0.374), still the short stun (no wall)
  const b = run([10.1, 3.1]);
  approx(Math.hypot(b.e.x - 3.1, b.e.y - 10.1), PUSH_TILES_EFFECT[-1], 1e-6, 'near: radial −2');
  approx(b.stun, bb['forcer_s_2[hit_directly].stun'], 1e-9, 'near target: not a wall');
});


test('#14 特效 pushes (PRTS 推与拉: one frame less of travel than 弹道 ones): the 特效 column, and 见行者 S1 护身射击 uses it', REAL, () => {
  const EFFECT = [[-3, 0], [-2, 0.085], [-1, 0.374], [0, 1.562], [1, 1.987], [2, 2.773], [3, 3.331], [4, 3.331]];
  const h = lane();
  h.step();
  for (let m = 0; m <= 4; m++) {
    const e = h.spawn(`enemy_m${m}`, { pos: [10, 3] });
    const want = EFFECT.find(([l]) => l === Math.max(-3, Math.min(4, 1 - m)))[1];
    approx(h.b.pushDistance(e, 1, { effect: true }), want, 1e-9, `distance: 中力 vs weight ${m}`);
    approx(h.b.push(e, 1, { from: { x: 2, y: 10 }, effect: true }), want, 1e-9, `push: 中力 vs weight ${m}`);
    h.b.loseHp(e, 1e12);
  }
  // 见行者 S1 (generic kit, 推击手 directional push on her next attack, bb.force 1) on a weight-0 enemy ahead: 1.987, not 2.14
  const id = 'chess_char_3_07_a';
  const k = makeBattle({
    defs: { enemies: { enemy_t: foe('enemy_t', { speed: 0, mass: 0 }) } }, units: [{ chessId: id, row: 10, col: 3, dir: 'RIGHT', skillIndex: 0, carryState: { sp: 1e3 } }],
    enemies: [{ key: 'enemy_t', pos: [10, 4] }], autoFinish: false, timeLimit: 30,
  });
  const u = k.unit(id);
  assert.equal(u.skill.id, 'skchr_forcer_1');
  k.step();
  const e = k.b.enemies[0];
  assert.ok(e && k.runUntil(() => e.x > 4.01, 6), 'pushed');
  k.step(2);
  approx(e.x, 4 + PUSH_TILES_EFFECT[1], 1e-6, '特效 column');
});

test('#14 锏 S3 归于宁静 slashes air units and pulls a non-static one (PRTS 备注 "※可对空。不会拖拽自身中心半径0.6708范围内的敌人")', REAL, () => {
  // a synthetic dynamic flyer: the air units of the mode are all 静态刚体 — hit, never moved (test/sim/feedback1b-displacement.test.js)
  const id = 'chess_char_6_19_a';
  const h = makeBattle({
    defs: { enemies: { enemy_fly: foe('enemy_fly', { speed: 0, mass: 0, motion: 'FLY' }), enemy_near: foe('enemy_near', { speed: 0, mass: 0 }) } },
    units: [{ chessId: id, row: 10, col: 4, dir: 'RIGHT' }], enemies: [{ key: 'enemy_fly', pos: [10, 6] }, { key: 'enemy_near', pos: [10, 4.5] }],
    autoFinish: false, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
  });
  h.step();
  const u = h.unit(id);
  assert.equal(u.skill.id, 'skchr_blkkgt_3');
  const fly = h.b.enemies.find((x) => x.defId === 'enemy_fly'), near = h.b.enemies.find((x) => x.defId === 'enemy_near');
  assert.ok(fly.isFlying);
  assert.ok(u.skill.activate('test', { free: true }), 'S3 on');
  h.run(4.5);
  const slashes = h.hooksOf('damaged').filter((c) => c.source === u && c.target === fly && c.dmg?.isSkill).length;
  assert.ok(slashes >= 10, `the flyer is slashed (${slashes} skill hits)`);
  // 中力 pull vs weight 0 (受力等级 1): all the way, to the 急停 radius around her centre
  approx(Math.hypot(fly.x - u.x, fly.y - u.y), PULL_STOP_RADIUS, 1e-6, 'pulled in to 0.6708 from her centre');
  approx(near.x, 4.5, 1e-9, 'an enemy inside the 0.6708 radius is not pulled');
});

test('#14 pulls: 受力等级 ≥ 0 all the way to the 急停 radius, −1 → 35 % of the way, −2 → 0.03, ≤ −3 → nothing; the puller\'s own blocked enemy stays', () => {
  const guard = chessRec({ id: 'test_puller_a', stats: { atk: 0, blockCnt: 0, maxHp: 1e6 }, skill: null });
  const h = makeBattle({ defs: { chess: { test_puller_a: guard }, enemies: Object.fromEntries([0, 1, 2, 3, 4].map((m) => [`enemy_m${m}`, foe(`enemy_m${m}`, { speed: 0, mass: m })])) },
    units: [{ chessId: 'test_puller_a', row: 10, col: 3 }], content: 'none', autoFinish: false, timeLimit: 60 });
  h.step();
  const u = h.unit('test_puller_a');
  const start = 7;
  const expect = { 0: start - 3 - PULL_STOP_RADIUS, 1: start - 3 - PULL_STOP_RADIUS, 2: 0.35 * (start - 3.5), 3: 0.03, 4: 0 };
  for (const m of [0, 1, 2, 3, 4]) {
    const e = h.spawn(`enemy_m${m}`, { pos: [10, start] });
    approx(h.b.pullToFront(e, u, 1), expect[m], 1e-6, `中力 vs weight ${m}`);
    h.b.loseHp(e, 1e12);
  }
  const g = h.spawn('enemy_m0', { pos: [10, 3.7] });
  g.blockedBy = u; u.blocking.push(g);
  assert.equal(h.b.pullToFront(g, u, 3), 0, 'already held in front of it');
  assert.equal(g.blockedBy, u);
});

test('#14 流形 S3 pulse: the enemy a melee copy blocks is not pulled (so not released) and is stunned at every pulse', REAL, () => {
  const guard = chessRec({ id: 'test_guard_a', profession: 'WARRIOR', position: 'MELEE', stats: { atk: 500, blockCnt: 2, maxHp: 1e6, def: 0 }, skill: null });
  for (const mass of [0, 2]) {
    const h = makeBattle({
      defs: { chess: { test_guard_a: guard }, enemies: { enemy_w: foe('enemy_w', { mass }) } }, timeLimit: 120, captureNoisy: true,
      units: [
        { chessId: 'chess_char_6_11_a', row: 12, col: 3, skillIndex: 2 },
        { chessId: 'test_guard_a', row: 12, col: 6 },
        { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 9, col: 6, ownerUid: 1, dir: 'LEFT' },
      ],
      enemies: [{ key: 'enemy_w', time: 9 }],
    });
    const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(h.runUntil(() => tok()?.mem.mlyss && !tok().mem.mlyss.ranged, 9), 'a melee copy');
    const E = () => h.b.enemies.find((x) => x.defId === 'enemy_w');
    assert.ok(h.runUntil(() => E()?.blockedBy === tok(), 30), 'blocked by the copy');
    const u = h.unit('chess_char_6_11_a');
    assert.equal(u.skill.id, 'skchr_mlyss_3');
    assert.ok(u.skill.activate('test', { free: true }), 'S3 on');
    const e = E(), x0 = e.x, y0 = e.y;
    let stunned = 0, released = 0;
    for (let i = 0; i < 30 * 6; i++) { h.step(); if (e.s.flags.stun) stunned++; if (e.blockedBy !== tok()) released++; }
    assert.equal(released, 0, `weight ${mass}: stays blocked`);
    assert.equal(stunned, 180, `weight ${mass}: stunned through every pulse`);
    approx(Math.hypot(e.x - x0, e.y - y0), 0, 1e-9, 'not pulled');
  }
});

test('#14 the user\'s case: 野鬃 S2 夹枪冲锋 pushes by 力度 − 重量 — light enemies far, weight ≥ 4 not at all', REAL, () => {
  const ds = getDefaultSource();
  const id = 'chess_char_1_19_a';
  assert.equal(ds.rawChess(id).skill.bb['attack@force'], 1, 'data: 中等力度 = 1');
  // the displacement of her first skill hit: the enemy's position before the attack and right after it (the melee hit and
  // its push resolve inside the attack)
  const moved = (mass) => {
    const pushes = [];
    const h = makeBattle({
      defs: { enemies: { enemy_t: foe('enemy_t', { speed: 0, mass }) } }, units: [{ chessId: id, row: 10, col: 3, carryState: { sp: 1e3 } }],
      enemies: [{ key: 'enemy_t', pos: [10, 4] }], autoFinish: false, timeLimit: 30, hooks: [],
      setup(b) {
        let x0 = null;
        b.on('beforeAttack', (c) => { if (c.attacker.defId === id && c.isSkill) x0 = c.targets[0]?.x ?? null; }, { priority: -2000 });
        b.on('attack', (c) => { if (c.attacker.defId === id && c.isSkill && x0 != null) { pushes.push(c.targets[0].x - x0); x0 = null; } }, { priority: -2000 });
      },
    });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => pushes.length > 0, 5), 'a skill hit');
    assert.ok(u.skill.active);
    return pushes[0];
  };
  const want = { 0: 2.14, 1: 1.7, 2: 0.44, 3: 0.12, 4: 0, 5: 0, 6: 0 };
  for (const [m, d] of Object.entries(want)) {
    const got = moved(Number(m));
    approx(got, d, 1e-6, `weight ${m}`);
  }
});

// =====================================================================================================================
// #18 — 炎佑 (孤立) and the 禁疗 summons are never healed

const medic = (o = {}) => chessRec({
  id: 'test_medic_a', profession: 'MEDIC', subProfessionId: 'physician', position: 'RANGED', dmgType: 'heal',
  rangeGrid: [...Array(9)].flatMap((_, r) => [...Array(21)].map((__, c) => [r - 4, c - 10])), stats: { atk: 400, maxHp: 1e6, blockCnt: 1, bat: 0.5 }, skill: null, ...o,
});

test('#18 炎佑 holds 孤立 (PRTS “炎佑” 天赋): medics never heal it, auras never pick it — while they heal an injured operator', REAL, () => {
  const ds = getDefaultSource();
  assert.deepEqual(ds.rawToken(TOKEN_IDS.yanyou).abnormal, ['isolated'], 'data: tokens.json abnormal');
  const h = makeBattle({ defs: { chess: { test_medic_a: medic(), test_hurt_a: chessRec({ id: 'test_hurt_a', stats: { atk: 0, maxHp: 1e5 }, skill: null }) } },
    units: [{ chessId: 'test_medic_a', row: 10, col: 5 }, { chessId: 'test_hurt_a', row: 12, col: 3 }], autoFinish: false, timeLimit: 60, hooks: ['heal'], captureNoisy: true });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 0, hp: 5000 });
  const m = h.unit('test_medic_a'), op = h.unit('test_hurt_a');
  assert.ok(y.s.flags.isolated && y.s.flags.noHeal, '孤立 flags');
  y.hp = y.s.maxHp * 0.3;
  op.hp = op.s.maxHp * 0.6;
  assert.ok(!h.b.alliesInGrid(m).includes(y), 'no ally selection picks it');
  assert.equal(h.b.heal(m, y, 1000), 0, 'the heal pipeline refuses it');
  h.run(5);
  approx(y.hp, y.s.maxHp * 0.3, 1e-6, '炎佑 not healed');
  assert.ok(op.hp > op.s.maxHp * 0.6, 'the injured operator is');
  assert.ok(!h.hooksOf('heal').some((c) => c.target === y), 'no heal event on 炎佑');
  checkInvariants(h.b);
});

test('#18 the summons that hold 禁疗 (PRTS summon pages) are not healed by others: data list + 狼群 next to a medic', REAL, () => {
  const ds = getDefaultSource();
  const healFree = ['token_10015_dusk_drgn', 'token_10019_nearl2_sword', 'token_10017_skadi2_dedant', 'token_10011_beewax_oblisk',
    'token_10030_mlyss_wtrman', 'token_10028_vigil_wolf', 'token_10012_rosmon_shield', 'token_10040_siege2_vlion', 'token_10058_sbell2_icetgt'];
  for (const id of healFree) assert.deepEqual(ds.rawToken(id).abnormal, ['healFree'], id);
  assert.deepEqual(ds.rawToken('token_10039_ulpia_block').abnormal, ['isolated']);
  for (const id of ['token_10000_silent_healrb', 'token_10006_vodfox_doll', 'token_10022_kazema_shadow', 'char_605_cmedic']) assert.deepEqual(ds.rawToken(id).abnormal, [], id);
  const h = makeBattle({ defs: { chess: { test_medic_a: medic() } },
    units: [{ chessId: 'chess_char_3_19_a', row: 12, col: 3 }, { chessId: 'test_medic_a', row: 11, col: 3 }, { kind: 'token', tokenId: 'token_10028_vigil_wolf', row: 10, col: 5, ownerUid: 1 }],
    autoFinish: false, timeLimit: 60, hooks: ['heal'], captureNoisy: true });
  h.step();
  const w = h.b.allyUnits.find((x) => x.defId === 'token_10028_vigil_wolf' && x.alive);
  assert.ok(w && w.s.flags.noHeal, '禁疗');
  w.hp = w.s.maxHp * 0.5;
  h.run(4);
  approx(w.hp, w.s.maxHp * 0.5, 1e-6, '狼群 not healed');
  assert.ok(!h.hooksOf('heal').some((c) => c.target === w && c.source !== w));
});

test('#18 圣聆初雪\'s 保护目标（冻结状态） holds 禁疗 (PRTS 备注 "持有禁疗、无法撤退"): a medic next to it does not heal it', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_medic_a: medic() } },
    units: [{ chessId: 'chess_char_6_02_a', row: 12, col: 3 }, { chessId: 'test_medic_a', row: 11, col: 3 }],
    autoFinish: false, timeLimit: 60, hooks: ['heal'], captureNoisy: true });
  h.step();
  const ice = h.b.spawnToken(h.unit('chess_char_6_02_a'), 'token_10058_sbell2_icetgt', 10, 5);
  assert.ok(ice && ice.alive && ice.s.flags.noHeal, '禁疗');
  ice.hp = ice.s.maxHp * 0.5;
  h.run(4);
  approx(ice.hp, ice.s.maxHp * 0.5, 1e-6, 'not healed');
  assert.ok(!h.hooksOf('heal').some((c) => c.target === ice && c.source !== ice));
});

test('#18 安洁莉娜 兼职工作 is an HP-regen attribute (PRTS 备注 "不受治疗加成和禁疗影响"): the 禁疗 狼群 gets it; 炎佑 (孤立) is never selected', REAL, () => {
  const h = makeBattle({
    units: [{ chessId: 'chess_char_3_19_a', row: 12, col: 3 }, { chessId: 'chess_char_5_20_a', row: 11, col: 3, carryState: { sp: 0 } },
      { kind: 'token', tokenId: 'token_10028_vigil_wolf', row: 10, col: 5, ownerUid: 1 }],
    autoFinish: false, timeLimit: 60,
  });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 0, hp: 5000 });
  h.run(2);
  const ag = h.unit('chess_char_5_20_a');
  assert.ok(!ag.skill.active, 'skill off');
  const w = h.b.allyUnits.find((x) => x.defId === 'token_10028_vigil_wolf' && x.alive);
  assert.ok(w.s.flags.noHeal, '狼群 holds 禁疗');
  assert.equal(w.findBuff('aglina:parttime')?.mods.hpRegen, 25, '禁疗 does not stop the regen attribute (20 + the potential step)');
  assert.ok(w.s.hpRegen >= 25);
  assert.ok(!y.findBuff('aglina:parttime') && !y.findBuff('aglina:field'), '孤立: no ally talent selects 炎佑');
  assert.ok(h.unit('chess_char_3_19_a').findBuff('aglina:field'), 'the operators get 加速力场');
});

test('#18 孤立 in every ally selection: 刺玫\'s 荆藤庇荫 picks the operator in her range, not 炎佑 (higher max HP)', REAL, () => {
  const h = makeBattle({
    defs: { chess: { test_op_a: chessRec({ id: 'test_op_a', stats: { atk: 0, maxHp: 3000 }, skill: null }) } },
    units: [{ chessId: 'chess_char_1_06_a', row: 10, col: 3, dir: 'RIGHT' }, { chessId: 'test_op_a', row: 10, col: 4 }], autoFinish: false, timeLimit: 60,
  });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 0, hp: 50000 });
  const cm = h.unit('chess_char_1_06_a'), op = h.unit('test_op_a');
  assert.ok(h.b.relocate(y, 10, 5), '炎佑 inside her range');
  assert.ok(y.s.maxHp > op.s.maxHp);
  assert.deepEqual(alliesInGridOf(h.b, cm).filter((a) => a !== cm), [op], 'the range selection skips 炎佑');
  assert.ok(cm.skill.activate('test', { free: true }), 'skill on');
  assert.equal(cm.mem.protege, op, 'protégé = the operator');
  assert.ok(!y.buffs.some((b) => b.key.startsWith('vendla')), '炎佑 not taunted');
  assert.equal(h.b.allySelectable(y, cm), false);
  assert.equal(h.b.allySelectable(y, y), true, 'its own effects still reach it');
  checkInvariants(h.b);
});
