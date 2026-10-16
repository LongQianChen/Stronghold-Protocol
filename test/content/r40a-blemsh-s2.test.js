// 瑕光 S2 慑敌辉光, community report 2026-10-14: facing down, she could not hit the sleeping enemies on her left and
// right. Her attack range stays 1-1 (self + the tile in front). rangeId x-1 is the 技能范围. A sleeper she was blocking
// stands on a side tile; 沉睡 releases the block (DESIGN §24.9) and 1-1 facing the other way does not cover that tile.
// While S2 runs, a sleeping ground enemy on the rotated skill range is extra attack range (server kit [ASSUMED]: the
// skill text does not change her attack range, so an awake enemy in the diamond is not). x-1 also contains the tile
// behind her, so a sleeper there is hittable only during S2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { offsetTile } from '../../server/sim/dir.js';
import { COLS } from '../../server/sim/constants.js';

const ds = getDefaultSource();
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const ROW = 10;
const COL = 6;
const keyOf = (r, c) => r * COLS + c;
const skillIndex = (id) => ds.rawChess(id).skills.find((s) => s.skillId === 'skchr_blemsh_2').index;
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, atk: 0, ...o });
const hitsFrom = (h, u, target) => h.hooksOf('damaged').filter((c) => c.source === u && c.target === target && c.dmg?.isAttack);

function fight(id, dir, sleeperAt, { fly = false } = {}) {
  const awakeAt = [12, 4];
  const h = makeBattle({
    defs: {
      enemies: {
        enemy_side: dummy('enemy_side', fly ? { motion: 'FLY' } : {}),
        enemy_awake: dummy('enemy_awake'),
      },
    },
    timeLimit: 30,
    hooks: ['damaged'],
    captureNoisy: true,
    units: [{ chessId: id, row: ROW, col: COL, dir, skillIndex: skillIndex(id) }],
    enemies: [
      { key: 'enemy_side', pos: sleeperAt },
      { key: 'enemy_awake', pos: awakeAt },
    ],
  });
  h.step();
  const u = h.unit(id);
  const side = h.enemy('enemy_side');
  const awake = h.enemy('enemy_awake');
  assert.equal(u.dir, dir);
  assert.ok(side && awake, `${id} ${dir}: both enemies spawned`);
  h.b.applyStatus(side, 'sleep', { duration: 30, source: u });
  h.run(1.2);
  assert.equal(hitsFrom(h, u, side).length, 0, `${id} ${dir}: 1-1 does not reach the sleeper before S2`);
  assert.ok(u.skill.activate('test', { free: true }), `${id} ${dir}: S2 starts`);
  h.step();
  return { h, u, side, awake, sideKey: keyOf(sleeperAt[0], sleeperAt[1]), awakeKey: keyOf(awakeAt[0], awakeAt[1]) };
}

function done(h) {
  assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []);
  checkInvariants(h.b);
}

test('瑕光 S2: four facings × left and right sleeping ground enemies are hittable only while the skill runs', () => {
  for (const id of ['chess_char_3_12_a', 'chess_char_3_12_b']) {
    for (const dir of DIRS) {
      for (const [name, dr] of [['left', 1], ['right', -1]]) {
        const at = offsetTile(ROW, COL, dr, 0, dir);
        const { h, u, side, awake, sideKey, awakeKey } = fight(id, dir, at);
        assert.ok(u.rangeKeySet.has(sideKey), `${id} ${dir} ${name}: the sleeper tile is extra range`);
        assert.ok(!u.rangeKeySet.has(awakeKey), `${id} ${dir} ${name}: an awake neighbour stays out of range`);
        assert.ok(h.runUntil(() => hitsFrom(h, u, side).length >= 1, 6), `${id} ${dir} ${name}: she hits the sleeper`);
        assert.equal(hitsFrom(h, u, awake).length, 0, `${id} ${dir} ${name}: the awake enemy is not hit`);
        const n = hitsFrom(h, u, side).length;
        u.skill.end('test');
        h.run(1.5);
        assert.equal(u.extraRangeKeys, null, `${id} ${dir} ${name}: extra range clears with the skill`);
        assert.equal(hitsFrom(h, u, side).length, n, `${id} ${dir} ${name}: no further hits after S2`);
        done(h);
      }
    }
  }
});

test('瑕光 S2 facing down: a sleeper on the tile behind her is hittable only during the skill [ASSUMED]', () => {
  const at = offsetTile(ROW, COL, 0, -1, 'DOWN');
  const { h, u, side, sideKey } = fight('chess_char_3_12_a', 'DOWN', at);
  assert.ok(u.rangeKeySet.has(sideKey), 'x-1 contains the tile behind her');
  assert.ok(h.runUntil(() => hitsFrom(h, u, side).length >= 1, 6), 'she hits the sleeper behind her during S2');
  u.skill.end('test');
  const n = hitsFrom(h, u, side).length;
  h.run(1.5);
  assert.equal(hitsFrom(h, u, side).length, n);
  done(h);
});

test('瑕光 S2: a sleeping flyer on a side tile is not added to her attack range', () => {
  const at = offsetTile(ROW, COL, 1, 0, 'DOWN');
  const { h, u, side, sideKey } = fight('chess_char_3_12_a', 'DOWN', at, { fly: true });
  assert.ok(side.isFlying && side.s.flags.sleep);
  assert.ok(!u.rangeKeySet.has(sideKey), 'the skill text sleeps ground enemies; a flyer is not extra range');
  h.run(3);
  assert.equal(hitsFrom(h, u, side).length, 0);
  done(h);
});
