// test/sim/feedback5-raid-own-board.test.js — where a 突袭 member may land (DESIGN §25.18.1, §26.1).
// Community reports of 2026-10-06, items 40 and 16.3 (fixed in 0.2.0):
//   「…新约能天使在开了突袭之后蹦到了下方原本用来临时放置溢出的干员和道具的那一栏高台的最左侧位置」 — on a boss field the
//     battle rect (BOSS_RECT rows 0–5) holds the hand row (0) and the 临时整备区 row (1), high ground buildable ALL, so a
//     ranged member could land there;
//   「单人联防时突袭也可以跑到对面的场地上」 — on the 联防 map of one helper (escaped_single) the right half (cols 11–18)
//     is in the rect but is nobody's board.
// 0.2.0 let raidTile take only tiles of the member's own board (Battle.onOwnBoard: the board region, rows 9–12 / cols
// 2–10, mapped onto the field). The owner's decision of 2026-10-07 (0.2.1) opens a teammate's half when both halves are
// taken — the two-helper 联防 field and a Final Assault / Hidden Core pair field: raidTile takes the tiles of
// Battle.onFieldBoard (the board of any player of the field). The lone helper's empty half, a solo boss field's other
// half and the hand rows stay closed; 乌尔比安's S3 【移动】 keeps his own board.
// 0.2.4 (#475, maintainer-approved): only multiplayer boss/hidden Raid may also land on the empty half's board.
// Run: node --test test/sim/feedback5-raid-own-board.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, flatStage, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ID = 'chess_char_6_13_a'; // 新约能天使 (RANGED), given the 突袭 bond as the 转职球 / 突袭手雷 would
const TANK = 'chess_char_1_02_a'; // 角峰: a teammate's piece (no 突袭)
const ULPIA = 'chess_char_5_05_a';
const raw = getDefaultSource().rawChess(ID);
const raider = { ...raw, bonds: [...raw.bonds, 'raidShip'] };
const BONDS = { raidShip: { count: 2, active: true, tier: 1, layers: 0 } };
const dummy = enemyRec({ key: 'dummy', hp: 1e9, speed: 0, mass: 0 });
const defs = { enemies: { dummy }, chess: { [ID]: raider } };

function jump({ kind, stageId, players, enemyPos, seconds = 11, modeId }) {
  const h = makeBattle({ kind, stageId, autoFinish: false, timeLimit: 60, defs, players, modeId });
  h.step();
  const mine = h.b.allyUnits.filter((u) => u.defId === ID);
  const homes = mine.map((u) => [u.tileR, u.tileC]);
  h.spawn('dummy', { pos: enemyPos });
  h.run(seconds);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  return { h, mine, homes };
}
const seat = (playerId, s, o = {}) => ({ playerId, seat: s, side: o.side ?? 'L', colOffset: o.colOffset ?? 0, bonds: o.bonds ?? BONDS, units: o.units ?? [] });
const unitAt = (row, col, uid = 1, chessId = ID) => ({ uid, kind: 'chess', chessId, row, col });
/** A teammate with one 角峰 and no 突袭 (its half is taken). */
const mate = (playerId, s, o = {}) => seat(playerId, s, { ...o, bonds: {}, units: [unitAt(12, 8, 9, TANK)] });

test('boss field (solo 最终攻势): a ranged 突袭 member never lands on the hand row 0 or the 临时整备区 row 1', () => {
  // 战场#01: the enemy on the telin (1,3); before the fix the member landed on the hand tile (0,3)
  const { h, mine } = jump({ modeId: 'mode_single_normal', kind: 'boss', stageId: 'act1autochess_m01', players: [seat('p1', 0, { units: [unitAt(12, 3)] })], enemyPos: [1, 3] });
  const u = mine[0];
  assert.deepEqual([u.tileR, u.tileC], [2, 3], 'the board tile next to it, not (0,3)');
  assert.ok(h.b.onOwnBoard(u.player, u.tileR, u.tileC));
  // every row-0 / row-1 tile is off the board, every board tile (rows 2–5, cols 2–10) is on it
  for (let c = 0; c <= 20; c++) for (const r of [0, 1]) assert.equal(h.b.onOwnBoard(u.player, r, c), false, `(${r},${c})`);
  for (let r = 2; r <= 5; r++) for (let c = 2; c <= 10; c++) assert.equal(h.b.onOwnBoard(u.player, r, c), true, `(${r},${c})`);
  for (let r = 2; r <= 5; r++) for (let c = 11; c <= 20; c++) assert.equal(h.b.onOwnBoard(u.player, r, c), false, `(${r},${c}) is the right half`);
  // no partner: the field's boards are its own (the right half stays closed)
  for (let r = 0; r <= 5; r++) for (let c = 0; c <= 20; c++) assert.equal(h.b.onFieldBoard(r, c), h.b.onOwnBoard(u.player, r, c), `(${r},${c})`);
  // an enemy only the temp row could reach: it stays home and does not hop
  const far = jump({ modeId: 'mode_single_normal', kind: 'boss', stageId: 'act1autochess_m01', players: [seat('p1', 0, { units: [unitAt(12, 3)] })], enemyPos: [0, 9] });
  assert.deepEqual([far.mine[0].tileR, far.mine[0].tileC], far.homes[0]);
});

