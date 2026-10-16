// test/content/dsl.test.js — P2 DSL-lite (DESIGN §32.7): the validator agrees with schemas/dsl.schema.json,
// compileDsl throws the PLUGIN_DSL_* code, five official effects match the official kit on the same battle,
// the action budget stops only that plugin, and a dsl-tagged hit does not re-enter hitDealt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { compileDsl } from '../../server/sim/content/dsl/compile.js';
import { validateDsl } from '../../server/sim/content/dsl/validate.js';
import { budgetUsed } from '../../server/sim/content/dsl/budget.js';
import {
  TRIGGERS, CONDITIONS, ACTIONS, TARGETS, META_TRIGGERS, META_ACTIONS, VALUE_OPS, SKILL_KINDS, STAT_NAMES, TICK,
} from '../../server/sim/content/dsl/vocab.js';

const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../schemas/dsl.schema.json'), 'utf8'));
const LIMITS = schema.definitions.limits.properties;
const ajv = new Ajv({ allErrors: true, strict: false });
const schemaValidate = ajv.compile(schema);

function schemaOk(spec) {
  const copy = JSON.parse(JSON.stringify(spec));
  return schemaValidate(copy) === true;
}

const SKGOAT = {
  dsl: 1, pluginId: 'rewrite-skgoat',
  skill: { kind: 'duration', mods: { atkPct: { bb: 'atk' } } },
};
const INSIDE = {
  dsl: 1, pluginId: 'rewrite-inside',
  skill: {
    kind: 'ammo', ammo: { bb: 'attack@trigger_time' },
    mods: { atkPct: { bb: 'atk' }, batPct: { batMod: { bb: 'base_attack_time' } }, taunt: -1 },
    targeting: { priority: 'ranged' },
  },
};
const TEXAS = {
  dsl: 1, pluginId: 'rewrite-texas',
  skill: {
    kind: 'instant',
    targeting: { rangeGrid: 'skill', noRangeExtend: true },
    on: { start: [
      { dp: { amount: { bb: 'cost' }, fx: true } },
      { fx: { kind: 'aoe', radius: 2, skill: 'swordRain' } },
      { damage: {
        target: 'enemiesInRange', times: 2, type: 'arts', isSkill: true, tags: ['skill'],
        amount: { mul: [{ stat: 'atk' }, { bb: 'atk_scale' }] },
        then: [{ status: { target: 'target', key: 'stun', duration: { bb: 'stun' } } }],
      } },
    ] },
  },
  talents: [{ when: 'battleStart', do: [{ dp: { amount: { talent: [0, 'cost'] }, fx: false } }] }],
};
const KAZEMA = {
  dsl: 1, pluginId: 'rewrite-kazema',
  skill: {
    kind: 'duration', mods: { atkPct: { bb: 'atk' } },
    on: { start: [
      { damage: { target: 'self', lose: true, minRemain: 1, amount: { mul: [{ stat: 'hp' }, { bb: 'hp_ratio' }] } } },
      { spawnToken: {
        token: { override: true, match: ['shadow', 'doll'], fallback: 'token_10022_kazema_shadow' },
        tile: 'around', mem: 'doll', fx: true,
      } },
      { fx: { kind: 'aoe', at: 'lastSpawn', radius: 1.5, skill: 'origami' } },
      { damage: {
        target: { enemiesInRadius: 1, at: 'lastSpawn', shape: 'chebyshev', includeStealth: true },
        from: 'lastSpawn', type: 'arts', isSkill: true, canDodge: false, tags: ['talent'],
        amount: { mul: [{ stat: 'atk', of: 'lastSpawn' }, { talent: [0, 'damage_scale'] }] },
      } },
    ] },
  },
};

function kitOfSpec(spec) {
  return (bb, chess, def) => compileDsl(spec, { bb, chess, def, pluginId: spec.pluginId });
}

function picture(h) {
  const b = h.battle;
  const op = h.allies().find((u) => u.kind === 'op') || h.allies()[0] || null;
  return {
    events: h.events,
    op: op ? { id: op.defId, hp: op.hp, dmg: op.stats ? op.stats.dmg : null, ammo: op.skill ? op.skill.ammoLeft : null } : null,
    enemies: b.units.filter((u) => u.side === 'enemy').map((u) => [u.defId, u.alive, u.hp]),
    tokens: b.allyUnits.filter((u) => u.kind === 'token').map((u) => [u.defId, u.tileR, u.tileC, u.alive, u.hp]),
    dp: b.getPlayer('p1').dp,
    errors: (b.errors || []).map((e) => e.label),
    result: b.finished ? b.result() : null,
  };
}

