// The tile of a target is its position rounded half to even — PRTS 作战机制 「受击方坐标经round函数取整(四舍六入五成双)
// 得到其所属格坐标，按是否属于该格判定」 — not Math.round, which rounds every tie up: an enemy exactly halfway between
// columns 10 and 11 (x = 10.5) is on column 10, one at x = 11.5 on column 12.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { roundHalfEven } from '../../server/sim/detmath.js';
import { bodyKeys, bodyOnTile, bodyTileReach } from '../../server/sim/body.js';
import { tileKeyOf } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';

test('roundHalfEven: ties to the even integer, the rest to the nearest; never −0', () => {
  const cases = [[0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [10.5, 10], [11.5, 12], [-0.5, 0], [-1.5, -2], [-2.5, -2],
    [2.4999999999999996, 2], [2.5000000000000004, 3], [-0.4, 0], [-0, 0], [7, 7], [4503599627370495.5, 4503599627370496]];
  for (const [x, want] of cases) assert.ok(Object.is(roundHalfEven(x), want), `${x} → ${roundHalfEven(x)}, want ${want}`);
  for (let i = -2000; i <= 2000; i++) {
    const x = i / 8, v = roundHalfEven(x), d = Math.abs(x - v);
    assert.ok(Number.isInteger(v) && (d < 0.5 || (d === 0.5 && v % 2 === 0)), `${x} → ${v}`);
    if (d !== 0.5) assert.equal(v, Math.round(x) + 0, `${x}: away from a tie it is Math.round`);
  }
});

test('a point target exactly halfway is on the even tile: bodyKeys, bodyOnTile, bodyTileReach, tileKeyOf', () => {
  const e = { x: 10.5, y: 3.5 };
  assert.deepEqual(bodyKeys(e), [4 * COLS + 10]);
  assert.ok(bodyOnTile(e, 4, 10) && !bodyOnTile(e, 4, 11) && !bodyOnTile(e, 3, 10));
  assert.equal(bodyTileReach(e, 4, 10), 0);
  assert.equal(bodyTileReach(e, 4, 12), 2);
  assert.equal(tileKeyOf(e), 4 * COLS + 10);
  assert.equal(tileKeyOf({ x: 11.5, y: 2.5 }), 2 * COLS + 12);
});

test('the battle\'s tile index puts an enemy at x = 10.5 on column 10, not 11; its 0.1 collider is in range of both', () => {
  const h = makeBattle({
    kind: 'boss', content: 'none', autoFinish: false, timeLimit: 60,
    defs: {
      chess: { t_one: chessRec({ id: 't_one', stats: { atk: 100, blockCnt: 0, maxHp: 1e7 }, rangeGrid: [[0, 0]], skill: null }) },
      enemies: { enemy_still: enemyRec({ key: 'enemy_still', hp: 1e8, speed: 0 }) },
    },
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', units: [{ uid: 1, kind: 'chess', chessId: 't_one', row: 1, col: 1 }], bonds: {} }],
  });
  h.step();
  const e = h.spawn('enemy_still', { pos: [3, 10], routeIndex: 0 });
  e.x = 10.5;
  e.y = 3;
  h.step();
  e.x = 10.5;
  e.y = 3;
  const u = h.unit('t_one');
  // a tile rule (格子判定): the tile of the position
  assert.deepEqual(h.b.enemiesOnTiles([3 * COLS + 10], u, { canHitFly: true }).map((x) => x.id), [e.id]);
  assert.deepEqual(h.b.enemiesOnTiles([3 * COLS + 11], u, { canHitFly: true }).map((x) => x.id), []);
  // a range (the owner's decision of 2026-10-14): its collider straddles the edge, so both columns reach it, listed once
  assert.deepEqual(h.b.enemiesInKeys([3 * COLS + 10], u, { canHitFly: true }).map((x) => x.id), [e.id]);
  assert.deepEqual(h.b.enemiesInKeys([3 * COLS + 11], u, { canHitFly: true }).map((x) => x.id), [e.id]);
  assert.deepEqual(h.b.enemiesInKeys([3 * COLS + 10, 3 * COLS + 11], u, { canHitFly: true }).map((x) => x.id), [e.id]);
});
