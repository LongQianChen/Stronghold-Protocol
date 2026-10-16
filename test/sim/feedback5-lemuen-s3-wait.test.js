// Community report (0.2.0, relayed by the owner): 「蕾缪安3技能范围里没人好像会自动结束」 — 蕾缪安's S3 礼炮·强制追思 ended by
// itself when nothing was left in her range. The kit ended the skill at the first lock tick with no enemy to lock (once
// it had locked one), so the bombardment fell at once and the bullets left were thrown away. Official: an ammo skill
// ends when its bullets are spent ("攻击装有5发弹药，打完后结束（可随时停止技能）"); in the client data her S3 lock needs a
// target and only the spent bullets end the skill buff (lemuen_s_3 → the S3_End bombardment mode); the 卫戍协议
// automation never stops a skill (PRTS 卫戍协议/帮助 技能操作: "通常不会自动关闭技能"). Now the skill waits — bullets and
// locks kept, the marks following their enemies — and locks the next enemy that comes into her range at once.
//
// Flat stage: 蕾缪安 on (10,3) faces right — her 3-9 range covers cols 3–7 on her row, 3–6 one row off, 3–5 two rows off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const LEM = 'chess_char_6_01_a';
const dummy = (key) => enemyRec({ key, hp: 1e7, speed: 0 });
const DEFS = {
  enemies: {
    enemy_dummy: dummy('enemy_dummy'), enemy_far: dummy('enemy_far'), enemy_late: dummy('enemy_late'),
    enemy_walker: enemyRec({ key: 'enemy_walker', hp: 1e7, speed: 1.5 }),
  },
};

/** 蕾缪安 with a full S3 at once (the harness has no battle-start operation cooldown); h.dmg / h.locks / h.shells logs. */
function lemuen(enemies, opts = {}) {
  const dmg = [], ends = [];
  const h = makeBattle({
    defs: DEFS, seed: 7, timeLimit: 200, units: [{ chessId: LEM, row: 10, col: 3, carryState: { sp: 99 } }], enemies,
    hooks: ['skillStart', 'skillEnd', 'ammoUsed'], ...opts,
    setup(b) {
      b.on('damaged', (c) => dmg.push({ src: c.source?.id ?? null, tgt: c.target.id, tags: c.dmg?.tags ?? [], t: b.time }), { priority: -999 });
      b.on('skillEnd', ({ unit, reason }) => { if (unit.defId === LEM) ends.push({ reason, t: b.time }); });
    },
  });
  const u = h.unit(LEM);
  const fxOf = (kind) => h.eventsOf('fx').filter((e) => e[1] === kind).map((e) => ({ x: e[2], y: e[3], t: e[4]?.t, ...e[4] }));
  return { h, u, dmg, ends, locks: () => fxOf('lock'), shells: () => fxOf('bombardShell'), bombs: () => dmg.filter((d) => d.src === u.id && d.tags.includes('bombard')) };
}
const inRange = (h, u) => h.b.enemiesInKeys(u.rangeKeys, u, u.profile);