function assertSame(off, dsl, label) {
  const a = picture(off);
  const b = picture(dsl);
  assert.deepEqual(b.op, a.op, label + ' operator');
  assert.deepEqual(b.enemies, a.enemies, label + ' enemies');
  assert.deepEqual(b.tokens, a.tokens, label + ' tokens');
  assert.equal(b.dp, a.dp, label + ' dp');
  assert.deepEqual(b.errors, a.errors, label + ' errors');
  assert.deepEqual(b.result, a.result, label + ' result');
  assert.equal(b.events.length, a.events.length, `${label} event count official ${a.events.length} dsl ${b.events.length}`);
  for (let i = 0; i < a.events.length; i++) {
    assert.deepEqual(b.events[i], a.events[i], `${label} event ${i}\nofficial ${JSON.stringify(a.events[i])}\ndsl ${JSON.stringify(b.events[i])}`);
  }
}

function fight(chessId, spec, { pos, after, before = 1 }) {
  const base = {
    seed: 3, autoFinish: false, timeLimit: 40, content: 'full',
    units: [{ chessId, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1422_lrsldr', time: 0, pos }],
  };
  const play = (extra) => {
    const h = makeBattle({ ...base, ...extra });
    h.step(before);
    const u = h.allies()[0];
    assert.equal(u.skill.activate('test', { free: true }), true, chessId + ' activate');
    if (after) h.run(after);
    else h.step(2);
    return h;
  };
  return [play({}), play({ kits: { [chessId]: kitOfSpec(spec) } })];
}

test('schema enums are the compiler vocabulary', () => {
  const d = schema.definitions;
  assert.deepEqual(d.trigger.enum, [...TRIGGERS]);
  assert.deepEqual(d.condition.enum, [...CONDITIONS]);
  assert.deepEqual(d.action.enum, [...ACTIONS]);
  assert.deepEqual(d.target.enum, [...TARGETS]);
  assert.deepEqual(d.metaTrigger.enum, [...META_TRIGGERS]);
  assert.deepEqual(d.metaAction.enum, [...META_ACTIONS]);
  assert.deepEqual(d.valueOp.enum, [...VALUE_OPS]);
  assert.deepEqual(d.skillKind.enum, [...SKILL_KINDS]);
  assert.deepEqual(d.stat.enum, [...STAT_NAMES]);
  assert.equal(LIMITS.tickDenominator.const, Math.round(1 / TICK));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
});

const PREP_DEMO = {
  dsl: 1, pluginId: 'prepdemo',
  meta: {
    key: 'effect:prepdemo:demo',
    on: [
      { when: 'roundStart', do: [{ funds: { amount: 4 } }] },
      { when: 'buy', do: [{ layers: { bond: 'lateranoShip', amount: 2 } }] },
      { when: 'sell', do: [{ gainItem: { item: 'chess_item_1_01_e' } }] },
      { when: 'income', if: { round: 9 }, do: [{ funds: { amount: 3, setIncome: true } }] },
    ],
  },
};
const LEE_KEY = {
  dsl: 1, pluginId: 'rewrite-lmlee',
  meta: {
    key: 'effect:rewrite-lmlee:income',
    on: [{ when: 'income', if: { round: 3 }, do: [{ funds: { amount: 15, setIncome: true } }] }],
  },
};

test('validator and schema agree on the fixtures, and compileDsl throws the code', () => {
  const fixtures = [
    ['duration skill', SKGOAT, null],
    ['inside', INSIDE, null],
    ['texas', TEXAS, null],
    ['kazema', KAZEMA, null],
    ['prep demo', PREP_DEMO, null],
    ['lee key', LEE_KEY, null],
    ['every tick', { dsl: 1, talents: [{ when: 'every', seconds: 1 / 30, do: [{ dp: { amount: 1 } }] }] }, null],
    ['div ok', { dsl: 1, skill: { kind: 'instant', on: { start: [{ damage: { target: 'self', amount: { div: [0, 2] } } }] } } }, null],
    ['one value op', { dsl: 1, skill: { kind: 'duration', mods: { atkPct: { bb: 'atk', default: 0 } } } }, null],
    ['stat of', { dsl: 1, skill: { kind: 'duration', mods: { atkPct: { stat: 'atk', of: 'self' } } } }, null],
    ['version', { dsl: 2, skill: { kind: 'duration' } }, 'PLUGIN_DSL_VERSION'],
    ['every', { dsl: 1, talents: [{ when: 'every', seconds: 0.01, do: [{ dp: { amount: 1 } }] }] }, 'PLUGIN_DSL_EVERY'],
    ['trigger', { dsl: 1, talents: [{ when: 'nope', do: [{ dp: { amount: 1 } }] }] }, 'PLUGIN_DSL_TRIGGER'],
    ['div0', { dsl: 1, skill: { kind: 'instant', on: { start: [{ damage: { target: 'self', amount: { div: [1, 0] } } }] } } }, 'PLUGIN_DSL_DIV0'],
    ['budget', { dsl: 1, budget: 0, skill: { kind: 'instant' } }, 'PLUGIN_DSL_BUDGET'],
    ['plugin id', { dsl: 1, pluginId: 'has space', skill: { kind: 'instant' } }, 'PLUGIN_DSL_PLUGIN_ID'],
    ['loop', { dsl: 1, loop: true, skill: { kind: 'instant' } }, 'PLUGIN_DSL_LOOP'],
    ['double then', { dsl: 1, skill: { kind: 'instant', on: { start: [{ damage: { target: 'self', amount: 1, then: [{ dp: { amount: 1 } }] }, then: [{ dp: { amount: 1 } }] }] } } }, 'PLUGIN_DSL_ACTION'],
    ['two value ops', { dsl: 1, skill: { kind: 'duration', mods: { atkPct: { bb: 'atk', mul: [2, 3] } } } }, 'PLUGIN_DSL_VALUE'],
    ['band key', { dsl: 1, meta: { key: 'band:band_lmlee', on: [] } }, 'PLUGIN_DSL_META'],
    ['global key', { dsl: 1, meta: { key: 'global:everyone', on: [] } }, 'PLUGIN_DSL_META'],
    ['effect key without a local name', { dsl: 1, meta: { key: 'effect:dsl-my-plugin', on: [] } }, 'PLUGIN_DSL_META'],
  ];
  for (const [name, spec, code] of fixtures) {
    const checked = validateDsl(spec);
    const fromSchema = schemaOk(spec);
    if (code == null) {
      assert.equal(checked.ok, true, name + ' ' + JSON.stringify(checked.problems));
      assert.equal(fromSchema, true, name + ' schema ' + JSON.stringify(schemaValidate.errors));
    } else {
      assert.equal(checked.ok, false, name);
      assert.equal(checked.problems[0].code, code, name + ' ' + JSON.stringify(checked.problems));
      assert.ok(checked.problems[0].zh, name + ' zh');
      assert.equal(fromSchema, false, name + ' schema accepted a spec the validator rejects');
      assert.throws(() => compileDsl(spec, { pluginId: 'hostonly' }), (e) => e instanceof Error && String(e.message).includes(code) && e.code === code);
    }
  }
});

test('地灵 duration skill matches the official kit', () => {
  const [off, dsl] = fight('chess_char_1_11_a', SKGOAT, { pos: [10, 6], after: 3 });
  assert.ok(off.events.some((e) => e[0] === 'dmg'), 'official window has damage');
  assertSame(off, dsl, '地灵');
});

test('隐现 ammo skill matches the official kit inside the talent window', () => {
  const [off, dsl] = fight('chess_char_1_01_a', INSIDE, { pos: [10, 6], after: 3 });
  assert.ok(off.battle.time < 20, 'window stays under the 20s talent');
  assert.ok(off.events.some((e) => e[0] === 'dmg'), 'official window has damage');
  assert.ok(off.allies()[0].skill.ammoLeft < off.allies()[0].skill.ammo, 'ammo was spent');
  assertSame(off, dsl, '隐现');
});

test('德克萨斯 sword rain and the battle-start talent match the official kit', () => {
  const [off, dsl] = fight('chess_char_1_08_a', TEXAS, { pos: [10, 4], after: 1 });
  assert.ok(off.events.some((e) => e[0] === 'dmg' && e[3] === 'arts'), 'official sword rain deals arts');
  assert.ok(off.battle.getPlayer('p1').dp > 10, 'talent and skill both add DP');
  assertSame(off, dsl, '德克萨斯');
});

test('风丸 summon matches the official kit before the skill ends', () => {
  // [9, 18] is outside both the operator circle and the summon's chebyshev-1 splash, so this compare
  // does not prove the origami hit. The splash case is the next test. onEnd retreat is still not a verb.
  const [off, dsl] = fight('chess_char_2_11_a', KAZEMA, { pos: [9, 18], after: 3 });
  assert.ok(off.battle.time < 20, 'window stops before onEnd retreats the token');
  const tok = off.battle.allyUnits.find((u) => u.kind === 'token');
  assert.ok(tok && tok.alive, 'official summon is on the field');
  assert.ok(off.events.some((e) => e[0] === 'dmg' && e[3] === 'true'), 'official self loss');
  assertSame(off, dsl, '风丸');
});

test('the action budget stops only that plugin and records plugin:<id> once', () => {
  const id = 'dsl_budget_a';
  const spec = {
    dsl: 1, pluginId: 'budgetplug', budget: 3,
    talents: [{ when: 'every', seconds: 1 / 30, do: [{ dp: { amount: 1 } }] }],
  };
  const h = makeBattle({
    seed: 1, content: 'generic', autoFinish: false, timeLimit: 5,
    // Natural DP is 1 per second. Turn it off so the delta is only this plugin's three grants.
    flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 5 }],
    defs: { chess: { [id]: chessRec({ id, profession: 'WARRIOR', stats: { atk: 100, bat: 2 } }) } },
    kits: { [id]: kitOfSpec(spec) },
  });
  const dp0 = h.battle.getPlayer('p1').dp;
  h.run(0.5);
  const labels = h.battle.errors.filter((e) => e.label === 'plugin:budgetplug');
  assert.equal(h.battle.getPlayer('p1').dp - dp0, 3);
  assert.equal(labels.length, 1);
  assert.equal(h.battle.finished, false);
  assert.equal(h.battle.errors.filter((e) => String(e.label).startsWith('plugin:')).length, 1);
});

