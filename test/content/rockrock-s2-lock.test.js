// Controlled regression inputs: real kit, seeded Battle, synthetic enemy records and authored routes.
// No live enemy movement/HP edits. These cases are distinct from the normal Match/browser route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { bodyInKeys } from '../../server/sim/body.js';
import { DRONE_TAG } from '../../server/sim/content/kits/ops/chess_char_2_10-rockr.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const route = {
  motion: 'FLY', start: [10, 6], end: [9, 2],
  steps: [{ t: 'wait', s: 3 }, { t: 'move', p: [12, 6] }, { t: 'wait', s: 8 },
    { t: 'move', p: [10, 6] }, { t: 'wait', s: 40 }, { t: 'move', p: [9, 2] }],
};
const stationary = { motion: 'FLY', start: [10, 5], end: [9, 2], steps: [{ t: 'wait', s: 90 }, { t: 'move', p: [9, 2] }] };
const setup = (id, { skillIndex = 1, moduleId, newcomer = false, staysOutside = false, fragile = false,
  outsideHp, stationaryLock = false, killer = false } = {}) => {
  const lockRoute = staysOutside ? { ...route, steps: [...route.steps.slice(0, 2), { t: 'wait', s: 90 }, { t: 'move', p: [9, 2] }] } : route;
  const h = makeBattle({ seed: 5, timeLimit: 100, autoFinish: false, captureNoisy: true,
    hooks: ['damaged', 'attack', 'skillStart', 'skillEnd'],
    defs: { enemies: {
      enemy_lock: enemyRec({ key: 'enemy_lock', hp: 1e7, speed: 1, motion: 'FLY' }),
      enemy_fragile: enemyRec({ key: 'enemy_fragile', hp: 300, speed: 1, motion: 'FLY' }),
      enemy_outside: enemyRec({ key: 'enemy_outside', hp: outsideHp, speed: 1, motion: 'FLY' }),
      enemy_killer: enemyRec({ key: 'enemy_killer', hp: 1e7, atk: 1e5, range: 4, motion: 'FLY' }),
    } },
    units: [{ chessId: id, row: 10, col: 4, skillIndex, moduleId, carryState: { sp: 999 } }],
    enemies: [{ key: fragile ? 'enemy_fragile' : outsideHp ? 'enemy_outside' : 'enemy_lock',
      route: fragile || stationaryLock ? stationary : lockRoute },
      ...(newcomer ? [{ key: 'enemy_lock', route: stationary, time: 7 }] : []),
      ...(killer ? [{ key: 'enemy_killer', route: stationary, time: 7 }] : [])],
  });
  h.step();
  return { h, u: h.unit(id), target: h.enemies()[0] };
};
const hits = (h, u, target, after) => h.hooksOf('damaged').filter(c => c.source === u && c.target === target && c.t >= after && c.amount > 0);
const drone = c => c.dmg.tags?.includes(DRONE_TAG);
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);
const done = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

