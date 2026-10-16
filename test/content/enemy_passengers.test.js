// 载客: 伊利昂的木驮兽 / “越长尘” (content/enemies/passengers.js, §32.14.4).
// Cases follow PR #592, plus the passenger's own route, retained HP, and same-seed unload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle } from '../helpers/battleHarness.js';
import * as enemies from '../../server/sim/content/enemies.js';

const CAMEL = 'enemy_10159_mntrjn', BUS = 'enemy_1302_ymtro_2';
const DOG = 'enemy_1000_gopro_2';
const parked = { motion: 'WALK', start: [9, 7], end: [9, 2], steps: [{ t: 'wait', s: 100 }, { t: 'move', p: [9, 2] }] };
const arena = (o = {}) => makeBattle({ content: 'generic', extraContent: [enemies], autoFinish: false, timeLimit: 600, ...o });
const spawn = (h, key, o = {}) => h.spawn(key, { pos: [9, 7], route: parked, ...o });
const seats = (e) => e.mem.ab.list.find((a) => a.passengers).passengers;

function remainingLegs(route) {
  const legs = route.legs || [];
  let i = Number.isInteger(route.legIdx) ? route.legIdx : 0;
  if (legs[i] && legs[i].t === 'wait') i++;
  return legs.slice(i).map((leg) => ({ ...leg }));
}

for (const [key, cap] of [[CAMEL, 5], [BUS, 4]]) {
  test(`${key}: carries non-machine normal and elite ground enemies, preserves them and respects capacity`, () => {
    const h = arena();
    h.step();
    const e = spawn(h, key);
    const riders = Array.from({ length: cap + 1 }, (_, i) => spawn(h, i === 0 ? 'enemy_1045_hammer' : DOG));
    h.b.dealDamage(null, riders[0], { amount: 100, type: 'true' });
    const hp = riders[0].hp;
    assert.ok(hp < riders[0].s.maxHp);
    h.step();
    assert.equal(seats(e).length, cap);
    assert.equal(riders[0].defId, 'enemy_1045_hammer');
    for (const p of riders.slice(0, cap)) {
      assert.equal(p.mem.carrier, e);
      assert.ok(p.alive && p.hidden && p.deployed);
    }
    for (const p of riders.slice(1, cap)) assert.equal(p.defId, DOG);
    assert.ok(!riders[cap].hidden);
    assert.equal(riders[cap].mem.carrier, undefined);
    const r = riders[0], idx = r.route.legIdx, wait = r.route.waitLeft;
    const attacks = r.stats.attacks;
    h.run(2);
    assert.equal(r.route.legIdx, idx);
    assert.equal(r.route.waitLeft, wait);
    assert.equal(r.x, e.x);
    assert.equal(r.y, e.y);
    assert.equal(r.hp, hp);
    assert.equal(r.stats.attacks, attacks);
    assert.ok(!h.snapshot().units.some((u) => u[0] === r.id));
    assert.equal(h.b.dealDamage(null, r, { amount: 100, type: 'true' }), 0);
    assert.equal(r.hp, hp);
  });

  test(`${key}: rejects leaders, machines, flying, hidden and out-of-radius enemies`, () => {
    const h = arena();
    h.step();
    const e = spawn(h, key);
    const excluded = [
      spawn(h, 'enemy_1001_bigbo'),
      spawn(h, key === BUS ? CAMEL : BUS),
      spawn(h, 'enemy_1005_yokai'),
      spawn(h, DOG),
      spawn(h, DOG, { pos: [9, 7.501] }),
    ];
    h.b._setHidden(excluded[3], true);
    const boundary = spawn(h, DOG, { pos: [9, 7.5] });
    h.step();
    assert.deepEqual(seats(e), [boundary]);
    for (const p of excluded) assert.equal(p.mem.carrier, undefined);
  });

  for (const status of ['stun', 'freeze', 'sleep', 'levitate', 'unbalance', 'hidden']) {
    test(`${key}: ${status} prevents pickup until it ends`, () => {
      const h = arena();
      h.step();
      const e = spawn(h, key), p = spawn(h, DOG);
      if (status === 'unbalance') e.unbalanceUntil = 100;
      else if (status === 'hidden') h.b._setHidden(e, true);
      else h.b.addBuff(e, { key: 'test:stop', flags: { [status]: true } });
      h.step();
      assert.equal(p.mem.carrier, undefined);
      e.unbalanceUntil = -Infinity;
      h.b._setHidden(e, false);
      h.b.removeBuff(e, 'test:stop');
      h.step();
      assert.equal(p.mem.carrier, e);
    });
  }

  test(`${key}: death unloads original units without a kill or bounty for passengers`, () => {
    const h = arena();
    h.step();
    const e = spawn(h, key), p = spawn(h, DOG, { bounty: { coins: 3 } });
    h.step();
    const camelLegs = key === CAMEL ? remainingLegs(e.route) : null;
    h.b.kill(e);
    assert.ok(p.alive && !p.hidden);
    assert.equal(p.mem.carrier, undefined);
    assert.equal(p.bounty && p.bounty.coins, 3);
    assert.equal(h.b.killed, 1);
    if (key === CAMEL) {
      assert.ok(Math.abs(p.x - e.x) <= 0.2 && Math.abs(p.y - e.y) <= 0.2);
      assert.notEqual(p.route.legs, e.route.legs);
      assert.deepEqual(p.route.legs, camelLegs);
    } else {
      assert.deepEqual([p.y, p.x], [Math.round(e.y), Math.round(e.x)]);
    }
    assert.notEqual(p.route.legs[0]?.t, 'wait');
    h.runToEnd(100);
    assert.ok(!p.alive, 'unloaded passenger resumes walking and exits');
  });

  test(`${key}: leaking carrier unloads passengers; each leaks once and battle clears`, () => {
    const h = arena({ autoFinish: true });
    const route = { motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] };
    const e = spawn(h, key, { route }), p = spawn(h, DOG, { route });
    h.step();
    h.b.leak(e);
    assert.ok(p.alive && !p.hidden);
    h.runToEnd(100);
    assert.equal(h.b.leakedCount, 2);
    assert.equal(h.result().reason, 'cleared');
  });

  test(`${key}: natural exit releases passengers at the goal without hidden survivors`, () => {
    const h = arena({ autoFinish: true });
    const route = { motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] };
    const e = spawn(h, key, { route }), p = spawn(h, DOG, { route });
    h.step();
    assert.equal(p.mem.carrier, e);
    h.runToEnd(100);
    assert.equal(h.b.leakedCount, 2);
    assert.equal(h.result().reason, 'cleared');
    assert.ok(!p.hidden && !p.alive);
  });

  test(`${key}: timeout counts carrier and passenger independently once`, () => {
    const h = arena({ timeLimit: 1 });
    spawn(h, key);
    const p = spawn(h, DOG);
    h.step();
    assert.ok(p.hidden);
    h.runToEnd(2);
    assert.equal(h.b.leakedCount, 2);
    assert.equal(h.result().reason, 'timeout');
  });
}