test('dsl damage does not re-enter hitDealt', () => {
  const id = 'dsl_re_a';
  const spec = {
    dsl: 1, pluginId: 'reentry',
    talents: [{ when: 'hitDealt', do: [{ damage: { target: 'target', amount: 50, type: 'true' } }] }],
  };
  const h = makeBattle({
    seed: 2, content: 'generic', autoFinish: false, timeLimit: 8, captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_re', time: 0, pos: [10, 6] }],
    defs: {
      chess: { [id]: chessRec({ id, profession: 'WARRIOR', stats: { atk: 200, bat: 1 }, rangeGrid: [[0, 0], [0, 1]] }) },
      enemies: { enemy_re: enemyRec({ key: 'enemy_re', hp: 100000, atk: 0 }) },
    },
    kits: { [id]: kitOfSpec(spec) },
  });
  h.run(2.5);
  const hits = h.hooksOf('hit').filter((c) => c.source && c.source.defId === id);
  const tagged = hits.filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('dsl'));
  const plain = hits.filter((c) => !(c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('dsl')));
  assert.ok(plain.length > 0, 'the operator landed a hit');
  assert.equal(tagged.length, plain.length);
  assert.equal(h.battle.errors.filter((e) => String(e.label).startsWith('hookDepth')).length, 0);
});