for (const id of ['chess_char_2_10_a', 'chess_char_2_10_b']) {
  test(`${id} S2: damage continues after a living target leaves the body range`, () => {
    const { h, u, target } = setup(id);
    assert.ok(u.skill.active);
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    assert.ok(hits(h, u, target, 0).length > 0, 'the in-range control receives damage before leaving');
    h.run(2); // discard any projectile already in flight at the boundary
    const t = h.b.time;
    const bodyAttacks = u.stats.attacks;
    h.run(4);
    assert.ok(target.alive && u.alive && u.skill.active && !bodyInKeys(target, u.rangeKeySet));
    const outHits = hits(h, u, target, t);
    assert.ok(outHits.length > 0, 'a living out-of-range lock must still receive drone damage');
    assert.ok(outHits.every(c => drone(c) && c.type === 'arts' && c.dmg.isSkill && !c.dmg.isAttack), 'pursuit damage must be an independent arts skill drone');
    assert.equal(u.stats.attacks, bodyAttacks, 'the body cannot make attacks with no enemy in range');
    done(h);
  });

  test(`${id} S2: an in-range newcomer cannot steal a living out-of-range drone lock`, () => {
    const { h, u, target } = setup(id, { newcomer: true });
    assert.ok(h.runUntil(() => h.enemies().length === 2, 10));
    assert.ok(target.alive && !bodyInKeys(target, u.rangeKeySet));
    h.run(2);
    const t = h.b.time;
    h.run(3);
    const outHits = hits(h, u, target, t);
    assert.ok(outHits.length > 0, 'the original target keeps receiving drone damage with another target in range');
    assert.ok(outHits.every(c => drone(c) && c.dmg.isSkill && !c.dmg.isAttack), 'the body cannot attack the out-of-range lock');
    const other = h.enemies().find(e => e !== target);
    assert.equal(u.mem.rockLock, target);
    assert.equal(hits(h, u, other, t).filter(drone).length, 0, 'the drone ignores the newcomer');
    const body = hits(h, u, other, t).filter(c => c.dmg.isAttack);
    assert.ok(body.length > 0, 'the body still attacks the in-range newcomer');
    assert.ok(body.every(c => !c.dmg.isSkill && !drone(c)));
    body.forEach(c => approx(c.amount, u.s.atk * u.s.atkScaleMul));
    done(h);
  });

  test(`${id} S2: a target returning into range receives damage`, () => {
    const { h, u, target } = setup(id);
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    assert.ok(h.runUntil(() => bodyInKeys(target, u.rangeKeySet), 20));
    const t = h.b.time;
    h.run(3);
    const ds = hits(h, u, target, 0).filter(drone);
    assert.ok(ds.some(c => c.t >= t));
    assert.equal(u.mem.rockLock, target);
    ds.slice(1).forEach((c, i) => approx(c.t - ds[i].t, Math.ceil(u.s.interval * 30 - 1e-9) / 30));
    ds.slice(-3).forEach(c => approx(c.amount, u.s.atk * u.s.atkScaleMul * u.profile.funnel.max));
    done(h);
  });

  test(`${id} S2: a target killed by combat releases the lock for another in-range enemy`, () => {
    const { h, u, target } = setup(id, { fragile: true, newcomer: true });
    assert.equal(u.mem.rockLock, target);
    assert.ok(h.runUntil(() => !target.alive, 7));
    assert.ok(h.runUntil(() => h.enemies().some(e => e !== target && e.alive), 10));
    const other = h.enemies().find(e => e !== target && e.alive);
    const t = h.b.time;
    h.run(3);
    assert.ok(u.alive && u.skill.active && other.alive);
    assert.equal(u.mem.rockLock, other);
    assert.ok(hits(h, u, other, t).length > 0);
    done(h);
  });

  test(`${id} S2: the duration end clears the lock and stops out-of-range damage`, () => {
    const { h, u, target } = setup(id, { staysOutside: true });
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    assert.ok(h.runUntil(() => !u.skill.active, 45));
    assert.equal(h.hooksOf('skillEnd').find(c => c.unit === u)?.reason, 'duration');
    assert.equal(u.mem.rockLock, null);
    h.run(2);
    const t = h.b.time;
    h.run(4);
    assert.ok(target.alive && u.alive && !bodyInKeys(target, u.rangeKeySet));
    assert.equal(hits(h, u, target, t).length, 0);
    done(h);
  });

  test(`${id} S1: damage stops outside the body range`, () => {
    const { h, u, target } = setup(id, { skillIndex: 0 });
    assert.ok(u.skill.active);
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    h.run(2);
    const t = h.b.time;
    h.run(4);
    assert.equal(hits(h, u, target, t).length, 0);
    done(h);
  });

  test(`${id} S2: an out-of-range combat kill waits for a candidate and restarts the trait ramp`, () => {
    const { h, u, target } = setup(id, { outsideHp: id.endsWith('_a') ? 4000 : 5000, newcomer: true });
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    assert.ok(target.alive);
    assert.ok(h.runUntil(() => !target.alive, 10));
    assert.ok(drone(hits(h, u, target, 0).at(-1)), 'the independent drone delivers the killing blow');
    if (!h.enemies().some(e => e !== target && e.alive)) {
      h.step(); assert.equal(u.mem.rockLock, null, 'no out-of-range candidate is acquired');
    }
    assert.ok(h.runUntil(() => h.enemies().some(e => e !== target && e.alive), 10));
    const other = h.enemies().find(e => e !== target && e.alive);
    assert.ok(h.runUntil(() => hits(h, u, other, 0).some(drone), 2));
    const first = hits(h, u, other, 0).find(drone);
    approx(first.amount, u.s.atk * u.s.atkScaleMul * u.profile.funnel.init);
    assert.equal(u.mem.rockLock, other);
    done(h);
  });

  test(`${id} S2: explicit stop restores the normal multiplier and clears released state`, () => {
    const { h, u, target } = setup(id, { staysOutside: true });
    const saved = u.mem.rockDrone.mul, key = u.mem.rockDrone.key;
    assert.ok(h.runUntil(() => !bodyInKeys(target, u.rangeKeySet), 10));
    u.skill.stop();
    assert.equal(u.profile[key], saved);
    assert.equal(u.mem.rockDrone, null); assert.equal(u.mem.rockLock, null);
    h.run(2); const t = h.b.time; h.run(4);
    assert.equal(hits(h, u, target, t).length, 0);
    done(h);
  });

  test(`${id} S2: caster combat death clears the released state`, () => {
    const { h, u, target } = setup(id, { killer: true, staysOutside: true });
    assert.ok(h.runUntil(() => !u.alive, 12));
    assert.equal(u.skill.active, false); assert.equal(u.mem.rockDrone, null); assert.equal(u.mem.rockLock, null);
    h.run(2); const t = h.b.time; h.run(3);
    assert.equal(hits(h, u, target, t).length, 0);
    done(h);
  });

  test(`${id} S2: live ASPD controls drone cadence; overload uses the live trait cap`, () => {
    const { h, u } = setup(id, { stationaryLock: true });
    const f = { ...u.profile.funnel }, scales = [];
    h.b.on('damaged', c => { if (c.source === u && drone(c)) scales.push({ t: h.b.time, scale: c.amount / (u.s.atk * u.s.atkScaleMul) }); });
    h.run(4);
    h.b.addBuff(u, { key: 'test:aspd', mods: { aspd: 100 } });
    const interval = u.s.interval, t = h.b.time;
    h.run(4);
    const fast = scales.filter(c => c.t > t + 1.3);
    assert.ok(fast.length > 3);
    fast.slice(1).forEach((c, i) => approx(c.t - fast[i].t, Math.ceil(interval * 30 - 1e-9) / 30));
    h.run(15);
    approx(scales.at(-1).scale, f.max * u.def.skill.bb.scale);
    u.skill.stop();
    assert.deepEqual(u.profile.funnel, f);
    assert.ok(u.s.flags.stun, 'stopping during overload keeps the existing post-overload stun');
    done(h);
  });
}

