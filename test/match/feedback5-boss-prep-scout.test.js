// Community report of 2026-10-06, item 55: 「死亡后观战视角看不到场上的关底boss」. Reproduced in the browser (an eliminated
// guest at the boss round, notes i55-repro): in the Final Assault fight the watched boss field shows the leader, but in
// the boss round's prep the eliminated player saw its own empty normal board — and a scout of a teammate (m.field
// prep) was the normal board too, while the players themselves prepare on their half of the boss field with the leader
// standing at its spawn (render/app.js setLeader, only on the boss-field prep camera). Now the scout of a boss round's
// prep is built on the boss field: the scouted player's pieces on its half (bossFieldPlacement: rows − 7, the right
// half mirrored, RIGHT ↔ LEFT), `side` for the camera, the leader in nextEnemies with its spawn tile; with item 56 an
// eliminated viewer is pushed that scout at the round start without a tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';
import { bossFieldPlacement } from '../../server/match/finalAssault.js';
import { viewKind, leaderShown } from '../../public/js/render/app/view.js';
import { leaderStand } from '../../public/js/render/prepfield.js';

function bossPrep(seed) {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed, fake: true }).start();
  const m = h.m;
  m.bossPairs = [['p_0', 'p_1'], ['p_2', 'p_3']]; // explicit mirrored-layout fixture, not the pairing policy
  h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound, { ready: true });
  return h;
}

test('a scout of a boss round\'s prep is the boss field: the player\'s half (mirrored on the right), its side, the leader\'s spawn', () => {
  const h = bossPrep(55);
  const m = h.m;
  assert.deepEqual(m.bossWaves.map((w) => w.players), [['p_0', 'p_1'], ['p_2', 'p_3']]);
  const p1 = h.ps('p_1');
  // a board piece facing RIGHT and one in the hand
  for (const k of [...p1.board.keys()]) p1.board.delete(k);
  const id = chessOfTier(1)[0];
  const tile = legalTileFor(m, p1, id);
  const onBoard = give(m, p1, id, 'board', tile);
  onBoard.dir = 'RIGHT';
  give(m, p1, chessOfTier(1)[1], 'hand', 2);
  h.ps('p_3').eliminate(13);
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const meta = h.lastTo('p_3', 'm.field');
  assert.deepEqual([meta.fieldId, meta.prep, meta.kind, meta.side], ['n:p_1', true, 'boss', 'R']);
  assert.deepEqual(meta.rect, GEO.BOSS_RECT);
  const u = meta.units.find((x) => x.uid === onBoard.uid);
  const want = bossFieldPlacement('R', tile[0], tile[1], 'RIGHT');
  assert.deepEqual([u.y, u.x, u.dir, u.facing], [want.row, want.col, 'LEFT', -1], 'mirrored onto the right half, still facing the leader');
  const bench = meta.units.find((x) => x.y === 0);
  assert.ok(bench && bench.x === 20 - 2, `the hand row on the half's bench row (boss row 0, mirrored): ${JSON.stringify(bench)}`);
  for (const x of meta.units.filter((x) => x.ownerId === 'p_1')) assert.ok(x.y >= 0 && x.y <= 5 && x.x >= 10 && x.x <= 20, `on the right half: ${x.y},${x.x}`);
  // the leader stands at its spawn tile: the client's leaderStand finds it in the scout's nextEnemies
  const stand = leaderStand(meta.nextEnemies, () => null, (x, y) => [[y, x]]);
  assert.ok(stand && stand.entry.boss && stand.row >= 0 && stand.row <= 5, `the leader with its spawn tile: ${JSON.stringify(stand?.entry)}`);
  assert.deepEqual(meta.nextEnemies, m.nextEnemiesFor(p1), 'the scouted player\'s own preview (its pair\'s wave)');
  // the client frames a scout with that rect on the boss-field prep camera, which shows the leader
  assert.equal(viewKind('prep', { rect: meta.rect, side: meta.side }), 'bossPrep');
  assert.equal(leaderShown('bossPrep'), true);
  // the left player of the pair: its own half, unmirrored
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
  const left = h.lastTo('p_3', 'm.field');
  assert.deepEqual([left.kind, left.side], ['boss', 'L']);
  // its own pieces on the left half (since item 51 the partner p_1's board stands on the right half beside them)
  for (const x of left.units.filter((x) => x.ownerId === 'p_0')) assert.ok(x.x <= 10, 'the left half');
  assert.ok(left.units.some((x) => x.ownerId === 'p_1' && x.uid === onBoard.uid && x.x === want.col), 'p_1\'s piece on the right half');
  m.dispose();
});

test('the eliminated viewer is pushed the boss-field scout at the boss round\'s start (item 56); a normal round\'s scout stays the normal board', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 3, seed: 56, fake: true }).start();
  const m = h.m;
  m.bossPairs = [['p_0', 'p_1'], ['p_2']]; // keep this scout fixture's named left/right roles
  h.toPrep(1);
  h.ps('p_2').eliminate(1);
  h.toPrep(2);
  const normal = h.lastTo('p_2', 'm.field');
  assert.deepEqual([normal.fieldId, normal.kind, normal.prep, normal.side], ['n:p_0', 'normal', true, undefined]);
  assert.deepEqual(normal.rect, GEO.NORMAL_RECT);
  h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound, { ready: true });
  const meta = h.lastTo('p_2', 'm.field');
  assert.deepEqual([meta.fieldId, meta.kind, meta.prep, meta.side], ['n:p_0', 'boss', true, 'L']);
  assert.ok(leaderStand(meta.nextEnemies, () => null, (x, y) => [[y, x]]), 'the leader at its spawn');
  m.dispose();
});