test('a spec pluginId cannot spend another plugin budget', () => {
  const victim = {
    dsl: 1, pluginId: 'goodplug',
    talents: [{ when: 'deploy', do: [{ buff: { target: 'self', key: 'keep', duration: 30, mods: { atkFlat: 50 } } }] }],
  };
  const evil = {
    dsl: 1, pluginId: 'goodplug', budget: 2,
    talents: [{ when: 'every', seconds: 1 / 30, do: [{ dp: { amount: 1 } }] }],
  };
  assert.throws(
    () => compileDsl(evil, { pluginId: 'evilplug' }),
    (e) => e.code === 'PLUGIN_DSL_PLUGIN_ID' && String(e.message).includes('PLUGIN_DSL_PLUGIN_ID'),
  );
  assert.throws(() => compileDsl(victim, {}), (e) => e.code === 'PLUGIN_DSL_PLUGIN_ID');
  assert.throws(
    () => compileDsl(victim, { pluginId: 'goodplug', def: { raw: { pluginId: 'otherplug' } } }),
    (e) => e.code === 'PLUGIN_DSL_PLUGIN_ID',
  );
  const fromDef = compileDsl(victim, { def: { raw: { pluginId: 'goodplug' } } });
  assert.ok(fromDef.talents && fromDef.talents.length === 1);
  const idV = 'dsl_good';
  const idE = 'dsl_evil';
  const rec = (id) => chessRec({ id, profession: 'WARRIOR', stats: { atk: 100, bat: 2 } });
  const h = makeBattle({
    seed: 1, content: 'generic', autoFinish: false, timeLimit: 5,
    flags: { dpPerSec: 0 },
    units: [{ chessId: idV, row: 10, col: 5 }, { chessId: idE, row: 10, col: 6 }],
    defs: { chess: { [idV]: rec(idV), [idE]: rec(idE) } },
    kits: {
      [idV]: (bb, chess, def) => compileDsl(victim, { bb, chess, def, pluginId: 'goodplug' }),
      [idE]: (bb, chess, def) => compileDsl(
        { ...evil, pluginId: 'evilplug' },
        { bb, chess, def, pluginId: 'evilplug' },
      ),
    },
  });
  h.step(1);
  h.run(0.4);
  const v = h.allies().find((u) => u.defId === idV);
  const buff = v.findBuff('keep');
  assert.ok(buff, 'victim buff remains after the other plugin cuts off');
  assert.ok(buff.tags.includes('plugin:goodplug'));
  assert.notEqual(v.s.atk, 100);
  assert.ok(budgetUsed(h.battle, 'evilplug') > 0);
  assert.notEqual(budgetUsed(h.battle, 'goodplug'), budgetUsed(h.battle, 'evilplug'));
  assert.equal(h.battle.errors.filter((e) => e.label === 'plugin:goodplug').length, 0);
  assert.equal(h.battle.errors.filter((e) => e.label === 'plugin:evilplug').length, 1);
});