for (const moduleId of ['none', 'uniequip_002_rockr']) {
  test(`elite S2 ${moduleId}: the resolved trait supplies initial ramp and increment`, () => {
    const { h, u, target } = setup('chess_char_2_10_b', { moduleId, stationaryLock: true });
    const f = u.profile.funnel;
    h.run(3);
    hits(h, u, target, 0).filter(drone).forEach((c, i) => approx(c.amount, u.s.atk * u.s.atkScaleMul * (f.init + i * f.delta)));
    assert.equal(f.init, moduleId === 'none' ? 0.2 : 0.35);
    done(h);
  });
}

for (const sameTarget of [false, true]) {
  test(`S2: a pre-skill projectile at ${sameTarget ? 'the same' : 'another'} target cannot change the released ramp`, () => {
    const h = makeBattle({ seed: 5, autoFinish: false, captureNoisy: true, hooks: ['damaged', 'attack'],
      defs: { enemies: { old: enemyRec({ key: 'old', hp: 1e7, speed: 0, motion: 'FLY' }),
        preferred: enemyRec({ key: 'preferred', hp: 1e7, speed: 0, motion: 'FLY', taunt: 5 }) } },
      units: [{ chessId: 'chess_char_2_10_a', row: 10, col: 4, carryState: { sp: 0 } }],
      enemies: [{ key: 'old', pos: [10, 6] }],
    });
    h.step(); // launch an ordinary shot, which has not landed yet
    const u = h.unit('chess_char_2_10_a'), old = h.enemies()[0];
    assert.equal(h.hooksOf('attack').length, 1); assert.equal(h.hooksOf('damaged').length, 0);
    const target = sameTarget ? old : h.spawn('preferred', { pos: [10, 5] });
    h.step(); // update the spatial index for the second target
    u.skill.gainSp(999); u.skill.activate('test');
    assert.equal(u.mem.rockLock, target);
    h.run(2);
    assert.ok(hits(h, u, old, 0).some(c => c.dmg.isAttack), 'the old shot really lands');
    const ds = hits(h, u, target, 0).filter(drone);
    assert.ok(ds.length >= 3);
    ds.slice(0, 3).forEach((c, i) => approx(c.amount, u.s.atk * u.s.atkScaleMul * (u.profile.funnel.init + i * u.profile.funnel.delta)));
    done(h);
  });
}

