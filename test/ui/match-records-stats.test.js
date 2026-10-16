import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_VERSION, buildRecord, aggregateStats, migrateStats, compactRecord, exportStats, importStats, emptyStats,
} from '../../public/js/ui/stats.js';

function record(seed, { funds = 100, merges = 2, defeats } = {}) {
  return buildRecord({ victory: true, seed, roundsPassed: 14, difficulty: 'HARD', modeId: 'mode_multi_hard', players: [
    { playerId: 'self', alive: true, victory: true, roundsPassed: 14, stats: { gold: funds, merges, kills: 1000 }, ...(defeats === undefined ? {} : { creditedKills: defeats }) },
    { playerId: 'teammate', alive: true, stats: { gold: 99999, merges: 999 }, creditedKills: 99999 },
  ] }, { myId: 'self', now: seed + 1 });
}

test('three independent single-match maxima use the self row, not totals or teammates', () => {
  const agg = aggregateStats([
    record(1, { funds: 900, merges: 3, defeats: 7 }),
    record(2, { funds: 100, merges: 9, defeats: 12 }),
    record(3, { funds: 300, merges: 2, defeats: 4 }),
  ]);
  assert.deepEqual(agg.maxima, { gold: 900, merges: 9, kills: 12 });
  assert.equal(agg.sums.gold, 1300);
  assert.equal(agg.sums.merges, 14);
  assert.equal(agg.sums.kills, 3000, 'existing wave-owned cumulative counter remains unchanged');
  assert.deepEqual(aggregateStats([record(0, { funds: 0, merges: 0, defeats: 0 })]).maxima, { gold: 0, merges: 0, kills: 0 });
});

test('legacy records contribute funds and promotions without inventing actual kill totals', () => {
  const migrated = migrateStats({ v: 1, records: [record(1, { funds: 700, merges: 8 })] });
  assert.equal(migrated.stats.v, STATS_VERSION);
  assert.equal(migrated.changed, true);
  assert.deepEqual(aggregateStats(migrated.stats.records).maxima, { gold: 700, merges: 8, kills: null });
  for (const bad of [null, -1, 1.5, '10', Infinity, 1e9 + 1]) assert.equal(aggregateStats([record(2, { defeats: bad })]).maxima.kills, null);
  assert.deepEqual(aggregateStats([]).maxima, { gold: null, merges: null, kills: null });
});

test('compaction and JSON export/import retain all three records after replay detail is discarded', () => {
  const compact = compactRecord(record(10, { funds: 515, merges: 6, defeats: 47 }));
  assert.equal(compact.players[0].creditedKills, 47);
  const exported = JSON.parse(JSON.stringify(exportStats({ v: STATS_VERSION, records: [compact] })));
  const imported = importStats(exported, emptyStats());
  assert.deepEqual(aggregateStats(imported.stats.records).maxima, { gold: 515, merges: 6, kills: 47 });
});

test('partial quit data does not set a whole-match record; a settled defeat still does', () => {
  const partial = { ...record(1, { funds: 9999, merges: 99, defeats: 9999 }), end: 'quit' };
  const lost = record(2, { funds: 200, merges: 3, defeats: 11 });
  lost.victory = false;
  lost.players[0].victory = false;
  assert.deepEqual(aggregateStats([partial, lost]).maxima, { gold: 200, merges: 3, kills: 11 });
  assert.equal(aggregateStats([partial, lost]).count, 2, 'existing quit counting rule is unchanged');
});
