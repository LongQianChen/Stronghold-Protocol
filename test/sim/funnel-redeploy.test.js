// PRTS 分支特性信息 驭械术师: changing targets or redeploying resets the drone ramp.
// Controlled battle inputs here; the real Match route is covered in test/match/funnel-redeploy.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const make = (id = 'chess_char_2_10_a', extra = []) => makeBattle({
  units: [{ chessId: id, row: 10, col: 4 }, ...extra],
  defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0 }) } },
  enemies: [{ key: 'dummy', pos: [10, 6] }], timeLimit: 300, autoFinish: false,
  hooks: ['damaged'], captureNoisy: true,
});
const hits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.target.side === 'enemy');
const steps = (h, u) => hits(h, u).filter((c) => c.dmg?.tags?.includes('funnel'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const ramp = (h, u) => {
  h.runUntil(() => steps(h, u).length >= 8, 30);
  assert.ok(steps(h, u).length >= 8);
};

for (const id of ['chess_char_2_10_a', 'chess_char_2_10_b', 'chess_char_4_03_a', 'chess_char_4_03_b']) {
  test(`${id}: same living target starts at the configured initial scale after automatic redeployment`, () => {
    const h = make(id), u = h.unit(id);
    ramp(h, u);
    const e = h.enemies()[0];
    assert.ok(u.trait.funnelScale > u.profile.funnel.init);
    const before = hits(h, u).length;
    h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
    assert.equal(u.alive, false);
    h.runUntil(() => u.alive, 100);
    assert.equal(u.alive, true);
    assert.equal(e.alive, true);
    assert.equal(u.trait.funnelTarget, null);
    near(u.trait.funnelScale, u.profile.funnel.init);
    assert.equal(h.runUntil(() => hits(h, u).length > before, 5), true);
    assert.ok(hits(h, u).length > before);
    assert.equal(hits(h, u).at(-1).target, e);
    near(u.trait.funnelScale, u.profile.funnel.init);
    checkInvariants(h.b);
    assert.deepEqual(h.b.errors, []);
  });
}

for (const id of ['chess_char_3_13_a', 'chess_char_3_13_b', 'chess_char_3_20_a', 'chess_char_3_20_b']) {
  test(`${id}: per-target funnel map restarts on redeployment`, () => {
    const h = make(id), u = h.unit(id);
    ramp(h, u);
    const e = h.enemies()[0];
    assert.ok(u.trait.funnelMap.get(e.id).s > u.profile.funnel.init);
    h.b.retreat(u);
    assert.equal(h.b.redeploy(u), true);
    assert.equal(u.trait.funnelMap.size, 0);
    const before = hits(h, u).length;
    assert.equal(h.runUntil(() => hits(h, u).length > before, 5), true);
    assert.ok(hits(h, u).length > before);
    near(u.trait.funnelMap.get(e.id).s, u.profile.funnel.init);
    checkInvariants(h.b);
  });
}

test('continuous attacks ramp and cap; changing the living target resets normally', () => {
  const h = make(), u = h.unit('chess_char_2_10_a');
  ramp(h, u);
  near(u.trait.funnelScale, u.profile.funnel.max);
  const replacement = h.spawn('dummy', { pos: [10, 5] });
  const before = hits(h, u).length;
  assert.equal(h.runUntil(() => hits(h, u).length > before, 5), true);
  assert.ok(hits(h, u).length > before);
  assert.equal(hits(h, u).at(-1).target, replacement);
  near(u.trait.funnelScale, u.profile.funnel.init);
});

test('another unit deployment and a free move keep this ramp; unrelated trait state survives redeployment', () => {
  const h = make('chess_char_2_10_a', [{ chessId: 'chess_char_1_02_a', row: 12, col: 3 }]);
  const u = h.unit('chess_char_2_10_a'), other = h.unit('chess_char_1_02_a');
  ramp(h, u);
  const scale = u.trait.funnelScale, target = u.trait.funnelTarget;
  u.trait.testUnrelated = { value: 7 }; // controlled sentinel: no production trait object may be replaced
  const sentinel = u.trait.testUnrelated;
  h.b.retreat(other);
  assert.equal(h.b.redeploy(other), true);
  assert.equal(u.trait.funnelTarget, target);
  near(u.trait.funnelScale, scale);
  assert.equal(h.b.moveRedeploy(u, 10, 3), true);
  assert.equal(u.trait.funnelTarget, target);
  near(u.trait.funnelScale, scale);
  h.b.retreat(u);
  assert.equal(h.b.redeploy(u), true);
  assert.equal(u.trait.testUnrelated, sentinel);
  near(u.trait.funnelScale, u.profile.funnel.init);
});

test('an old in-flight drone can advance the reset ramp before the first fresh drone lands', (t) => {
  for (const drainOld of [false, true]) {
    const h = make(), u = h.unit('chess_char_2_10_a');
    ramp(h, u);
    const e = h.enemies()[0], launches = new Map(), impacts = [], events = [];
    const state = () => ({ at: h.b.time, currentSeq: u.deploySeq, scale: u.trait.funnelScale, hp: e.hp });
    h.b.on('attack', (c) => {
      if (c.attacker !== u) return;
      const shot = { kind: 'launch', attackId: h.b._attackSeq, ...state() };
      launches.set(shot.attackId, shot);
      events.push(shot);
    });
    h.b.on('deploy', (c) => {
      if (c.unit === u) events.push({ kind: 'deploy', target: u.trait.funnelTarget, ...state() });
    }, { priority: -1000 });
    h.b.on('damaged', (c) => {
      if (c.source !== u || c.target !== e || !(c.dmg?.attackId > 0)) return;
      const launch = launches.get(c.dmg.attackId);
      const hit = { kind: 'impact', attackId: c.dmg.attackId, launchAt: launch?.at,
        launchSeq: launch?.currentSeq, ...state(), amount: c.amount, hpBefore: e.hp + c.amount,
        addition: !!c.dmg.tags?.includes('funnel'), isAttack: !!c.dmg.isAttack };
      impacts.push(hit);
      events.push(hit);
    });
    const volleysLanded = () => new Set(impacts.map((i) => i.attackId)).size;
    assert.equal(h.runUntil(() => launches.size === 1, 3), true);
    const oldShot = [...launches.values()][0];
    assert.equal(impacts.length, 0);
    assert.ok(h.b.projectiles.list.some((p) => p.source === u && p.target === e));
    if (drainOld) assert.equal(h.runUntil(() => volleysLanded() >= 1, 1), true);
    h.b.retreat(u);
    assert.equal(h.b.redeploy(u), true);
    const seq = u.deploySeq;
    assert.equal(h.runUntil(() => impacts.some((i) => i.launchSeq === seq), 2), true);
    t.diagnostic(JSON.stringify({ drainOld, events }));
    const deployment = events.find((i) => i.kind === 'deploy');
    assert.equal(deployment.target, null);
    near(deployment.scale, u.profile.funnel.init);
    const of = (id) => impacts.filter((i) => i.attackId === id);
    const oldParts = of(oldShot.attackId);
    const fresh = impacts.find((i) => i.launchSeq === seq);
    const freshParts = of(fresh.attackId);
    assert.equal(oldParts[0].launchSeq, oldShot.currentSeq);
    assert.notEqual(oldParts[0].launchSeq, fresh.launchSeq);
    assert.ok(oldParts.at(-1).at <= fresh.at);
    assert.equal(oldParts[0].currentSeq, drainOld ? oldShot.currentSeq : seq);
    near(oldParts[0].scale, drainOld ? u.profile.funnel.max : u.profile.funnel.init);
    near(fresh.scale, u.profile.funnel.init + (drainOld ? 0 : u.profile.funnel.delta));
    for (const parts of [oldParts, freshParts]) {
      assert.equal(parts.filter((p) => p.isAttack).length, 1);
      assert.equal(parts.filter((p) => p.addition).length, 1);
      const body = parts.find((p) => p.isAttack);
      const add = parts.find((p) => p.addition);
      near(body.amount, u.s.atk * u.s.atkScaleMul);
      near(add.amount, body.amount * body.scale);
    }
    const oldSum = oldParts.reduce((s, p) => s + p.amount, 0);
    const freshSum = freshParts.reduce((s, p) => s + p.amount, 0);
    near(oldShot.hp - oldParts.at(-1).hp, oldSum);
    near(oldParts.at(-1).hp, freshParts[0].hpBefore);
    near(freshParts[0].hpBefore - freshParts.at(-1).hp, freshSum);
    assert.ok(freshParts.at(-1).hp > 0);
    checkInvariants(h.b);
    assert.deepEqual(h.b.errors, []);
  }
});