test('the locked enemy dies and nothing else is in her range: S3 keeps running with its bullets and locks — no early bombardment', () => {
  const { h, u, ends, locks, shells, bombs } = lemuen([{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_far', pos: [10, 9] }]);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'S3 cast');
  const full = u.skill.ammoMax;
  assert.ok(h.runUntil(() => u.skill.ammoLeft === full - 2, 5), 'two locks');
  h.b.kill(h.enemy('enemy_dummy'));
  assert.equal(inRange(h, u).length, 0, 'nothing left in her range (enemy_far on (10,9) is out of it)');
  h.run(10);
  assert.equal(u.skill.active, true, 'the skill waits (the report: it ended by itself)');
  assert.deepEqual(ends, [], 'no skill end');
  assert.equal(u.skill.ammoLeft, full - 2, 'the bullets left are kept');
  assert.equal(locks().length, 2, 'no new lock without a target');
  assert.equal(shells().length, 0, 'no shell before the skill ends');
  assert.equal(bombs().length, 0, 'no bombardment');
  assert.equal(u.skill.sp, 0, 'no SP while the ammo skill runs');
  assert.equal(u.mem.lemLocks.length, 2, 'the locks are kept');
  assert.ok(locks().every((l) => l.hold === 1), 'fx lock `hold`: the renderer keeps these reticles up while her skill runs');
  checkInvariants(h.b);
});

test('a locked walker leaves her range: the skill waits; the next enemy that comes is locked at once, and the spent bullets bomb every mark — the walker where it is now', () => {
  // from 5.3: it leaves before her fifth lock — her range takes it until its 0.1 collider is past col 6 (x > 6.6)
  const { h, u, ends, locks, shells, bombs, dmg } = lemuen([{ key: 'enemy_walker', route: { motion: 'WALK', start: [9, 5.3], end: [9, 10], checkpoints: [] } }]);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'S3 cast');
  const walker = h.enemy('enemy_walker');
  const full = u.skill.ammoMax;
  assert.ok(h.runUntil(() => inRange(h, u).length === 0, 10), 'the walker walks out of her range');
  const left = u.skill.ammoLeft;
  assert.ok(left > 0 && left < full, `locked it ${full - left} times, ${left} bullet(s) left`);
  h.run(3);
  assert.equal(u.skill.active, true, 'S3 waits with nothing in range');
  assert.equal(u.skill.ammoLeft, left, 'bullets kept');
  assert.ok(walker.alive && inRange(h, u).length === 0, 'the walker is still out of her range');
  // the next enemy in range is locked the moment it comes (her lock is ready), every 0.5 s after that
  const late = h.spawn('enemy_late', { pos: [10, 6] });
  const t0 = h.b.time;
  h.step();
  const first = locks().find((l) => l.id === late.id);
  assert.ok(first, 'the newcomer is locked on the next tick');
  assert.ok(h.runUntil(() => !u.skill.active, 10), 'the skill ends once the bullets are spent');
  assert.deepEqual(ends.map((e) => e.reason), ['ammo']);
  assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, full, 'every bullet spent on a lock');
  assert.ok(h.b.time - t0 <= (left - 1) * u.def.skill.bb['attack@aim_interval'] + 0.1, 'the newcomer took the bullets left, 0.5 s apart');
  // the shells follow in lock order: the walker's marks first (it is followed out of her range), then the newcomer's
  const walkerLocks = full - left;
  h.run(0.3 * (full + 2));
  const s = shells();
  assert.equal(s.length, full, 'one shell per lock');
  const spread = u.def.skill.bb['attack@emit_offset'] + 0.01;
  for (let i = 0; i < walkerLocks; i++) assert.ok(s[i].x > 6.5, `shell ${i} falls on the walker out of her range (x ${s[i].x.toFixed(2)})`);
  for (let i = walkerLocks; i < full; i++) assert.ok(Math.abs(s[i].x - 6) <= spread && Math.abs(s[i].y - 10) <= spread, `shell ${i} on the newcomer`);
  assert.equal(bombs().filter((d) => d.tgt === walker.id).length, walkerLocks, 'the walker is hit by its own shells only');
  assert.equal(bombs().filter((d) => d.tgt === late.id).length, left, 'the newcomer by its own');
  assert.equal(dmg.filter((d) => d.src === u.id && !d.tags.includes('bombard') && d.t < ends[0].t).length, 0, 'no normal attack during S3');
  checkInvariants(h.b);
});

test('the last enemy dies while she waits: the battle ends cleared, nothing more to bomb, no error', () => {
  const { h, u, shells } = lemuen([{ key: 'enemy_dummy', pos: [10, 5] }]);
  assert.ok(h.runUntil(() => u.skill.active && u.mem.lemLocks?.length === 2, 5), 'two locks');
  h.b.kill(h.enemy('enemy_dummy'));
  assert.ok(h.runUntil(() => h.b.finished, 5), 'the battle ends');
  assert.equal(h.result().reason, 'cleared');
  assert.equal(shells().length, 0, 'no shell after the battle');
  assert.deepEqual(h.b.contentErrors ?? [], []);
  checkInvariants(h.b);
});
