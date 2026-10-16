// Round 40 — 灵知 and the enemy 魔王 has blocked beside the blue gate.
//
// 魔王 at (9,4) facing RIGHT. A head-on enemy stops at contact, x≈4.7, and half-to-even puts that centre on
// tile (9,5) — the tile in front of her, not the tile behind her toward the gate.
// y-6 facing RIGHT (灵知), # = covered, . = not, origin on 灵知:
//         dc -2 -1  0  1  2
// dr -2        .  #  #  .
// dr -1     .  #  #  #  #
// dr  0     .  #  #  #  #
// dr  1     .  #  #  #  #
// dr  2        .  #  #  .
// 灵知 one row up and one column right of 魔王, enemy on the tile in front: offset [-1, 0], covered.
// Same 灵知, enemy on the tile behind 魔王: offset [-1, -2], not covered. The range is not widened.
// Run: node --test test/sim/round40-gnosis-block.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { roundHalfEven } from '../../server/sim/detmath.js';

const KING = 'chess_char_4_25_a';
const GNOSIS = 'chess_char_4_13_a';

function layout(gnCol, from = 'right') {
  const h = makeBattle({
    autoFinish: false, timeLimit: 40,
    units: [
      { uid: 1, chessId: KING, row: 9, col: 4, dir: 'RIGHT' },
      { uid: 2, chessId: GNOSIS, row: 10, col: gnCol, dir: 'RIGHT' },
    ],
    defs: { enemies: { heavy: enemyRec({ key: 'heavy', hp: 1e7, atk: 0, speed: 1.2, def: 0, mass: 3 }) } },
    enemies: [{ key: 'heavy', route: from === 'right' ? { motion: 'WALK', start: [9, 8], end: [9, 1], checkpoints: [] } : { motion: 'WALK', start: [9, 0], end: [9, 8], checkpoints: [] } }],
  });
  h.step();
  const king = h.unit(1), gn = h.unit(2), e = h.b.enemies[0];
  assert.ok(h.runUntil(() => e.blockedBy === king, 20), '魔王 blocks the enemy');
  const tileC = roundHalfEven(e.x), tileR = roundHalfEven(e.y);
  const attacks = gn.stats.attacks, dmg = gn.stats.dmg;
  h.run(6);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
  return {
    dx: e.x - king.x, tileR, tileC,
    offR: tileR - gn.tileR, offC: tileC - gn.tileC,
    attacks: gn.stats.attacks - attacks, dmg: gn.stats.dmg - dmg,
    grid: gn.rangeGrid,
  };
}

test('a head-on block stops in front of 魔王; 灵知 one row up and one column right hits that tile', () => {
  const g = layout(5);
  assert.ok(Math.abs(g.dx - 0.7) < 0.05, `dx ${g.dx}`);
  assert.equal(g.tileR, 9);
  assert.equal(g.tileC, 5, 'half-to-even of x≈4.7 is the column in front of her');
  assert.deepEqual([g.offR, g.offC], [-1, 0]);
  assert.ok(g.grid.some(([r, c]) => r === -1 && c === 0));
  assert.ok(g.attacks >= 2 && g.dmg > 500, `attacks ${g.attacks} dmg ${g.dmg}`);
});

test('灵知 does not hit the tile behind 魔王 (offset [-1, -2] is outside y-6); the range stays', () => {
  const g = layout(7);
  assert.equal(g.tileC, 5);
  assert.deepEqual([g.offR, g.offC], [-1, -2]);
  assert.equal(g.grid.some(([r, c]) => r === -1 && c === -2), false);
  assert.equal(g.attacks, 0);
  assert.equal(g.dmg, 0);
});

test('the video: the enemy held on 魔王\'s gate side; 灵知 one column right of her misses it, 灵知 above her hits it', () => {
  // round 40 (DESIGN §32.14.9): the red heavy sat on 魔王's gate side at contact (x ≈ 3.3, tile (9,3))
  const video = layout(5, 'left');
  assert.ok(Math.abs(video.dx + 0.7) < 0.05, `dx ${video.dx}`);
  assert.equal(video.tileC, 3);
  assert.deepEqual([video.offR, video.offC], [-1, -2]);
  assert.equal(video.attacks, 0, 'outside y-6 by the centre tile — and by the official 0.1 collider too');
  const above = layout(4, 'left');
  assert.deepEqual([above.offR, above.offC], [-1, -1]);
  assert.ok(above.attacks >= 2 && above.dmg > 500, `attacks ${above.attacks} dmg ${above.dmg}`);
});
