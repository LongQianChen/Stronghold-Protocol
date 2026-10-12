// test/content/op_gdglow.test.js — the 自选 operator kit of 澄闪 (char_377_gdglow, 6★ 驭械术师; kit
// server/sim/content/kits/ops/op-gdglow.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in every
// form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, FUN-X “辛劳之翼” or
// FUN-Y 梦想终将实现 at stage 1 (tier 5) / 3 (tier 6). Numbers from data/backups.json; the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_gdglow.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { BLAST_RADIUS, DRONE_TAG, BLAST_TAG } from '../../server/sim/content/kits/ops/op-gdglow.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const GD = 'char_377_gdglow';
const FORMS = BACKUPS.units[GD].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const FX = 'uniequip_002_gdglow', FY = 'uniequip_003_gdglow';
const S1 = 'skchr_gdglow_1', S2 = 'skchr_gdglow_2', S3 = 'skchr_gdglow_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const talentOf = (tier, elite, mod, i) => modOf(tier, elite ? mod : null)?.talentChanges?.find((t) => t.talentIndex === i) ?? formOf(tier, elite).talents.find((t) => t.index === i);
const traitOf = (tier, elite, mod) => (elite && mod ? modOf(tier, mod).traitOverride : formOf(tier, elite).trait);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_res: dummy('enemy_res', { res: 50 }), enemy_weak: dummy('enemy_weak', { hp: 10 }) };
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, FX, FY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** 澄闪 as uid 1 at (row, col) facing RIGHT. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 4, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'attack'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: GD, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const mine = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
const droneHits = (h, u, e = null) => mine(h, u).filter((c) => c.dmg.tags?.includes(DRONE_TAG) && (!e || c.target === e));

