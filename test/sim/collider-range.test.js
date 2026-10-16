// The enemy collider in operator range tests (the owner's decision of 2026-10-14, round 41): the official client gives every
// enemy of this mode a CircleCollider2D of radius 0.1 and target search tests colliders (PRTS 作战机制 "索敌抬手等均使用
// 碰撞箱"), so an operator's range takes an enemy whose 0.1 circle overlaps one of its tiles. Tile rules (格子判定) keep the
// tile of the position, and blocking keeps the centre distance. The owner's official screenshots of 2026-10-14: a ground
// operator on the last tile of a ranged operator's range — the enemy it blocks stands outside that tile, and the ranged
// operator does not hit it.
// Run: node --test test/sim/collider-range.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { colliderKeys, bodyInRange, bodyInRangeTile, bodyInKeys, bodyKeys } from '../../server/sim/body.js';
import { COLS, ENEMY_COLLIDER_RADIUS, BLOCK_RADIUS } from '../../server/sim/constants.js';

const tiles = (u) => colliderKeys(u).map((k) => [Math.floor(k / COLS), k % COLS]);
const foe = (x, y) => ({ x, y, side: 'enemy' });
const bodyKeysOf = (u) => bodyKeys(u).sort((a, b) => a - b);

test('colliderKeys: the tile of the position, and a neighbour only when the 0.1 circle overlaps it (touching does not)', () => {
  assert.equal(ENEMY_COLLIDER_RADIUS, 0.1);
  assert.deepEqual(tiles(foe(3, 4)), [[4, 3]]);
  assert.deepEqual(tiles(foe(3.45, 4)), [[4, 3], [4, 4]], '0.05 from the edge: both columns');
  assert.deepEqual(tiles(foe(3.4, 4)), [[4, 3]], 'exactly 0.1 from the edge: touching only');
  assert.deepEqual(tiles(foe(3.6, 4)), [[4, 4]]);
  assert.deepEqual(tiles(foe(2.5, 4)), [[4, 2], [4, 3]], 'on the edge (the tile rule says column 2, half to even)');
  assert.deepEqual(tiles(foe(3.41, 4.41)), [[4, 3], [4, 4], [5, 3]], 'the corner is 0.127 away: no diagonal tile');
  assert.deepEqual(tiles(foe(3.47, 4.47)), [[4, 3], [4, 4], [5, 3], [5, 4]], 'the corner is 0.042 away: the diagonal too');
  assert.deepEqual(tiles(foe(-0.55, 4)), [[4, 0]], 'off the grid, its circle still reaches column 0');
  // an ally stands on its tile; a huge enemy's rectangle is its collider (no circle added)
  assert.deepEqual(tiles({ x: 3.45, y: 4, side: 'ally' }), [[4, 3]]);
  const huge = { x: 10, y: 9, side: 'enemy', hitArea: { w: 4.95, h: 2.95, dx: 0, dy: 1 } };
  assert.deepEqual(colliderKeys(huge).length, 15);
  // the helpers
  assert.ok(bodyInRange(foe(3.45, 4), [4 * COLS + 4]) && !bodyInKeys(foe(3.45, 4), [4 * COLS + 4]));
  assert.ok(bodyInRangeTile(foe(3.45, 4), 4, 4) && !bodyInRangeTile(foe(3.45, 4), 4, 5) && !bodyInRangeTile(foe(3, 4), -1, 3));
});

const SN = chessRec({ id: 'sn', profession: 'SNIPER', skill: null, rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100, bat: 1, blockCnt: 0, def: 0 } });
const GD = chessRec({ id: 'gd', profession: 'WARRIOR', skill: null, rangeGrid: [[0, 0], [0, 1]], stats: { atk: 1, bat: 1, blockCnt: 1, maxHp: 1e7, def: 0 } });
const ENEMIES = {
  walker: enemyRec({ key: 'walker', hp: 1e7, atk: 0, speed: 1 }),
  still: enemyRec({ key: 'still', hp: 1e7, atk: 0, speed: 0 }),
};

function arena(units, enemies) {
  const h = makeBattle({ autoFinish: false, timeLimit: 60, defs: { chess: { sn: SN, gd: GD }, enemies: ENEMIES }, units, enemies });
  const hits = [];
  h.b.on('damaged', (c) => { if (c.dmg?.isAttack) hits.push({ src: c.source?.id ?? null, tgt: c.target.id }); });
  return { h, hits };
}