test('风丸 origami hits the summon neighbour and a stealthed enemy', () => {
  const chessId = 'chess_char_2_11_a';
  const base = {
    seed: 3, autoFinish: false, timeLimit: 40, content: 'full',
    units: [{ chessId, row: 10, col: 5 }],
    enemies: [
      { key: 'enemy_1422_lrsldr', time: 0, pos: [9, 7] },
      { key: 'enemy_1422_lrsldr', time: 0, pos: [11, 5] },
    ],
  };
  const play = (extra) => {
    const h = makeBattle({ ...base, ...extra });
    h.step(1);
    const hidden = h.battle.units.find((u) => u.side === 'enemy' && u.tileR === 11 && u.tileC === 5);
    assert.ok(hidden, 'stealth enemy is on [11, 5]');
    h.battle.addBuff(hidden, { key: 'probe-stealth', flags: { stealth: true } });
    assert.equal(hidden.s.flags.stealth, true);
    const u = h.allies()[0];
    assert.equal(u.skill.activate('test', { free: true }), true);
    h.step(0);
    return h;
  };
  const off = play({});
  const dsl = play({ kits: { [chessId]: kitOfSpec(KAZEMA) } });
  const at = (h, r, c) => {
    const e = h.battle.units.find((u) => u.side === 'enemy' && u.tileR === r && u.tileC === c);
    assert.ok(e, `enemy at ${r},${c}`);
    return e;
  };
  const farOff = at(off, 9, 7);
  const hidOff = at(off, 11, 5);
  assert.ok(off.events.some((e) => e[0] === 'dmg' && e[3] === 'arts'), 'official arts');
  assert.ok(farOff.hp < farOff.s.maxHp, 'neighbour of the summon took damage');
  assert.ok(hidOff.hp < hidOff.s.maxHp, 'stealthed enemy took damage');
  assert.equal(at(dsl, 9, 7).hp, farOff.hp);
  assert.equal(at(dsl, 11, 5).hp, hidOff.hp);
  assert.equal(dsl.events.length, off.events.length);
  for (let i = 0; i < off.events.length; i++) {
    assert.deepEqual(dsl.events[i], off.events[i], `splash event ${i}\nofficial ${JSON.stringify(off.events[i])}\ndsl ${JSON.stringify(dsl.events[i])}`);
  }
  assert.ok(off.battle.time < 20);
  const tok = dsl.battle.allyUnits.find((u) => u.kind === 'token');
  assert.ok(tok && tok.alive, 'DSL summon is still up; onEnd retreat is not a verb');
});

