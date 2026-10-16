// Community report of 2026-10-14: 望 seemed to summon infinite 棋子 and freeze other operators' redeploy cost.
// A placed 棋子 is spent and returns on its tile for its DP cost (TRP-X: 2). The return waits while DP is short, and
// each return spends that DP, so a knocked-out operator whose timer has already finished waits behind them. The stone
// count stays the number placed. Once every stone is back, DP climbs at +1/s and the operator redeploys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { STONE } from '../../server/sim/content/kits/ops/op-wang.js';

const TILES = [[9, 4], [9, 5], [9, 6], [9, 7], [9, 8], [10, 6], [10, 8]];

test('望: seven 棋子 stay seven, and another operator redeploys once they stop spending DP', () => {
  const pieces = TILES.map(([row, col], i) => ({ uid: 2 + i, kind: 'token', tokenId: STONE, ownerUid: 1, row, col }));
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) } },
    timeLimit: 120, autoFinish: false, seed: 5,
    flags: { dpPerSec: 1, dpMax: 99 },
    units: [
      { uid: 1, diy: { slot: 'chess_char_6_diy1_a', charId: 'char_2027_wang', skillIndex: 0, uniEquipId: 'uniequip_002_wang' }, elite: true, row: 12, col: 3 },
      { uid: 50, chessId: 'chess_char_1_01_a', row: 11, col: 3 },
      ...pieces,
    ],
  });
  h.b.players[0].dp = 10;
  h.step();
  const wang = h.unit(1);
  const mate = h.unit(50);
  mate.base.respawnTime = 3;
  mate.base.cost = 6;
  const stones = () => h.b.allyUnits.filter((a) => a.defId === STONE);
  assert.equal(stones().length, 7);
  h.b.kill(mate, null);
  assert.ok(Number.isFinite(mate.respawnAt) && mate.respawnAt < 5, 'her redeploy timer starts');
  const due = mate.respawnAt;
  for (const s of stones()) if (s.alive) h.spawn('enemy_dummy', { pos: [s.homeR, s.homeC] });
  h.step();
  for (const e of h.b.enemies.filter((e) => e.alive)) h.b.kill(e, null);
  assert.equal(stones().length, 7, 'spending the stones does not create more');
  assert.ok(h.runUntil(() => stones().every((s) => s.alive), 40), 'each spent stone returns');
  assert.equal(stones().length, 7);
  assert.ok(wang.mem.wang.stock >= 0 && wang.mem.wang.stock <= 8);
  const dpFull = h.b.players[0].dp;
  h.run(2);
  const dpLater = h.b.players[0].dp;
  assert.ok(Number.isFinite(dpFull) && Number.isFinite(dpLater));
  assert.ok(dpLater > dpFull + 1.5, `DP resumes at +1/s once no stone is waiting (${dpFull} → ${dpLater})`);
  assert.ok(h.runUntil(() => mate.alive, 20), 'the operator redeploys after the stones');
  assert.ok(h.b.time > due, 'she waited on DP; the timer was not frozen');
  assert.equal(stones().length, 7);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});