test('boss field pair: a member lands on its partner\'s half — the right player\'s on the left, the left player\'s on the mirrored right (the owner\'s decision of 2026-10-07) — never on the hand rows', () => {
  // the enemy on the left telin (1,3): the right player's member (board (12,3) → field (5,17)) takes the partner's board
  // tile next to it (until 0.2.1 it stayed home: no tile of its own half reaches the telin)
  const { h, mine, homes } = jump({ kind: 'boss', stageId: 'act1autochess_m01', players: [mate('p1', 0), seat('p2', 1, { side: 'R', units: [unitAt(12, 3)] })], enemyPos: [1, 3] });
  const u = mine[0];
  assert.equal(u.ownerId, 'p2');
  assert.deepEqual(homes[0], [5, 17]);
  assert.deepEqual([u.tileR, u.tileC], [2, 3], 'the partner\'s board tile next to the telin');
  const partner = h.b.getPlayer('p1');
  assert.ok(!h.b.onOwnBoard(u.player, 2, 3) && h.b.onOwnBoard(partner, 2, 3) && h.b.onFieldBoard(2, 3));
  // both halves are the field's boards, the hand / 临时整备区 rows of either side never
  for (let c = 0; c <= 20; c++) for (const r of [0, 1]) assert.equal(h.b.onFieldBoard(r, c), false, `(${r},${c})`);
  for (let r = 2; r <= 5; r++) for (let c = 2; c <= 18; c++) assert.equal(h.b.onFieldBoard(r, c), true, `(${r},${c})`);
  // the mirror: the left player's member (field (5,3)) lands on the right player's half, next to the right telin
  const left = jump({ kind: 'boss', stageId: 'act1autochess_m01', players: [seat('p1', 0, { units: [unitAt(12, 3)] }), mate('p2', 1, { side: 'R' })], enemyPos: [1, 17] });
  assert.deepEqual([left.mine[0].tileR, left.mine[0].tileC], [2, 17], 'the mirrored right half');
  assert.ok(!left.h.b.onOwnBoard(left.mine[0].player, 2, 17) && left.h.b.onOwnBoard(left.h.b.getPlayer('p2'), 2, 17));
  // an enemy only the partner's hand row could reach: it stays home and does not hop
  const far = jump({ kind: 'boss', stageId: 'act1autochess_m01', players: [mate('p1', 0), seat('p2', 1, { side: 'R', units: [unitAt(12, 3)] })], enemyPos: [0, 3] });
  assert.deepEqual([far.mine[0].tileR, far.mine[0].tileC], far.homes[0]);
});

test('联防 with one helper (escaped_single): 突袭 does not jump onto the right half', () => {
  for (const pos of [[10, 15], [11, 17], [9, 12]]) {
    const { h, mine, homes } = jump({ kind: 'unite', stageId: 'act1autochess_escaped_single', players: [seat('H', 0, { units: [unitAt(12, 9)] })], enemyPos: pos });
    const u = mine[0];
    assert.ok(u.tileC <= 10, `enemy ${pos}: landed on (${u.tileR},${u.tileC})`);
    assert.ok(h.b.onOwnBoard(u.player, u.tileR, u.tileC), `enemy ${pos}`);
    if (pos[1] >= 13) assert.deepEqual([u.tileR, u.tileC], homes[0], `enemy ${pos}: out of reach from the left half, it stays`);
    // a lone helper: the right half is nobody's board, not even the field's
    for (let r = 9; r <= 12; r++) for (let c = 11; c <= 20; c++) assert.equal(h.b.onFieldBoard(r, c), false, `(${r},${c})`);
  }
  // an enemy the left half can reach: it still jumps (onto the left half)
  const { mine } = jump({ kind: 'unite', stageId: 'act1autochess_escaped_single', players: [seat('H', 0, { units: [unitAt(12, 3)] })], enemyPos: [9, 9] });
  assert.ok(mine[0].tileC <= 10 && mine[0].tileC >= 7, `landed on (${mine[0].tileR},${mine[0].tileC})`);
});

