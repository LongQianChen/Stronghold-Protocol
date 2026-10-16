// The shared bot layout rehearsal run (server/sim/rehearsal.js): the candidate comparison the server and the host's
// browser both use (DESIGN §14). It is pure ESM with no clock of its own — the caller passes the wall-clock slice —, so
// this file covers the scoring order (fewest counted leaks, then most kills, then the earlier candidate), the early stop,
// the tick cap, the candidate boundaries a slice stops on and the candidates that cannot be built. The delegation that
// hands one such run to a browser is test/match/rehearsal-delegate.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RehearsalRun } from '../../server/sim/rehearsal.js';

test('the shared comparison scores leaks, then kills, then the earlier candidate', () => {
  const res = (n, killed) => ({ perPlayer: { p: { killed, total: 9, leaked: Array.from({ length: n }, () => ({ enemyKey: 'e', counted: true })) } } });
  const battle = (r) => () => ({ finished: true, result: () => r, forceEnd() {}, step() {} });
  const run = new RehearsalRun([battle(res(2, 5)), battle(res(1, 1)), battle(res(1, 1))], 'p', 10);
  run.run();
  assert.equal(run.score.index, 1, 'the fewest leaks win, the earlier candidate wins the tie');
  assert.equal(run.score.leaks, 1);
  const other = new RehearsalRun([battle({ perPlayer: { p: { killed: 1, total: 3, leaked: [{ enemyKey: 'e', counted: false }] } } })], 'p', 10);
  other.run();
  assert.equal(other.score.leaks, 0, 'a leak that does not count is no leak');
  assert.equal(other.score.score, 1);
  // a candidate that cannot be built (the factory returns nothing, like the stand-in the server never scores either) is
  // skipped, not picked
  const skipped = new RehearsalRun([() => null, battle(res(0, 4))], 'p', 10);
  skipped.run();
  assert.equal(skipped.score.index, 1);
  // a candidate is only built when the slice reaches it — the construction is sliced work
  const built = [];
  const stepping = (r) => ({ finished: false, result: () => r, forceEnd() {}, step() {} });
  const factory = (i) => () => { built.push(i); return stepping(res(0, 5 - i)); };
  const lazy = new RehearsalRun([factory(0), factory(1), factory(2)], 'p', 1);
  assert.equal(lazy.run(() => true), false, 'the budget ran out at the first candidate boundary');
  assert.deepEqual(built, [0], 'nothing beyond the stopped slice was built');
  lazy.run();
  assert.deepEqual(built, [0, 1, 2]);
  assert.equal(lazy.score.index, 0, 'the most kills win');
  // a factory that throws is reported and skipped like one that returns nothing
  const errors = [];
  const failing = new RehearsalRun([() => { throw new Error('no battle'); }, battle(res(0, 3))], 'p', 10, { onError: (e, i) => errors.push([e.message, i]) });
  failing.run();
  assert.deepEqual(errors, [['no battle', 0]]);
  assert.equal(failing.score.index, 1);
  // a candidate a slice stops in the middle of keeps its battle: the factory runs once and the second slice scores it
  const built2 = [];
  const across = new RehearsalRun([() => { built2.push(0); return stepping(res(0, 9)); }], 'p', 8);
  assert.equal(across.run(() => true), false, 'the budget stopped the slice after 4 of the 8 ticks');
  assert.equal(across.run(), true);
  assert.deepEqual(built2, [0], 'the candidate was built once, not once per slice');
  assert.equal(across.score.leaks, 0, 'the candidate was scored by the slice that finished it');
  assert.equal(across.score.score, 9);
});

test('a candidate the slice never steps cannot run the whole list past the caller\'s budget', () => {
  const res = (n, killed) => ({ perPlayer: { p: { killed, total: 9, leaked: Array.from({ length: n }, () => ({ enemyKey: 'e', counted: true })) } } });
  const battle = (r) => () => ({ finished: true, result: () => r, forceEnd() {}, step() {} });
  // three candidates that end without a single tick (finished on arrival): no tick, but each one is consumed work, so
  // the budget is asked at the candidate boundary all the same
  let checks = 0;
  const done = new RehearsalRun([battle(res(0, 3)), battle(res(0, 2)), battle(res(0, 1))], 'p', 10);
  assert.equal(done.run(() => { checks++; return true; }), false, 'the slice stops at the first candidate boundary');
  assert.equal(checks, 1, 'the budget was consulted once, though not one tick was stepped');
  assert.equal(done.score.index, 0, 'the candidate the slice did consume counts');
  assert.equal(done.run(() => false), true);
  // the same for candidates that cannot be built at all (nothing, or a factory that threw): they are skipped, the slice
  // still ends on the budget instead of building the rest of the list
  const errors = [];
  let checks2 = 0;
  const unbuilt = new RehearsalRun([() => null, () => { throw new Error('no battle'); }, battle(res(1, 1))], 'p', 10, { onError: (e, i) => errors.push(i) });
  assert.equal(unbuilt.run(() => { checks2++; return true; }), false);
  assert.equal(checks2, 1);
  assert.deepEqual(errors, [], 'nothing of the third candidate ran yet');
  assert.equal(unbuilt.run(() => false), true);
  assert.deepEqual(errors, [1]);
  assert.equal(unbuilt.score.index, 2);
});
