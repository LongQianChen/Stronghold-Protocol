// test/match/waves-plugin-bounds.test.js — a data plugin's factions.generation numbers stay within one wave action's units
// (DESIGN §32.6, the P1c review's HIGH-1): a minReplacedEnemyCount of 4e7 (an integer under the plugin JSON limit of 1e9)
// became every replaced placeholder action's unit count and then `new Array(own).fill(…)` in the bounty plan — the
// allocation that aborts a worker thread's whole process. server/match/waves.js now clamps replacedCount's min / max and
// the bounty plan's own units to templateSpawns' 50; the official 1 / 5 give what they gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { replacedCount, buildNormalWave, bountySpawns, isFlyKey } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';

const withGeneration = (patch) => ({ ...DATA, factions: { ...DATA.factions, generation: { ...DATA.factions.generation, ...patch } } });

/** Round 5 of a co-op hard match whose placeholders become the DOT faction's units (as test/match/waves.test.js). */
function round5(gd) {
  const picks = [];
  const entry = DATA.factions.entries.enemy_1270_nhstlk;
  picks[5] = { round: 5, type: 'DOT', key: 'enemy_1270_nhstlk', normal: entry.N[0].key, elite: entry.E[0].key, fly: false, firstHalf: true };
  return buildNormalWave(gd, createRng(1), { picks }, 5);
}

test('replaced-enemy counts of 4e7 are one action\'s 50 units at most; the bounty plan builds at once; official numbers unchanged', () => {
  const official = new GameData(DATA, 'mode_multi_hard');
  const tpl = Object.keys(DATA.enemies).find((k) => !isFlyKey(official, k) && DATA.enemies[k].attrPower > 0) || 'enemy_1270_nhstlk';
  const unit = DATA.factions.entries.enemy_1270_nhstlk.N[0].key;
  for (const patch of [{ minReplacedEnemyCount: 40_000_000 }, { minReplacedEnemyCount: 40_000_000, maxReplacedEnemyCount: 40_000_000 }, { maxReplacedEnemyCount: 1e9 }]) {
    const gd = new GameData(withGeneration(patch), 'mode_multi_hard');
    const n = replacedCount(gd, tpl, 50, unit);
    assert.ok(n >= 1 && n <= 50, `${JSON.stringify(patch)} → ${n}`);
    const w = round5(gd);
    for (const a of w.actions) assert.ok(a.count <= 50, `action ${a.index}: ${a.count} units`);
    for (const s of w.spawns) assert.ok(s.count <= 50, `spawn ${s.enemyKey}: ${s.count} units`);
    const kill = DATA.choices.cards.bounty.find((c) => c.payout === 'kill' && DATA.enemies[c.enemyKey] && !isFlyKey(gd, c.enemyKey));
    const t0 = performance.now();
    const specs = bountySpawns(gd, 5, w, [{ id: 'b1', card: kill }], 'p1');
    assert.ok(specs.length > 0, 'the bounty is fielded');
    assert.ok(performance.now() - t0 < 1000, 'no 40-million-entry list');
  }
  // the official 1 / 5: the official data's waves are what they were (the golden scenarios hold the exact numbers)
  const plain = replacedCount(official, tpl, 3, unit);
  assert.ok(plain >= 1 && plain <= 5);
  assert.deepEqual(round5(official), round5(new GameData(withGeneration({}), 'mode_multi_hard')));
});