test('越长尘 unloads at the tile centre and keeps the passenger\'s own remaining route', () => {
  const h = arena();
  h.step();
  const e = spawn(h, BUS);
  const own = { motion: 'WALK', start: [9, 7.2], end: [12, 2], steps: [{ t: 'wait', s: 100 }, { t: 'move', p: [12, 2] }] };
  const p = spawn(h, DOG, { pos: [9, 7.2], route: own });
  h.step();
  assert.equal(p.mem.carrier, e);
  const expected = remainingLegs(p.route);
  h.b.kill(e);
  assert.deepEqual([p.y, p.x], [Math.round(e.y), Math.round(e.x)]);
  assert.deepEqual(p.route.legs, expected);
  assert.ok(p.route.legs.some((leg) => leg.t === 'move' && leg.r === 12 && leg.c === 2));
  assert.ok(!p.route.legs.some((leg) => leg.r === 9 && leg.c === 2));
});

test('silence does not stop pickup; a stunned passenger still boards', () => {
  const h = arena();
  h.step();
  const e = spawn(h, CAMEL);
  h.b.addBuff(e, { key: 'test:sil', flags: { silence: true } });
  const p = spawn(h, DOG);
  h.b.addBuff(p, { key: 'test:stun', flags: { stun: true } });
  h.step();
  assert.equal(p.mem.carrier, e);
  assert.ok(p.hidden);
});

test('camel speed uses additive -20% per passenger with absolute 0.1 floor, even under slow', () => {
  const h = arena();
  h.step();
  const e = spawn(h, CAMEL);
  assert.equal(e.mem.moveSpeedFloor, 0.1);
  for (let n = 1; n <= 5; n++) {
    spawn(h, DOG);
    h.step();
    assert.ok(Math.abs(e.s.moveSpeed - Math.max(0.1, 1 - 0.2 * n)) < 1e-9);
  }
  h.b.addBuff(e, { key: 'test:slow', mods: { moveMul: 0.2 } });
  assert.equal(e.s.moveSpeed, 0.1);
});

test('camel unload matches across two battles with the same seed', () => {
  const run = (seed) => {
    const h = arena({ seed });
    h.step();
    const e = spawn(h, CAMEL);
    const riders = [0, 1, 2].map(() => spawn(h, DOG));
    h.step();
    h.b.kill(e);
    return riders.map((p) => [p.x, p.y, p.route.legs]);
  };
  const a = run(11);
  const b = run(11);
  assert.deepEqual(a, b);
  assert.ok(a.every((row) => Math.abs(row[0] - 7) <= 0.2 && Math.abs(row[1] - 9) <= 0.2));
});

test('passenger bus does not call Math.random', () => {
  const src = fs.readFileSync(new URL('../../server/sim/content/enemies/passengers.js', import.meta.url), 'utf8');
  assert.equal(/\bMath\.random\s*\(/.test(src), false);
});

test('all shipped stages lack a ladder: no arbitrary tile triggers early unloading', () => {
  const stages = JSON.parse(fs.readFileSync(new URL('../../data/stages.json', import.meta.url), 'utf8'));
  const waves = fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8');
  assert.equal(waves.includes('云梯'), false);
  assert.equal(JSON.stringify(stages).includes('云梯'), false);
  for (const s of Object.values(stages)) {
    assert.ok(!(s.devices || []).some((d) => /云梯|ladder/i.test(`${d.key} ${d.name} ${d.role}`)));
  }
});
