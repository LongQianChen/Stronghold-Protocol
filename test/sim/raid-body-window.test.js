// test/sim/raid-body-window.test.js — the 突袭 landing search window is measured to the tiles the enemy occupies, not to
// the tile its position rounds to (body.js: a huge unit's hitArea).
// Community report of 2026-10-13 (终极模拟, 隐秘核心): 「隐秘管位置偏移之后，我最下面一行三个突袭都不飞了…照理来说对家死了，那片空地最
// 左边第二列都能飞才对。另外14轮也是管，没有位置偏移，42正常飞到对家区域左上角和boss重叠那一格打管了」.
//      14 轮 假想敌：管 (boss_3,  enemy_9021_acduml)        hitArea {w:4.95,h:2.95,dx:0,dy:1}, route start (3,10);
//      15 轮 假想敌：管 (boss_10, enemy_9021_acduml_2, 隐秘核心) hitArea {w:4.95,h:2.95,dx:1,dy:1}, route start (3,9).
// A huge unit's hit rectangle is centred on (x + dx, y + dy), so both leaders have the same rectangle — centred on field
// col 10, rows 2.525–5.475, cols 7.525–12.475 — and therefore the same 15 body tiles (rows 3–5 × cols 8–12). The tile the
// position rounds to differs ((3,10) vs (3,9)), and raidTile measured its window from that tile: the window of the 14-round
// 管 was cols 8–12, the hidden 管's cols 7–11. The body tiles on the far column 12 fell outside the hidden window and
// became unreachable, so a member whose only free landings are there kept standing still (the poll repeats every
// RAID_POLL with the same geometry) — which is a property of the window, not of the round's kind.
// Run: node --test test/sim/raid-body-window.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, flatStage, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { bodyKeys } from '../../server/sim/body.js';

const COLS = 21;
const BONDS = { raidShip: { count: 2, active: true, tier: 1, layers: 0 } };
const PROBE = 'raidProbe';
const GUARD = 'raidGuard';
// 一个近战成员：攻击范围只有脚下这一格，因此落点必须是敌人身体的一格，否则跳过去也打不到 — the report's own premise (「不能飞」)
const defs = { chess: {
  [PROBE]: chessRec({ id: PROBE, position: 'MELEE', bonds: ['raidShip'], rangeGrid: [[0, 0]], skill: null, stats: { cost: 0 } }),
  [GUARD]: chessRec({ id: GUARD, skill: null, stats: { cost: 0, respawnTime: 60 } }),
} };
/** The body of either 管: rows 3–5 × cols 8–12 (body.js reads hitArea, not the route anchor). */
const BODY = [3, 4, 5].flatMap((r) => [8, 9, 10, 11, 12].map((c) => [r, c]));
/** Every body tile but its far column 12 — the only landings left are the empty half's board tiles (the report's 空地). */
const GUARD_TILES = [3, 4, 5].flatMap((r) => [8, 9, 10, 11].map((c) => [r, c]));
const LEADERS = [
  { kind: 'boss', enemyKey: 'enemy_9021_acduml', anchor: [3, 10], why: '14 轮 boss_3: hitArea dx 0, route (3,10) — window cols 8–12' },
  { kind: 'hidden', enemyKey: 'enemy_9021_acduml_2', anchor: [3, 9], why: '15 轮 boss_10 隐秘核心: hitArea dx 1, route (3,9) — window was cols 7–11' },
];
const flat = () => flatStage({ rows: Object.fromEntries(Array.from({ length: 7 }, (_, r) => [r, 'r'.repeat(COLS)])) });

/** p1 holds a lone melee 突袭 member on (12,3) and blockers on every body tile but col 12; the leader spawns on its route. */
function raidLanding({ kind, enemyKey, anchor }) {
  const units = [{ uid: 1, kind: 'chess', chessId: PROBE, row: 12, col: 3 }];
  let uid = 10;
  for (const [r, c] of GUARD_TILES) units.push({ uid: uid++, kind: 'chess', chessId: GUARD, row: r, col: c, abs: true });
  const h = makeBattle({
    kind, modeId: 'mode_multi_hard', stage: flat(), autoFinish: false, timeLimit: 60, seed: 3, defs,
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: BONDS, units }],
  });
  h.step();
  const e = h.spawn(enemyKey, { pos: anchor });
  const body = [...bodyKeys(e)].map((k) => [Math.floor(k / COLS), k - Math.floor(k / COLS) * COLS]);
  const u = h.unit(PROBE);
  const home = [u.tileR, u.tileC];
  const held = h.b.allyUnits.filter((a) => a.defId === GUARD && a.alive).map((a) => [a.tileR, a.tileC]);
  h.run(12);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  return { e, body, home, held, landed: [u.tileR, u.tileC] };
}

test('a huge leader: the window reaches its whole body, so the round it appears in changes no landing tile (community report of 2026-10-13)', () => {
  const out = LEADERS.map((l) => ({ l, r: raidLanding(l) }));
  for (const { l, r } of out) {
    // premise: one and the same body, the shape the route anchor would have split two ways
    assert.deepEqual(r.body, BODY, `${l.why}: body`);
    assert.deepEqual(r.home, [5, 3], `${l.why}: the member's home`);
    assert.deepEqual([...r.held].sort(), [...GUARD_TILES].sort(), `${l.why}: the blockers hold cols 8–11`);
    // the landings on the far column are the empty half's board tiles (#475 opens it to Raid on a boss/hidden field)
    const [lr, lc] = r.landed;
    assert.ok(r.body.some(([br, bc]) => br === lr && bc === lc), `${l.why}: lands on a body tile, got (${lr},${lc})`);
    assert.deepEqual(r.landed, [3, 12], `${l.why}: the body tile on col 12 — the hidden round stayed home before the fix`);
  }
  assert.deepEqual(out[0].r.landed, out[1].r.landed, 'one body, one answer');
});
