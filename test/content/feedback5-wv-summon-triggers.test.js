// test/content/feedback5-wv-summon-triggers.test.js — 0.2.0 WV #2: the owner's larger-range rule through summons (the
// owner's decision of 2026-10-06: "a skill whose effect reaches farther than the operator's own range casts when an enemy is
// inside the larger area"). A skill that acts through its owner's summons casts on an enemy inside such an area of a summon
// standing on the field, on top of its data rule (DEFAULT: an enemy in the owner's own range) — kits/shared/summoner.js
// summonTriggerArea (a content trigger range, server/sim/skills.js addTriggerRange with a `{ keys, profile }` entry):
//   * 麦哲伦 S1 高效制冷模块 — her drones' ranges (air units too: its 停顿 / 束缚 reach them);
//   * 令 S3 宁作吾 — each summon's x-5 (ground enemies only: its pulses "不可对空");
//   * 电弧 S2 环形鳞地 — 赛柯's range (ground only: its bullets reach no air unit); S3 手牵手 — 桑特拉's range (air too).
// Run: node --test test/content/feedback5-wv-summon-triggers.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { COLS } from '../../server/sim/constants.js';

const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
const MG = 'char_248_mgllan', LING = 'char_2023_ling', RADIAN = 'char_4195_radian';
const DRONE_F = 'token_10005_mgllan_drone1';
const SOUL3 = 'token_10020_ling_soul3';
const TOWER2 = 'token_10052_radian_tower2', TOWER3 = 'token_10053_radian_tower3';
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

/** `charId` as uid 1 at (9, 2) facing RIGHT (her 3-1: rows 8–10, cols 2–5) with skill `skill`; `pieces` = [[tokenId, r, c]]. */
function field(charId, skill, pieces = [], { tier = 6, elite = true } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed: 5,
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, hooks: ['skillStart', 'skillEnd', 'death'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId, skillIndex: skill, uniEquipId: null }, elite, row: 9, col: 2 },
      ...pieces.map(([tokenId, r, c], i) => ({ uid: 10 + i, kind: 'token', tokenId, ownerUid: 1, row: r, col: c, dir: 'RIGHT' }))],
  });
  h.step();
  const u = h.unit(1);
  return { h, u, ps: h.b.allyUnits.filter((a) => a.kind === 'token' && a.ownerUnit === u) };
}
/** Fill the skill and run `s` seconds; true when it was cast. */
function casts(h, u, s = 2) {
  u.skill.gainSp(999);
  h.run(s);
  return u.skill.activations > 0;
}
const outOfHerRange = (u, r, c) => !u.rangeKeySet.has(r * COLS + c);

test('#2 麦哲伦 S1: an enemy on a standing drone\'s range (air units too) casts it; none there or with the drone gone: no cast; S2 / S3 get no such area', () => {
  { // a ground enemy on 龙腾.F's x-4, far from her 3-1
    const { h, u, ps } = field(MG, 0, [[DRONE_F, 12, 9]]);
    assert.equal(u.skill.rule, 'DEFAULT');
    assert.ok(ps[0].alive && ps[0].rangeKeySet.has(12 * COLS + 10) && outOfHerRange(u, 12, 10), 'the setup');
    // (11, 13) would be held at the field edge, on the drone's tile (11, 10). Stay on the field and outside every area.
    h.spawn('enemy_dummy', { pos: [11, 6] });
    assert.ok(!casts(h, u), 'nobody in her range or a drone\'s: no cast');
    h.spawn('enemy_dummy', { pos: [12, 10] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'an enemy on the drone\'s range casts S1');
    done(h);
  }
  { // a flyer there too
    const { h, u } = field(MG, 0, [[DRONE_F, 12, 9]]);
    h.spawn('enemy_fly', { pos: [11, 10] });
    assert.ok(casts(h, u), 'a flyer on the drone\'s range');
    done(h);
  }
  { // the drone off the field: nothing
    const { h, u, ps } = field(MG, 0, [[DRONE_F, 12, 9]]);
    h.b.retreat(ps[0], { reason: 'retreat' });
    h.spawn('enemy_dummy', { pos: [12, 10] });
    assert.ok(!casts(h, u), 'no standing drone: no cast');
    done(h);
  }
  for (const skill of [1, 2]) {
    const { h, u } = field(MG, skill, []);
    assert.equal(u.skill.triggerRanges.length, 0, `S${skill + 1}`);
    done(h);
  }
});

test('#2 令 S3: a ground enemy on a standing summon\'s x-5 casts it; a flyer there, or a ground enemy off the x-5, does not; S1 / S2 get no such area', () => {
  { // 弦惊 at (12, 9): its x-5 = (12, 9) and its four side neighbours
    const { h, u, ps } = field(LING, 2, [[SOUL3, 12, 9]]);
    assert.equal(u.skill.rule, 'DEFAULT');
    assert.ok(ps[0].alive && outOfHerRange(u, 11, 9), 'the setup');
    h.spawn('enemy_fly', { pos: [11, 9] });       // on the x-5, but air
    h.spawn('enemy_dummy', { pos: [11, 10] });    // diagonal: off the x-5
    assert.ok(!casts(h, u), 'a flyer on the x-5 / a ground enemy off it: no cast');
    h.spawn('enemy_dummy', { pos: [11, 9] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'a ground enemy on the summon\'s x-5 casts S3');
    done(h);
  }
  for (const skill of [0, 1]) {
    const { h, u } = field(LING, skill, []);
    assert.equal(u.skill.triggerRanges.length, 0, `S${skill + 1}`);
    done(h);
  }
});

test('#2 电弧 S2: a ground enemy on 赛柯\'s range casts it (a flyer there does not); S3: an enemy on 桑特拉\'s range, air units too; S1 gets no such area', () => {
  { // 赛柯 at (12, 6) facing RIGHT: its 3-2 = (12, 6) … (12, 9)
    const { h, u, ps } = field(RADIAN, 1, [[TOWER2, 12, 6]]);
    assert.equal(u.skill.rule, 'DEFAULT');
    assert.ok(ps[0].alive && ps[0].rangeKeySet.has(12 * COLS + 9) && outOfHerRange(u, 12, 9), 'the setup');
    h.spawn('enemy_fly', { pos: [12, 9] });
    assert.ok(!casts(h, u), 'a flyer on 赛柯\'s range: no cast');
    h.spawn('enemy_dummy', { pos: [12, 9] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'a ground enemy on 赛柯\'s range casts S2');
    done(h);
  }
  { // 桑特拉 at (12, 6) facing RIGHT: its 3-1 = rows 11–13, cols 6–9
    const { h, u, ps } = field(RADIAN, 2, [[TOWER3, 12, 6]]);
    assert.ok(ps[0].alive && ps[0].rangeKeySet.has(12 * COLS + 9) && outOfHerRange(u, 12, 9), 'the setup');
    h.spawn('enemy_dummy', { pos: [11, 13] });   // outside every area
    assert.ok(!casts(h, u), 'nobody in an area: no cast');
    h.spawn('enemy_fly', { pos: [12, 9] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'a flyer on 桑特拉\'s range casts S3');
    done(h);
  }
  {
    const { h, u } = field(RADIAN, 0, []);
    assert.equal(u.skill.triggerRanges.length, 0, 'S1');
    done(h);
  }
});