test('联防 with two helpers (escaped_multi): a member lands on its teammate\'s half (the owner\'s decision of 2026-10-07); 乌尔比安\'s S3 【移动】 still keeps to his own', () => {
  // the enemy on the right helper's half: the left helper's member jumps onto it — the enemy's own road tile, the
  // nearest that covers it (this map's road takes ranged units too); until 0.2.1 it stayed home
  const players = [seat('L', 0, { units: [unitAt(12, 3, 1)] }), mate('R', 1, { colOffset: 8 })];
  const { h, mine, homes } = jump({ kind: 'unite', stageId: 'act1autochess_escaped_multi', players, enemyPos: [10, 15] });
  const u = mine[0];
  assert.deepEqual(homes[0], [12, 3]);
  assert.deepEqual([u.tileR, u.tileC], [10, 15], 'the right helper\'s half');
  assert.ok(!h.b.onOwnBoard(u.player, 10, 15) && h.b.onOwnBoard(h.b.getPlayer('R'), 10, 15) && h.b.onFieldBoard(10, 15));
  // the right-hand helper (board col 9 → field col 17) lands on the left helper's half the same way
  const right = jump({ kind: 'unite', stageId: 'act1autochess_escaped_multi', players: [mate('L', 0), seat('R', 1, { colOffset: 8, units: [unitAt(12, 9, 1)] })], enemyPos: [10, 5] });
  assert.deepEqual(right.homes[0], [12, 17]);
  assert.deepEqual([right.mine[0].tileR, right.mine[0].tileC], [10, 5], 'the left helper\'s half');
  // 乌尔比安 beside a teammate: an anchor that meets no enemy flies 6 tiles ahead to (10,13), the teammate's half — a
  // field board but not his: he stays where he stands (DESIGN §25.17.2, a separate community report)
  const ul = makeBattle({
    kind: 'unite', stageId: 'act1autochess_escaped_multi', seed: 5, autoFinish: false, timeLimit: 120, defs,
    players: [seat('L', 0, { bonds: {}, units: [unitAt(10, 7, 1, ULPIA)] }), mate('R', 1, { colOffset: 8 })],
  });
  ul.step();
  const a = ul.unit(ULPIA);
  a.skill.gainSp(999, 'test');
  if (!a.skill.active) assert.ok(a.skill.activate('test'), 'S3 cast');
  ul.run(0.2);
  checkInvariants(ul.b);
  assert.ok(ul.b.onFieldBoard(10, 13) && !ul.b.onOwnBoard(a.player, 10, 13));
  assert.deepEqual([a.tileR, a.tileC], [10, 7], 'he stays on his own half');
});

for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) {
  test(`#475 ${kind}, lone ${side} multiplayer player: ranged Raid reaches the empty half, without opening its hand rows`, () => {
    const c = side === 'L' ? 17 : 3;
    const players = [seat('p1', 0, { side, units: [unitAt(12, 3)] })];
    for (const modeId of ['mode_multi_normal', 'mode_multi_hard']) {
      const { h, mine } = jump({ kind, modeId, stageId: 'act1autochess_m01', players, enemyPos: [1, c] });
      assert.deepEqual([mine[0].tileR, mine[0].tileC], [2, c]);
      assert.equal(h.b.onFieldBoard(2, c), false, 'the general board contract still excludes an absent teammate');
      const far = jump({ kind, modeId, stageId: 'act1autochess_m01', players, enemyPos: [0, c] });
      assert.deepEqual([far.mine[0].tileR, far.mine[0].tileC], far.homes[0], 'no legal board tile reaches the hand-only target');
    }
    for (const modeId of ['mode_single_normal', 'mode_single_hard']) {
      const solo = jump({ kind, modeId, stageId: 'act1autochess_m01', players, enemyPos: [1, c] });
      assert.deepEqual([solo.mine[0].tileR, solo.mine[0].tileC], solo.homes[0], 'actual solo mode keeps its own half');
    }
  });
}

