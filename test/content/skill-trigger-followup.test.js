import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { rotateOffset } from '../../server/sim/dir.js';

const CASES = [
  ['char_1043_leizi2', 1, [0, 3]],
  ['char_1044_hsgma2', 2, [0, 2]],
  ['char_1015_aglna2', 2, [1, -1]],
];
function field(charId, skillIndex, { tier = 6, elite = true, dir = 'RIGHT', cooldown = 0 } = {}) {
  const h = makeBattle({ units: [{ uid: 1, diy: { slot: tier, charId, skillIndex }, elite, row: 10, col: 5, dir }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, atk: 0, speed: 0 }),
      flyer: enemyRec({ key: 'flyer', hp: 1e9, atk: 0, speed: 0, motion: 'FLY' }) } },
    flags: { startOpCooldown: cooldown }, autoFinish: false, timeLimit: 90 });
  h.step();
  return { h, u: h.unit(1) };
}

for (const [charId, skillIndex, delta] of CASES) {
  test(`${charId}: all DIY forms cast for a target in the actual skill area outside normal targeting`, () => {
    for (const tier of [5, 6]) for (const elite of [false, true]) for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      for (const key of ['dummy', 'flyer']) {
        const { h, u } = field(charId, skillIndex, { tier, elite, dir });
        // Leizi's terrain flood and Hoshiguma's x-2 are symmetric; Angelina's rear diagonal follows her facing.
        const [dr, dc] = charId === 'char_1015_aglna2' ? rotateOffset(...delta, dir) : delta;
        h.spawn(key, { pos: [10 + dr, 5 + dc] });
        u.skill.addCharge(1); h.step();
        assert.equal(u.skill.activations, 1, `${charId}/${tier}/${elite}/${dir}/${key}`);
        assert.equal(h.b.errors.length, 0); checkInvariants(h.b);
      }
    }
  });
  test(`${charId}: expanded auto-cast keeps targetability and operation cooldown`, () => {
    for (const flag of ['stealth', 'untargetable', 'sleep']) {
      const { h, u } = field(charId, skillIndex);
      const e = h.spawn('flyer', { pos: [10 + delta[0], 5 + delta[1]] });
      h.b.addBuff(e, { key: 'test:hidden', flags: { [flag]: true } });
      u.skill.addCharge(1); h.run(0.5);
      assert.equal(u.skill.activations, 0, flag);
      h.b.removeBuff(e, 'test:hidden'); h.step();
      assert.equal(u.skill.activations, 1, `${flag} removed`);
    }
    const { h, u } = field(charId, skillIndex, { cooldown: 3 });
    h.spawn('flyer', { pos: [10 + delta[0], 5 + delta[1]] });
    u.skill.addCharge(1); h.run(1);
    assert.equal(u.skill.activations, 0);
    h.runUntil(() => u.skill.activations > 0, 3);
    assert.equal(u.skill.activations, 1);
    assert.ok(u.skill.lastStart >= 3);
  });
}

test('Leizi S2 uses low-terrain reachability and permanent range extension, without changing ordinary range', () => {
  for (const extended of [false, true]) {
    const { h, u } = field('char_1043_leizi2', 1);
    if (extended) h.b.addBuff(u, { key: 'test:range', mods: { rangeExtend: 1 }, persist: true });
    h.spawn('flyer', { pos: [10, 9] }); u.skill.addCharge(1); h.step();
    assert.equal(u.skill.activations, extended ? 1 : 0);
  }
});
