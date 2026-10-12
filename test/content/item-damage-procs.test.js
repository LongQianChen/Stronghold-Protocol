import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { DREAD_TAG } from '../../server/sim/content/kits/ops/op-ascln.js';

for (const [item, status] of [['5_01', 'palsy'], ['5_02', 'cold']]) for (const quality of ['a', 'b']) {
  const id = `chess_item_${item}_e_${quality}`;
  test(`${id}: Ascalon poison still procs ${status} while she cannot attack`, () => {
    const h = makeBattle({ autoFinish: false, hooks: ['damaged', 'attack', 'statusApplied'], captureNoisy: true,
      units: [{ uid: 1, diy: { slot: 6, charId: 'char_4132_ascln', skillIndex: 0 }, row: 10, col: 5, items: [id] }],
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, atk: 0, speed: 0 }) } },
    });
    h.step(); const u = h.unit(1), e = h.spawn('dummy', { pos: [10, 6] });
    const rng = h.b.rng; h.b.rng = Object.assign(() => 0.999, rng);
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some(c => c.source === u && c.dmg.isAttack), 5));
    assert.equal(e.findBuff(status), null, 'the attack did not roll the item');
    const attacks = h.hooksOf('attack').length;
    h.b.addBuff(u, { key: 'test:noAttack', flags: { disarm: true }, duration: 5 });
    h.b.rng = Object.assign(() => 0, rng);
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some(c => c.dmg.tags?.includes(DREAD_TAG)), 2));
    assert.equal(h.hooksOf('attack').length, attacks, 'only the already-applied poison deals damage');
    assert.ok(e.findBuff(status), 'a real poison damage tick triggers the item');
    checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
  });

  test(`${id}: only carrier damage to enemies rolls ${status}; gauge, HP loss and bare attacks do not`, () => {
    const h = makeBattle({ autoFinish: false, defs: {
      chess: { quiet: chessRec({ id: 'quiet', stats: { atk: 0 }, skill: null }) },
      enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, atk: 0, speed: 0 }) },
    }, units: [{ uid: 1, chessId: 'quiet', row: 10, col: 3, items: [id] }, { uid: 2, chessId: 'quiet', row: 10, col: 4 }] });
    h.step(); const u = h.unit(1), ally = h.unit(2), e = h.spawn('dummy', { pos: [10, 8] });
    h.b.rng = Object.assign(() => 0, h.b.rng);
    h.b.emit('attack', { attacker: u, targets: [e] });
    h.b.dealDamage(u, e, { amount: 1, type: 'element', element: 'erosion' });
    h.b.loseHp(e, 1, { source: u });
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    h.b.dealDamage(ally, e, { amount: 1, type: 'true' });
    h.b.dealDamage(u, ally, { amount: 1, type: 'true' });
    h.b.dealDamage(u, e, { amount: 0, type: 'true' });
    assert.equal(e.findBuff(status), null); assert.equal(ally.findBuff(status), null);
    h.b.dealDamage(u, e, { amount: 1, type: 'arts', canDodge: false, tags: ['skill', 'dot'] });
    assert.ok(e.findBuff(status));
    checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
  });
}