test('always waits until the first deploy when the unit is not alive yet', () => {
  const id = 'dsl_always_a';
  const spec = {
    dsl: 1, pluginId: 'alwaysplug',
    talents: [{ when: 'always', do: [
      { buff: { target: 'self', key: 'keep', duration: 30, mods: { atkFlat: 11 } } },
      { spawnToken: { token: 'token_10022_kazema_shadow', tile: 'around' } },
    ] }],
  };
  const rec = chessRec({ id, profession: 'WARRIOR', stats: { atk: 100, bat: 2 } });
  const h = makeBattle({
    seed: 3, content: 'full', autoFinish: false, timeLimit: 5,
    units: [{ chessId: id, row: 10, col: 5 }],
    defs: { chess: { [id]: rec } },
    kits: { [id]: kitOfSpec(spec) },
  });
  const u0 = h.battle.allyUnits[0];
  assert.equal(u0.alive, false);
  assert.equal(u0.buffs.filter((b) => b.key === 'keep').length, 0);
  assert.equal(h.battle.allyUnits.filter((u) => u.kind === 'token').length, 0);
  h.step(1);
  const u = h.allies().find((x) => x.defId === id);
  assert.equal(u.alive, true);
  const keep = u.findBuff('keep');
  assert.ok(keep, 'always buff is on the deployed operator');
  assert.equal(keep.mods.atkFlat, 11);
  assert.notEqual(u.s.atk, 100);
  const tok = h.battle.allyUnits.find((x) => x.kind === 'token');
  assert.ok(tok);
  const specDeploy = {
    dsl: 1, pluginId: 'alwaysplug',
    talents: [{ when: 'deploy', do: [{ spawnToken: { token: 'token_10022_kazema_shadow', tile: 'around' } }] }],
  };
  const h2 = makeBattle({
    seed: 3, content: 'full', autoFinish: false, timeLimit: 5,
    units: [{ chessId: id, row: 10, col: 5 }],
    defs: { chess: { [id]: rec } },
    kits: { [id]: kitOfSpec(specDeploy) },
  });
  h2.step(1);
  const tok2 = h2.battle.allyUnits.find((x) => x.kind === 'token');
  assert.deepEqual([tok.tileR, tok.tileC], [tok2.tileR, tok2.tileC]);
  const live = {
    dsl: 1, pluginId: 'liveplug',
    talents: [{ when: 'always', do: [{ buff: { target: 'self', key: 'live', mods: { atkFlat: 7 } } }] }],
  };
  const h3 = makeBattle({
    seed: 3, content: 'generic', autoFinish: false, timeLimit: 5,
    units: [{ chessId: id, row: 10, col: 5 }],
    defs: { chess: { [id]: rec } },
    kits: { [id]: () => ({}) },
  });
  h3.step(1);
  const unit = h3.allies()[0];
  const before = unit.s.atk;
  const kit = compileDsl(live, { pluginId: 'liveplug' });
  for (const t of kit.talents) t.install(h3.battle, unit);
  assert.ok(unit.findBuff('live'));
  assert.equal(unit.s.atk, before + 7);
});

test('allAllies stays on the owner in a unite battle', () => {
  const idA = 'dsl_cross_a';
  const idB = 'dsl_cross_b';
  const spec = {
    dsl: 1, pluginId: 'crossplug',
    talents: [{ when: 'battleStart', do: [{ buff: { target: 'allAllies', key: 'cross', mods: { atkFlat: 3 } } }] }],
  };
  const rec = (id) => chessRec({ id, profession: 'WARRIOR', stats: { atk: 100, bat: 2 } });
  const h = makeBattle({
    seed: 1, kind: 'unite', content: 'generic', autoFinish: false, timeLimit: 5,
    defs: { chess: { [idA]: rec(idA), [idB]: rec(idB) } },
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: idA, row: 10, col: 5 }] },
      { playerId: 'p2', seat: 1, side: 'L', colOffset: 8, units: [{ uid: 2, chessId: idB, row: 10, col: 7 }] },
    ],
    kits: { [idA]: kitOfSpec(spec) },
  });
  h.step(2);
  const a = h.battle.allyUnits.find((u) => u.uid === 1);
  const b = h.battle.allyUnits.find((u) => u.uid === 2);
  assert.equal(a.alive, true);
  assert.equal(b.alive, true);
  assert.deepEqual([b.tileR, b.tileC], [10, 15]);
  assert.ok(a.findBuff('cross'));
  assert.equal(b.findBuff('cross'), null);
});

