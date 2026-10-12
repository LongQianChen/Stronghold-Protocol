// 追凶's first damage instance also carries its arts addition (PRTS 忍冬, talent remarks).
// Real full-content battles with controlled durable enemies; no HP/SP/ATK writes or forced casts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const NORMAL = 'chess_char_3_18_a';
const ELITE = 'chess_char_3_18_b';
const ENEMY = 'enemy_vulpis_probe';
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const hunt = (c) => c.dmg?.tags?.includes('vulpisHunt');
const finished = (h) => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };
function scenario(entry = {}, enemy = {}) {
  return makeBattle({
    units: [{ chessId: NORMAL, row: 10, col: 4, ...entry }],
    defs: { enemies: { [ENEMY]: enemyRec({ key: ENEMY, hp: 1e7, speed: 0, ...enemy }) } },
    autoFinish: false, timeLimit: 40, flags: { startOpCooldown: 3 }, hooks: ['damaged'], captureNoisy: true,
  });
}
const variants = [
  { label: 'normal', chessId: NORMAL },
  { label: 'elite without module', chessId: ELITE, moduleId: 'none' },
  { label: 'elite SOL-X', chessId: ELITE, moduleId: 'uniequip_002_vulpis' },
  { label: 'elite SOL-Y', chessId: ELITE, moduleId: 'uniequip_003_vulpis' },
];

for (const { label, ...entry } of variants) for (const skillIndex of [0, 1, 2]) {
  test(`追凶: first ordinary hit includes one arts addition (${label}, S${skillIndex + 1})`, () => {
    const h = scenario({ ...entry, skillIndex });
    h.step();
    const u = h.unit(entry.chessId);
    if (entry.moduleId) assert.equal(u.def.loadout.moduleId, entry.moduleId, 'the requested module is equipped');
    const e = h.spawn(ENEMY, { pos: [10, 5] });
    const hp = e.hp;
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u), 1));
    const hits = h.hooksOf('damaged').filter((c) => c.source === u);
    const main = hits.filter((c) => !hunt(c));
    assert.equal(main.length, 1, 'one ordinary attack');
    assert.equal(main[0].dmg.isSkill, false, 'no skill at the first hit');
    assert.equal(main[0].type, 'phys');
    assert.ok(e.alive && e.hp > 0, 'the first attack did not kill the target');
    const riders = hits.filter(hunt);
    assert.equal(riders.length, 1, 'the very first hit carries 追凶');
    assert.equal(riders[0].t, main[0].t);
    assert.equal(riders[0].type, 'arts');
    assert.ok(riders[0].dmg.tags.includes('addition'));
    approx(riders[0].amount, u.s.atk * u.def.talents[0].bb.atk_scale);
    approx(hp - e.hp, main[0].amount + riders[0].amount);
    assert.equal(h.eventsOf('dmg').filter((c) => c[1] === e.id).length, 2, 'both actual damage events exist');
    finished(h);
  });
}

for (const chessId of [NORMAL, ELITE]) for (const skillIndex of [0, 1, 2]) {
  test(`追凶: first skill damage carries its addition (${chessId}, S${skillIndex + 1})`, () => {
    const h = scenario({ chessId, skillIndex });
    h.run(16); // every selected skill is naturally ready, with no enemies yet
    const u = h.unit(chessId);
    const e = h.spawn(ENEMY, { pos: [10, skillIndex === 1 ? 7 : skillIndex === 2 ? 6 : 5] });
    const hp = e.hp;
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isSkill), 2));
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e);
    const main = hits.filter((c) => !hunt(c));
    assert.ok(main.some((c) => c.dmg.isSkill));
    // S1 has a physical attack and a separate arts skill instance; S2/S3 have one main instance each.
    assert.equal(main.length, skillIndex === 0 ? 2 : 1);
    const riders = hits.filter(hunt);
    assert.equal(riders.length, main.length, 'one addition per qualifying damage instance, including the first');
    for (const c of riders) approx(c.amount, u.s.atk * u.def.talents[0].bb.atk_scale);
    approx(hp - e.hp, hits.reduce((s, c) => s + c.amount, 0));
    assert.ok(e.alive && e.hp > 0);
    finished(h);
  });
}

test('追凶: each enemy starts its own fixed window; repeated damage does not extend it', () => {
  const h = scenario();
  h.step();
  const u = h.unit(NORMAL);
  const e = h.spawn(ENEMY, { pos: [10, 5] });
  h.run(12);
  const main = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && !hunt(c));
  const riders = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && hunt(c));
  assert.ok(main.some((c) => c.t > main[0].t + 10));
  assert.equal(riders.length, main.filter((c) => c.t - main[0].t <= 10 + 1e-9).length);
  assert.ok(riders.every((c) => c.t - main[0].t <= 10 + 1e-9));
  const another = h.spawn(ENEMY, { pos: [10, 6] });
  // Naturally ready S3 can reach both enemies; the new target gets its own first-hit addition.
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.target === another), 10));
  const first = h.hooksOf('damaged').filter((c) => c.target === another);
  assert.equal(first.filter(hunt).length, 1);
  assert.equal(first.filter(hunt)[0].t, first.find((c) => !hunt(c)).t);
  finished(h);
});
