import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';

const grid = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
for (const rule of ['DEFAULT', 'ACTIVE_RANGE', 'SKILL_RANGE', 'SP_FULL']) test(`Xi post-rebirth invincibility prevents attacks; ${rule} retains its own trigger semantics`, () => {
  const h = makeBattle({ content: 'generic', extraContent: [enemiesMod], autoFinish: false, captureNoisy: true,
    defs: { chess: { probe: chessRec({ id: 'probe', profession: 'SNIPER', projectile: 'none',
      stats: { atk: 10, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: grid,
      skill: { spCost: 2, initSp: 0, duration: 0, trigger: { rule, grid } } }) } },
    kits: { probe: () => ({ skill: { duration: 0, spCost: 2, initSp: 0, trigger: { rule, grid }, onStart() {} } }) },
    units: [{ chessId: 'probe', row: 10, col: 4 }], enemies: [{ key: 'enemy_1517_xi', pos: [10, 7], mods: { speedMul: 0 } }],
  });
  h.step(); const u = h.unit('probe'), e = h.enemy('enemy_1517_xi');
  h.b.kill(e, null); h.run(4.8);
  let arrival = null;
  h.b.addProjectile({ from: u, target: e, speed: 3, onHit: ({ battle, target }) => {
    arrival = battle.dealDamage(u, target, { type: 'true', amount: 1000 });
  } });
  h.run(0.4);
  assert.equal(e.form, 'form2'); assert.ok(e.s.flags.invulnerable);
  assert.equal(canTargetEnemy(u, e, u.profile), false);
  const attacks = u.stats.attacks, casts = u.skill.activations, hp = e.hp;
  h.run(3);
  assert.equal(u.stats.attacks, attacks);
  if (rule === 'DEFAULT' || rule === 'ACTIVE_RANGE') assert.equal(u.skill.activations, casts);
  else assert.ok(u.skill.activations > casts, 'presence-only and SP-only skills are not forcibly suppressed');
  assert.equal(arrival, 0, 'an already flying projectile still does no damage');
  assert.equal(h.b.dealDamage(u, e, { type: 'arts', amount: 1000 }), 0);
  assert.equal(h.b.dealDamage(u, e, { type: 'element', element: 'neural', amount: 1000 }), 0);
  assert.equal(e.hp, hp);
  h.run(7.2);
  assert.equal(canTargetEnemy(u, e, u.profile), true); assert.ok(u.stats.attacks > attacks);
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});