test('an absolute summon tile must be in rect, unreserved and standable', () => {
  const id = 'dsl_tile_a';
  const rec = chessRec({ id, profession: 'WARRIOR', stats: { atk: 100, bat: 2 } });
  const specAt = (tile, stop) => ({
    dsl: 1, pluginId: 'tileplug',
    talents: [{ when: 'deploy', do: [
      { spawnToken: { token: 'token_10022_kazema_shadow', tile, ...(stop ? { stop: true } : {}) } },
      { dp: { amount: 5 } },
    ] }],
  });
  const run = (extra, tile, stop) => {
    const h = makeBattle({
      seed: 1, content: 'full', autoFinish: false, timeLimit: 5,
      flags: { dpPerSec: 0 },
      units: [{ chessId: id, row: 10, col: 5 }],
      defs: { chess: { [id]: rec } },
      kits: { [id]: kitOfSpec(specAt(tile, stop)) },
      ...extra,
    });
    h.step(1);
    return {
      dp: h.battle.getPlayer('p1').dp,
      tokens: h.battle.allyUnits.filter((u) => u.kind === 'token'),
    };
  };
  const bad = { r: 9, c: 18 };
  const uniteOpen = run({ kind: 'unite' }, bad, false);
  const uniteHalt = run({ kind: 'unite' }, bad, true);
  assert.equal(uniteOpen.tokens.length, 0, '[9, 18] is a start tile and cannot stand');
  assert.equal(uniteHalt.tokens.length, 0);
  assert.equal(uniteOpen.dp - uniteHalt.dp, 5, 'only stop:true halts the following dp');
  const normalOpen = run({}, bad, false);
  assert.equal(normalOpen.tokens.length, 0);
  const stood = run({}, { r: 10, c: 6 }, false);
  assert.equal(stood.tokens.length, 1);
  assert.deepEqual([stood.tokens[0].tileR, stood.tokens[0].tileC], [10, 6]);
});

test('a value expression stops at 64 nodes or 64 levels', () => {
  const deep = (n) => {
    let e = 1;
    for (let i = 0; i < n; i++) e = { add: [e] };
    return e;
  };
  const specOf = (amount) => ({
    dsl: 1, pluginId: 'deepplug',
    skill: { kind: 'instant', on: { start: [{ dp: { amount } }] } },
  });
  assert.equal(validateDsl(specOf(deep(63))).ok, true, JSON.stringify(validateDsl(specOf(deep(63))).problems));
  const tooDeep = validateDsl(specOf(deep(8000)));
  assert.equal(tooDeep.ok, false);
  assert.ok(tooDeep.problems.some((p) => p.code === 'PLUGIN_DSL_LOOP' || p.code === 'PLUGIN_DSL_VALUE'));
  assert.throws(
    () => compileDsl(specOf(deep(8000)), { pluginId: 'deepplug' }),
    (e) => (e.code === 'PLUGIN_DSL_LOOP' || e.code === 'PLUGIN_DSL_VALUE') && !(e instanceof RangeError),
  );
  const wide = { add: Array.from({ length: 100 }, () => 1) };
  const tooWide = validateDsl(specOf(wide));
  assert.equal(tooWide.ok, false);
  assert.equal(tooWide.problems[0].code, 'PLUGIN_DSL_VALUE');
  assert.ok(tooWide.problems[0].zh.includes('取值节点超过 64 个'));
  const mixed = validateDsl({
    dsl: 1, pluginId: 'mix',
    skill: { kind: 'duration', mods: { atkPct: { bb: 'atk', mul: [2, 3] } } },
  });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.problems[0].code, 'PLUGIN_DSL_VALUE');
  assert.ok(mixed.problems.some((p) => p.zh.includes('取值对象恰好一个运算')));
});
