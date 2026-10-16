import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { compactResult, creditedKillsOf, resultDigest } from '../../server/sim/spec.js';

function field(kind = 'normal') {
  const h = makeBattle({
    kind, content: 'none', autoFinish: false,
    defs: { chess: { guard: chessRec({ id: 'guard', stats: { cost: 0 }, skill: null }) }, enemies: { foe: enemyRec({ key: 'foe', hp: 1000 }) } },
    players: [
      { playerId: 'helper', seat: 0, side: 'L', units: [{ uid: 1, chessId: 'guard', row: 10, col: 3 }] },
      { playerId: 'other', seat: 1, side: 'R', units: [{ uid: 2, chessId: 'guard', row: 10, col: 3 }] },
    ],
  });
  h.b.start();
  return h;
}

test('actual kill credit follows the killer, including another player\'s leaked enemies in unite', () => {
  for (const kind of ['normal', 'unite', 'boss']) {
    const h = field(kind);
    const killer = h.b.getPlayer('helper').units[0];
    const owner = kind === 'unite' ? 'leaker' : 'other';
    const enemy = h.spawn('foe', { ownerPlayerId: owner, sourcePlayerId: owner, pos: [10, 9] });
    h.b.kill(enemy, killer);
    h.b.kill(enemy, killer); // a repeated removal must not count twice
    const result = h.result();
    assert.equal(result.perPlayer.helper.creditedKills, 1);
    assert.equal(result.perPlayer.other.creditedKills, 0);
    assert.equal(result.perPlayer.helper.killed, 0, 'existing wave-owned count unchanged');
    if (kind !== 'unite') assert.equal(result.perPlayer.other.killed, 1);
    assert.equal(compactResult(result).perPlayer.helper.creditedKills, 1);
    // statistics only: the verification digest leaves the credit out (DESIGN §32.14.16), so it never splits two digests
    assert.equal(resultDigest(result).hash, resultDigest({ ...result, perPlayer: { ...result.perPlayer, helper: { ...result.perPlayer.helper, creditedKills: 2 } } }).hash);
  }
});

test('a late summon kill survives the 160-row unitStats wire cap and belongs to its owner', () => {
  const h = field('unite');
  const owner = h.b.getPlayer('helper').units[0];
  let token;
  for (let i = 0; i < 165; i++) {
    token = h.b.spawnToken(owner, 'token_test', 10, 4, { def: { id: 'token_test', stats: { maxHp: 100, atk: 0, cost: 0, blockCnt: 0 }, rangeGrid: [[0, 0]] }, kit: {} });
    assert.ok(token);
    if (i < 164) h.b.retreat(token, { permanent: true });
  }
  h.b.kill(h.spawn('foe', { ownerPlayerId: 'leaker', pos: [10, 9] }), token);
  const result = compactResult(h.result());
  assert.equal(result.perPlayer.helper.unitStats.length, 160);
  assert.equal(result.perPlayer.helper.unitStats.reduce((n, u) => n + u.kills, 0), 0, 'late summon is outside the detail cap');
  assert.equal(result.perPlayer.helper.creditedKills, 1);
});

test('revives, source-less enemy deaths and allied deaths do not credit an enemy kill', () => {
  const h = field();
  const killer = h.b.getPlayer('helper').units[0];
  const revived = h.spawn('foe', { ownerPlayerId: 'other', pos: [10, 9] });
  const hook = h.b.on('kill', ({ victim }) => { if (victim === revived) victim.hp = 1; });
  h.b.kill(revived, killer);
  assert.equal(h.result().perPlayer.helper.creditedKills, 0);
  h.b.off(hook);
  h.b.kill(revived, null);
  h.b.kill(h.b.getPlayer('other').units[0], killer);
  assert.equal(h.result().perPlayer.helper.creditedKills, 0);
  assert.equal(creditedKillsOf({ killed: 100, unitStats: [{ kills: 2 }, { kills: 3 }] }), 5, 'legacy reports use actual unit kill counters');
});
