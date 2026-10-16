// Round 40 — an attack that has started finishes (PRTS 作战机制: the shot keeps its target; a locked swing still
// hits when the wind-up ends). Operators have no multi-tick wind-up: the target they had before enemies move on
// the tick the cooldown reaches 0 is the one the projectile chases. An enemy swing locks its targets; leaving
// range does not cancel it. Stun still does (feedback5-enemy-swing.test.js).
// Run: node --test test/sim/round40-attack-commit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { roundHalfEven } from '../../server/sim/detmath.js';
import { TICK, MOVE_SCALE } from '../../server/sim/constants.js';

const Y6 = [[2, 0], [2, 1], [1, -1], [1, 0], [1, 1], [1, 2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, 0], [-2, 1]];

function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
}

test('an operator whose target leaves the range grid on the tick the attack comes off cooldown still fires, and the shot lands', () => {
  const sn = chessRec({
    id: 'sn', profession: 'SNIPER', skill: null, rangeGrid: Y6,
    stats: { atk: 100, bat: 2.5, def: 0, blockCnt: 0 },
  });
  const step = 2 * MOVE_SCALE * TICK;
  const h = makeBattle({
    autoFinish: false, timeLimit: 20,
    defs: {
      chess: { sn },
      enemies: { walker: enemyRec({ key: 'walker', hp: 1e6, atk: 0, speed: 2, def: 0 }) },
    },
    units: [{ uid: 1, chessId: 'sn', row: 10, col: 5, dir: 'RIGHT' }],
    // 7.59: its 0.1 collider still overlaps column 7 (the range's last tile); one step later it has left it (0.3.0)
    enemies: [{ key: 'walker', route: { motion: 'WALK', start: [10, 7.59 - step], end: [10, 16], checkpoints: [] } }],
  });
  h.step();
  const u = h.unit(1), e = h.b.enemies[0];
  assert.equal(roundHalfEven(e.x), 8, 'the centre is past column 7, the collider not yet');
  assert.ok(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).includes(e), 'in range before the leaving step');
  const attacks = u.stats.attacks;
  u.atkCd = h.b.dt;
  h.step();
  assert.ok(e.x - 0.1 > 7.5, 'the collider has left the tile the range covered');
  assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).includes(e), false);
  assert.equal(u.stats.attacks, attacks + 1, 'the committed attack fired');
  const hp = e.hp;
  assert.ok(h.runUntil(() => e.hp <= hp - 200, 3), 'both shots, including the one that chased, land');
  done(h);
});

test('an operator with nobody in range when the cooldown reaches 0 does not fire', () => {
  const sn = chessRec({
    id: 'sn', profession: 'SNIPER', skill: null, rangeGrid: Y6,
    stats: { atk: 100, bat: 2.5, def: 0, blockCnt: 0 },
  });
  const h = makeBattle({
    autoFinish: false, timeLimit: 10,
    defs: { chess: { sn }, enemies: { walker: enemyRec({ key: 'walker', hp: 1e6, atk: 0, speed: 0 }) } },
    units: [{ uid: 1, chessId: 'sn', row: 10, col: 5, dir: 'RIGHT' }],
    enemies: [{ key: 'walker', pos: [10, 9] }],
  });
  h.step();
  const u = h.unit(1);
  assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).length, 0);
  const attacks = u.stats.attacks;
  u.atkCd = h.b.dt;
  h.step();
  assert.equal(u.stats.attacks, attacks);
  done(h);
});

function swing({ ranged = false } = {}) {
  const HIT = 0.4, BAT = 2;
  const rec = {
    ...enemyRec({ key: 'enemy_sw', hp: 1e9, atk: 100, bat: BAT, speed: 0, ...(ranged ? { range: 3 } : null) }),
    attackAnim: { clip: 'Attack', dur: 1, hit: HIT },
  };
  const h = makeBattle({
    defs: {
      chess: { t_wall: chessRec({ id: 't_wall', stats: { maxHp: 1e9, atk: 0, def: 0 }, skill: null }) },
      enemies: { enemy_sw: rec },
    },
    units: [{ chessId: 't_wall', row: 10, col: 6 }],
    enemies: [{ key: 'enemy_sw', pos: ranged ? [10, 9] : [10, 6] }],
    content: 'none', autoFinish: false, timeLimit: 30, hooks: ['attack', 'damaged'], captureNoisy: true,
  });
  h.step();
  return { h, e: h.b.enemies[0], wall: h.unit('t_wall') };
}

const strikes = (h, e) => h.hooksOf('attack').filter((c) => c.attacker === e);

test('a ranged swing still hits the ally who left its radius before the damage frame', () => {
  const { h, e, wall } = swing({ ranged: true });
  assert.ok(h.runUntil(() => e.swing && strikes(h, e).length === 0, 3));
  wall.x = 2;
  assert.ok(Math.hypot(wall.x - e.x, wall.y - e.y) > e.base.rangeRadius + 1);
  assert.ok(h.runUntil(() => strikes(h, e).length === 1, 2), 'the swing was not cancelled');
  h.run(1.5);
  const hits = h.hooksOf('damaged').filter((c) => c.source === e && c.target === wall && c.dmg && c.dmg.isAttack);
  assert.equal(hits.length, 1, 'the shot chased');
  done(h);
});

test('a melee swing still hits the ally who left contact before the damage frame', () => {
  const { h, e, wall } = swing();
  assert.ok(h.runUntil(() => e.swing && strikes(h, e).length === 0, 3));
  h.b.releaseBlocked(wall);
  e.x = 20;
  assert.ok(h.runUntil(() => strikes(h, e).length === 1, 2));
  const hits = h.hooksOf('damaged').filter((c) => c.source === e && c.target === wall && c.dmg && c.dmg.isAttack);
  assert.equal(hits.length, 1);
  assert.equal(e.blockedBy, null);
  done(h);
});

test('a target who dies during the wind-up still ends the attack, and deals no damage', () => {
  const { h, e, wall } = swing({ ranged: true });
  assert.ok(h.runUntil(() => e.swing && strikes(h, e).length === 0, 3));
  const taken = wall.stats.taken;
  h.b.kill(wall, null);
  h.run(1);
  assert.equal(strikes(h, e).length, 1);
  assert.equal(e.stats.attacks, 1);
  assert.equal(wall.stats.taken, taken);
  assert.ok(e.atkCd > 0, 'the interval started');
  done(h);
});