test('the owner\'s screenshots: a blocker on the last tile of a ranged range — the enemy it blocks stands outside that tile and is not hit', () => {
  // 狙击 on (10, 3) facing right: cols 3–5. The guard on (10, 5), the range's last tile, facing left toward the walker.
  const { h, hits } = arena(
    [{ uid: 1, chessId: 'sn', row: 10, col: 3, dir: 'RIGHT' }, { uid: 2, chessId: 'gd', row: 10, col: 5, dir: 'LEFT' }],
    [{ key: 'walker', route: { motion: 'WALK', start: [10, 9], end: [10, 0], checkpoints: [] } }],
  );
  h.step();
  const sn = h.unit(1), gd = h.unit(2), e = h.b.enemies[0];
  assert.ok(h.runUntil(() => e.blockedBy === gd, 20), 'the guard blocks the walker');
  // blocked at the contact distance (中点判定, unchanged): its centre about 0.71 past the guard's centre
  assert.ok(e.x - gd.x > 0.69 && e.x - gd.x <= BLOCK_RADIUS.ground + 1e-9, `blocked at ${(e.x - gd.x).toFixed(3)}`);
  assert.ok(e.x - ENEMY_COLLIDER_RADIUS > 5.5, 'its collider stays outside the guard\'s tile, the range\'s last');
  h.run(6);
  assert.equal(e.blockedBy, gd);
  assert.equal(hits.filter((x) => x.src === sn.id).length, 0, 'the sniper never hits it');
  assert.ok(hits.filter((x) => x.src === gd.id && x.tgt === e.id).length >= 4, 'its blocker does (blockers always hit what they block)');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('an enemy whose centre is 0.05 past the range\'s last tile is in range; 0.15 past it is not', () => {
  for (const [x, inRange] of [[5.55, true], [5.65, false], [5.5, true], [5.45, true]]) {
    const { h, hits } = arena([{ uid: 1, chessId: 'sn', row: 10, col: 3, dir: 'RIGHT' }], [{ key: 'still', pos: [10, 6] }]);
    h.step();
    const sn = h.unit(1), e = h.b.enemies[0];
    e.x = x; e.y = 10;
    h.step();
    e.x = x; e.y = 10;
    assert.equal(h.b.enemiesInKeys(sn.rangeKeys, sn, sn.profile).includes(e), inRange, `x ${x}: the range`);
    // the tile rule: 5.5 rounds half to even onto column 6, outside the range
    assert.equal(h.b.enemiesOnTiles(sn.rangeKeys, sn, sn.profile).includes(e), x < 5.5, `x ${x}: the tile rule`);
    h.run(2);
    assert.equal(hits.some((d) => d.src === sn.id && d.tgt === e.id), inRange, `x ${x}: hit`);
    checkInvariants(h.b);
  }
});

test('a unit whose profile is `rangeTiles` searches by the tile of the position (谬因: PRTS 格子判定)', () => {
  const { h } = arena([{ uid: 1, chessId: 'sn', row: 10, col: 3, dir: 'RIGHT' }], [{ key: 'still', pos: [10, 6] }]);
  h.step();
  const sn = h.unit(1), e = h.b.enemies[0];
  e.x = 5.55; e.y = 10;
  h.b._buildEnemyIndex();
  assert.ok(h.b.enemiesInKeys(sn.rangeKeys, sn, sn.profile).includes(e));
  assert.ok(h.b.anyEnemyInKeys(sn.rangeKeys, sn));
  sn.profile.rangeTiles = true;
  assert.equal(h.b.enemiesInKeys(sn.rangeKeys, sn, sn.profile).includes(e), false);
  assert.equal(h.b.anyEnemyInKeys(sn.rangeKeys, sn), false);
  assert.equal(h.b.unitsInGrid(sn, [[0, 0], [0, 1], [0, 2]]).includes(e), false);
  sn.profile.rangeTiles = false;
  assert.ok(h.b.unitsInGrid(sn, [[0, 0], [0, 1], [0, 2]]).includes(e));
});

test('foesInColliderRadius: a radius effect PRTS marks 碰撞判定 reaches 0.1 further than foesInRadius', () => {
  const { h } = arena([{ uid: 1, chessId: 'sn', row: 10, col: 3, dir: 'RIGHT' }], [{ key: 'still', pos: [10, 8] }, { key: 'still', pos: [10, 9] }]);
  h.step();
  const [a, b] = h.b.enemies;
  a.x = 8 + 1.55; a.y = 10;   // 1.55 from (8, 10)
  b.x = 8 + 1.65; b.y = 11;   // farther than 1.6
  assert.deepEqual(h.b.foesInRadius(8, 10, 1.5).map((e) => e.id), []);
  assert.deepEqual(h.b.foesInColliderRadius(8, 10, 1.5).map((e) => e.id), [a.id]);
});

test('the per-tick index (inlined for speed) lists every enemy on exactly its colliderKeys and, for tile rules, on bodyKeys', () => {
  const { h } = arena([{ uid: 1, chessId: 'sn', row: 10, col: 3, dir: 'RIGHT' }], [{ key: 'still', pos: [10, 6] }]);
  h.step();
  const e = h.b.enemies[0];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 400; i++) {
    e.x = -0.6 + rnd() * 21.2; e.y = -0.6 + rnd() * 19.2;
    if (i % 7 === 0) e.x = Math.round(e.x) + 0.5;       // on an edge
    if (i % 11 === 0) e.y = Math.round(e.y) - 0.45;     // 0.05 from an edge
    h.b._buildEnemyIndex();
    const inRange = [], onTile = [];
    for (let k = 0; k < h.b._eb.length; k++) { if (h.b._eb[k].includes(e)) inRange.push(k); if (h.b._et[k].includes(e)) onTile.push(k); }
    assert.deepEqual(inRange, colliderKeys(e).sort((a, b) => a - b), `range buckets at (${e.x}, ${e.y})`);
    assert.deepEqual(onTile, bodyKeysOf(e), `tile bucket at (${e.x}, ${e.y})`);
    assert.equal(e._ebMulti, inRange.length > 1);
  }
});