test('澄闪 in every 自选 form: her kit (all three skills authored), the form\'s stats + module attributes, 3-1, 驭械术师 (ranged arts, hits air, blocks 1; the trait ramp of the form — FUN-X init 0.35, FUN-Y cap 1.2), ground-targetable; S1 DEFAULT, S2 at full SP (AUTO on herself), S3 GDGLOW_SKILL_2; 精准导流 18 (FUN-Y stage 3 23)', () => {
  assert.equal(OPERATOR_KITS[GD], KITS[GD]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null, sk = form.skills[skill];
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [GD, SLOT[tier], sk.skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.aspd], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), 100 + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.sub, u.base.bat], [1, 'ranged', true, 'arts', 'funnel', 1.3], `${label(f)}: 驭械术师`);
      const tb = traitOf(tier, elite, mod).bb;
      assert.deepEqual(u.profile.funnel, { init: tb.init_atk_scale, delta: tb.delta_atk_scale, max: tb.max_atk_scale }, `${label(f)}: the trait ramp`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-1`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      assert.deepEqual([u.skill.rule, u.skill.kind], [[sk.trigger.rule, 'SP_FULL', 'GDGLOW_SKILL_2'][skill], ['duration', 'toggle', 'duration'][skill]], `${label(f)}: S${skill + 1}`);
      assert.equal(u.s.resIgnoreFlat, talentOf(tier, elite, mod, 1).bb.magic_resist_penetrate_fixed, `${label(f)}: 精准导流`);
      done(h);
    }
  }
  assert.deepEqual([skillOf(5, false, S1).trigger.rule, skillOf(5, false, S2).trigger.rule, skillOf(5, false, S2).skillType], ['DEFAULT', 'DEFAULT', 'AUTO']);
  assert.deepEqual([modOf(5, FX).attr, modOf(6, FX).attr, modOf(5, FY).attr, modOf(6, FY).attr], [{ maxHp: 90, atk: 22 }, { maxHp: 125, atk: 38 }, { atk: 30, aspd: 5 }, { atk: 45, aspd: 7 }]);
  assert.deepEqual([talentOf(6, true, FY, 1).bb.magic_resist_penetrate_fixed, talentOf(6, true, FX, 0).bb['attack@atk_scale_2'], talentOf(5, true, FX, 0).bb['attack@atk_scale_2']], [23, 3.75, 3.15]);
});

test('a 自选 pick: 澄闪 is offered at tiers 5 and 6 and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(GD));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(GD), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: GD, skillIndex: 2, uniEquipId: FY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: GD, skillIndex: 2, uniEquipId: FY } } });
});

test('her normal attack (no skill): a body hit and one drone addition — init, +delta per hit on the same target, up to the cap (FUN-X from 0.35, FUN-Y to 1.2); 精准导流 lowers the RES of both', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const e = h.spawn('enemy_res', { pos: [10, 6] });
    h.run(12);
    const hits = mine(h, u).filter((c) => c.target === e && c.dmg.isAttack);
    const drones = mine(h, u).filter((c) => c.target === e && c.dmg.tags.includes('funnel'));
    assert.ok(hits.length >= 8, `${label(f)}: ${hits.length} attacks`);
    assert.equal(drones.length, hits.length, `${label(f)}: one addition per body hit`);
    const tb = traitOf(tier, elite, mod).bb, pen = talentOf(tier, elite, mod, 1).bb.magic_resist_penetrate_fixed;
    hits.slice(0, 8).forEach((c, i) => {
      const ramp = Math.min(tb.max_atk_scale, tb.init_atk_scale + i * tb.delta_atk_scale);
      approx(c.amount, u.s.atk * (1 - (50 - pen) / 100), `${label(f)}: body attack ${i + 1}`);
      approx(drones[i].amount, c.amount * ramp, `${label(f)}: drone at ${ramp}`);
      assert.equal(drones[i].dmg.attackId, c.dmg.attackId, 'same attack action');
      assert.equal(c.type, 'arts');
    });
    done(h);
  }
});

test('S1 火花四溅 (DEFAULT: on her attack with an enemy in range): 25 s, ATK +atk, ASPD +aspd, no attack of her own; 2 drones lock her first target (in range or not afterwards) and hit it every attack interval — each its own ramp, arts 技能伤害 — and take her next first target once it falls; 缴械 stops nothing', () => {
  for (const f of [[5, false, null], [6, true, FX]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.duration, sk.bb.atk, sk.bb.attack_speed, sk.bb['attack@cnt']], [25, elite ? 0.32 : 0.26, elite ? 38 : 29, 1], label(f));
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `${label(f)}: no enemy, no cast`);
    const a = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 3), `${label(f)}: cast as she is about to attack`);
    const t0 = h.b.time;
    approx(u.s.aspd, u.base.aspd + sk.bb.attack_speed, `${label(f)}: ASPD +${sk.bb.attack_speed}`);
    h.b.applyStatus(u, 'disarm', { duration: 30, source: u, force: true });
    h.run(3);
    const hits = droneHits(h, u, a);
    assert.ok(hits.length >= 4, `${label(f)}: drone hits while 缴械 (${hits.length})`);
    assert.ok(hits.every((c) => c.dmg.isSkill && !c.dmg.isAttack && c.type === 'arts'), `${label(f)}: arts 技能伤害, no normal attack`);
    const f0 = u.profile.funnel;
    approx(hits[0].amount, u.s.atk * f0.init, `${label(f)}: the first at init`);
    approx(hits[1].amount, u.s.atk * f0.init, `${label(f)}: the second drone too`);
    approx(hits[2].amount, u.s.atk * (f0.init + f0.delta), `${label(f)}: +delta`);
    approx(hits[2].t - hits[0].t, u.s.interval, `${label(f)}: one hit per attack interval each`, 0.05);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length, 0, `${label(f)}: no attack of her own`);
    // locked: the enemy walks out of her range — still hit
    a.x = 12; a.y = 12;
    const n1 = droneHits(h, u, a).length;
    h.run(2);
    assert.ok(droneHits(h, u, a).length > n1, `${label(f)}: kept out of range`);
    // it falls: the drones take her first target
    const b = h.spawn('enemy_dummy', { pos: [11, 5] });
    h.b.kill(a, null);
    h.run(1.5);
    assert.ok(droneHits(h, u, b).length >= 2, `${label(f)}: the next first target`);
    h.runUntil(() => !u.skill.active, 25);
    approx(h.b.time - t0, 25, `${label(f)}: 25 s`, 0.01);
    assert.equal(u.mem.gdDrones, null, `${label(f)}: the drones back`);
    done(h);
  }
});

test('S2 电流翻涌 (AUTO, at full SP — no enemy needed): on for good, range 3-18, ATK +atk, 2 drones on an enemy of the 3-18 outside her 3-1', () => {
  for (const f of [[5, false, null], [6, true, FY]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.duration, sk.bb.atk, sk.bb['attack@cnt'], sk.rangeId, sk.initSp, sk.spCost], [-1, elite ? 0.45 : 0.32, 1, '3-18', 0, elite ? 70 : 75], label(f));
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    h.run(sk.spCost - 0.5);
    assert.equal(u.skill.activations, 0, `${label(f)}: not before its SP is full`);
    assert.ok(h.runUntil(() => u.skill.active, 1), `${label(f)}: on at full SP with no enemy`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `${label(f)}: 3-18`);
    // (12,4) = [2, 0]: in the 3-18, not in the 3-1
    const e = h.spawn('enemy_fly', { pos: [12, 4] });
    h.run(3);
    const hits = droneHits(h, u, e);
    assert.ok(hits.length >= 4, `${label(f)}: the drones on it (${hits.length})`);
    approx(hits[0].amount, u.s.atk * u.profile.funnel.init, `${label(f)}: ATK +${sk.bb.atk * 100} % (live ATK)`);
    h.run(200);
    assert.ok(u.skill.active, `${label(f)}: 持续时间无限`);
    done(h);
  }
});

test('S3 澄净闪耀 (GDGLOW_SKILL_2: an enemy anywhere): 30 s, no attack of her own, the whole field, ATK +atk, 3 drones, each hit 0.5 s 停顿', () => {
  for (const f of [[5, false, null], [6, true, FY]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.duration, sk.bb.atk, sk.bb['attack@cnt'], sk.bb['attack@sluggish']], [30, elite ? 0.55 : 0.4, 2, 0.5], label(f));
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `${label(f)}: no enemy, no cast`);
    const e = h.spawn('enemy_dummy', { pos: [12, 10] }); // far out of her 3-1
    assert.ok(h.runUntil(() => u.skill.active, 1), `${label(f)}: cast with an enemy anywhere`);
    const t0 = h.b.time;
    h.run(0.2);
    assert.equal(u.mem.gdDrones.length, 3, `${label(f)}: 3 drones`);
    h.run(3);
    const hits = droneHits(h, u, e);
    assert.ok(hits.length >= 6, `${label(f)}: hit across the field (${hits.length})`);
    const sl = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish' && c.target === e);
    assert.ok(sl.length >= hits.length - 1, `${label(f)}: 停顿 per hit`);
    approx(sl[0].duration, 0.5, `${label(f)}: 0.5 s`);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length, 0, `${label(f)}: 停止攻击`);
    h.runUntil(() => !u.skill.active, 30);
    approx(h.b.time - t0, 30, `${label(f)}: 30 s`, 0.01);
    done(h);
  }
});

test('T1 信标的愤怒: per drone 1.5 % × its stacks (from 1, +1 per miss, sure past 40): ~10 % of the drone attacks; the blast — atk_scale_2 × ATK arts within 1.1 of the target (air too), no ramp (FUN-X stage 3 375 %), 停顿 under S3 — sends the drone back and restarts its count; reset at a deployment', () => {
  for (const f of [[5, false, null], [6, true, FX]]) {
    const [tier, elite, mod] = f;
    const tb = talentOf(tier, elite, mod, 0).bb;
    assert.deepEqual([tb['attack@prob'], tb['attack@atk_scale_2'], tb['attack@max_stack_cnt']], [0.015, elite && mod === FX && tier === 6 ? 3.75 : 3.15, 40], label(f));
    // a sure blast: both drones past the cap
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const e = h.spawn('enemy_dummy', { pos: [10, 6] }), near = h.spawn('enemy_fly', { pos: [11, 6] }), far = h.spawn('enemy_dummy', { pos: [10, 8] });
    u.mem.gdStacks = [41, 41, 41];
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => mine(h, u).some((c) => c.dmg.tags?.includes(BLAST_TAG)), 3), `${label(f)}: blast`);
    const blast = mine(h, u).filter((c) => c.dmg.tags?.includes(BLAST_TAG));
    const hitT = new Set(blast.map((c) => c.target));
    assert.ok(hitT.has(e) && hitT.has(near) && !hitT.has(far), `${label(f)}: within ${BLAST_RADIUS} of the target (air too), not 2 tiles away`);
    for (const c of blast) {
      approx(c.amount, u.s.atk * tb['attack@atk_scale_2'], `${label(f)}: ${tb['attack@atk_scale_2'] * 100} % ATK, no ramp`);
      assert.deepEqual([c.type, c.dmg.isSkill], ['arts', true]);
    }
    assert.ok(h.hooksOf('statusApplied').some((c) => c.source === u && c.status === 'sluggish' && c.target === far) === false, 'no 停顿 outside');
    assert.ok(h.hooksOf('statusApplied').some((c) => c.source === u && c.status === 'sluggish' && c.target === near), `${label(f)}: S3's 停顿 on the blast`);
    assert.ok(u.mem.gdStacks.slice(0, 3).some((k) => k <= 2), `${label(f)}: a count restarted`);
    h.b.retreat(u);
    h.b.redeploy(u, { free: true });
    assert.deepEqual(u.mem.gdStacks, [], `${label(f)}: reset at a deployment`);
    done(h);
  }
  // the macro rate: ~10 % of the drone attacks (the pseudo-random distribution's 1 / 9.91)
  const { h, u } = field({ tier: 6, elite: true, mod: FY, skill: 1 });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.gainSp(999);
  h.run(600);
  const n = droneHits(h, u).length, b = new Set(mine(h, u).filter((c) => c.dmg.tags?.includes(BLAST_TAG)).map((c) => c.t)).size;
  assert.ok(n > 800, `${n} drone attacks`);
  assert.ok(b / n > 0.08 && b / n < 0.125, `${b} / ${n} blasts ≈ 10 %`);
  done(h);
});