// Give the member only its own tile as attack range, so each case has exactly one possible landing. All tested
// off-board tiles are intentionally buildable: the scope predicate, not incidental terrain, must reject them.
function emptyHalfLanding({ kind = 'boss', side = 'L', pos, glyph = 'r', ranged = false, reserved = false }) {
  const stage = flatStage({ rows: Object.fromEntries(Array.from({ length: 7 }, (_, r) => [r, 'r'.repeat(21)])) });
  stage.rows[pos[0]] = stage.rows[pos[0]].slice(0, pos[1]) + glyph + stage.rows[pos[0]].slice(pos[1] + 1);
  const h = makeBattle({
    kind, modeId: 'mode_multi_normal', stage, autoFinish: false,
    defs: { enemies: { dummy }, chess: {
      probe: chessRec({ id: 'probe', position: ranged ? 'RANGED' : 'MELEE', bonds: ['raidShip'], rangeGrid: [[0, 0]], skill: null }),
      guard: chessRec({ id: 'guard', skill: null, stats: { respawnTime: 60 } }),
    } },
    players: [seat('p1', 0, { side, units: [unitAt(12, 3, 1, 'probe'),
      ...(reserved ? [{ ...unitAt(pos[0], pos[1], 2, 'guard'), abs: true }] : []),
    ] })],
  });
  h.step();
  h.spawn('dummy', { pos });
  return h;
}

for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) {
  test(`#475 ${kind}, lone ${side} multiplayer player: melee Raid reaches the empty half`, () => {
    const pos = [3, side === 'L' ? 17 : 3];
    const h = emptyHalfLanding({ kind, side, pos });
    const u = h.unit('probe');
    h.run(11);
    assert.deepEqual([u.tileR, u.tileC], pos);
    assert.equal(h.b.onFieldBoard(...pos), false);
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0);
  });
}

test('#475: even buildable hand, temporary-storage and side-margin tiles remain invalid Raid landings', () => {
  for (const pos of [[0, 3], [1, 3], [0, 17], [1, 17], [3, 1], [3, 19]]) {
    const h = emptyHalfLanding({ pos, ranged: true });
    const u = h.unit('probe'), home = [u.tileR, u.tileC];
    h.run(11);
    assert.deepEqual([u.tileR, u.tileC], home, `excluded tile ${pos}`);
    checkInvariants(h.b);
  }
});

test('#475: no Raid lands off the rectangle — an enemy spawned on (6,17) is held on the edge row and stands on (5,17)', () => {
  // Battle._clampPos keeps an enemy FIELD_EDGE_INSET inside the field, so its tile is the edge tile (body.js).
  const h = emptyHalfLanding({ pos: [6, 17], ranged: true });
  const u = h.unit('probe');
  h.run(11);
  assert.deepEqual([u.tileR, u.tileC], [5, 17]);
  checkInvariants(h.b);
});

test('#475: empty-half Raid still respects melee/high-ground, water and occupied/downed-unit reservations', () => {
  for (const glyph of ['h', 'd']) {
    const h = emptyHalfLanding({ pos: [3, 17], glyph });
    const u = h.unit('probe'), home = [u.tileR, u.tileC];
    assert.equal(h.b.grid.canStand(3, 17), false, `terrain ${glyph} is undeployable for melee`);
    h.run(11);
    assert.deepEqual([u.tileR, u.tileC], home, `terrain ${glyph}`);
  }
  const h = emptyHalfLanding({ pos: [3, 17], reserved: true });
  const u = h.unit('probe'), guard = h.unit('guard'), home = [u.tileR, u.tileC];
  h.run(11);
  assert.deepEqual([u.tileR, u.tileC], home, 'living occupant');
  h.b.kill(guard, null);
  assert.equal(h.b.isReservedTile(3, 17), true, 'downed operator reserves its rest tile');
  h.run(11);
  assert.deepEqual([u.tileR, u.tileC], home, 'downed occupant');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});