test('S2: the shared targetability filter releases an unselectable lock and acquires a legal candidate', () => {
  const { h, u, target } = setup('chess_char_2_10_a', { newcomer: true });
  assert.ok(h.runUntil(() => h.enemies().length === 2, 10));
  const other = h.enemies().find(e => e !== target);
  h.b.addBuff(target, { key: 'test:untargetable', flags: { untargetable: true } });
  h.run(2); const t = h.b.time; h.run(2);
  assert.equal(hits(h, u, target, t).length, 0);
  assert.equal(u.mem.rockLock, other);
  assert.ok(hits(h, u, other, t).some(drone));
  done(h);
});

for (const [id, moduleId] of [['chess_char_2_10_a', undefined], ['chess_char_2_10_b', 'none'], ['chess_char_2_10_b', 'uniequip_002_rockr']]) {
  test(`${id} ${moduleId ?? 'normal'}: skill data, DEFAULT trigger, range and talent remain intact`, () => {
    for (const skillIndex of [0, 1]) {
      const raw = getDefaultSource().getChess(id, { skillIndex, moduleId }).raw;
      const h = makeBattle({ seed: 5, autoFinish: false, timeLimit: 100, captureNoisy: true,
        defs: { enemies: { e: enemyRec({ key: 'e', hp: 1e7, speed: 0 }) } },
        units: [{ chessId: id, row: 10, col: 4, skillIndex, moduleId, carryState: { sp: 999 } }],
      });
      h.run(2);
      const u = h.unit(id);
      assert.equal(u.skill.active, false, 'DEFAULT waits for a target despite full SP');
      assert.deepEqual([u.skill.id, u.skill.rule, u.skill.spCost, u.skill.initSp, u.skill.duration, u.skill.spType],
        [raw.skill.skillId, raw.skill.trigger.rule, raw.skill.spCost, raw.skill.initSp, raw.skill.duration, 'time']);
      assert.deepEqual(u.liveRangeGrid, raw.rangeGrid);
      assert.deepEqual([u.profile.canHitFly, u.profile.dmgType, u.profile.attack, u.s.blockCnt], [true, 'arts', 'ranged', 1]);
      h.spawn('e', { pos: [10, 6] });
      assert.ok(h.runUntil(() => u.skill.active, 3));
      approx(u.s.aspd - u.base.aspd, raw.skill.bb.attack_speed);
      const t = raw.talents.find(v => v.index === 0).bb;
      h.runUntil(() => h.b.time >= 15.1, 20);
      approx(u.findBuff('rockr:rock').stacks, 1);
      approx(u.findBuff('rockr:rock').mods.atkPct, t.atk);
      u.skill.stop();
      assert.deepEqual(u.liveRangeGrid, raw.rangeGrid);
      h.runUntil(() => h.b.time >= t.interval * (t.max_stack_cnt + 1), 80);
      assert.equal(u.findBuff('rockr:rock').stacks, t.max_stack_cnt);
      done(h);
    }
  });
}
