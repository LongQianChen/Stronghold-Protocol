// test/match/dsl-meta.test.js — prep half of the P2 DSL (DESIGN §32.7). 老鲤's income is a MetaRegistry
// dispatch, not a battle, so this file does not use battleHarness. The spec is built from the band's own
// give_coin_in_round rows. A second case checks funds / layers / gainItem on a fresh registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameData, buffsOf } from '../../server/sim/content/support/index.js';
import { bandMetaHandler } from '../../server/sim/content/bands/meta.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { compileDslMeta, registerDslMeta } from '../../server/match/dslMeta.js';
import { validateDsl } from '../../server/sim/content/dsl/validate.js';

function leeSpec() {
  const bands = gameData().bands;
  const id = Object.keys(bands).find((k) => buffsOf(bands[k]).some((b) => b.key === 'give_coin_in_round'));
  assert.equal(id, 'band_lmlee');
  const rows = buffsOf(bands[id]).filter((b) => b.key === 'give_coin_in_round');
  assert.deepEqual(rows.map((b) => ({ round: b.p.round, coin: b.p.coin })), [
    { round: 1, coin: 0 }, { round: 2, coin: 0 }, { round: 3, coin: 15 },
  ]);
  const spec = {
    dsl: 1,
    pluginId: 'rewrite-lmlee',
    meta: {
      key: 'effect:rewrite-lmlee:income',
      on: rows.map((b) => ({
        when: 'income',
        if: { round: Math.trunc(Number(b.p.round)) },
        do: [{ funds: { amount: Math.trunc(Number(b.p.coin)), setIncome: true } }],
      })),
    },
  };
  return { id, spec, official: bandMetaHandler(id) };
}

function incomeOf(handler, round, preset) {
  const ev = { income: preset };
  handler.onIncome({ round, rng: null }, ev);
  return ev.income;
}

test('老鲤 income matches bandMetaHandler, including a round that writes 0', () => {
  const { spec, official } = leeSpec();
  const checked = validateDsl(spec);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const dsl = compileDslMeta(spec, { pluginId: 'rewrite-lmlee' });
  for (const round of [1, 2, 3, 4]) {
    assert.equal(incomeOf(dsl, round, 7), incomeOf(official, round, 7), 'round ' + round);
  }
  assert.equal(incomeOf(dsl, 1, 7), 0);
  assert.equal(incomeOf(dsl, 2, 7), 0);
  assert.equal(incomeOf(dsl, 3, 7), 15);
  assert.equal(incomeOf(dsl, 4, 7), 7);
});

test('funds, layers and gainItem map onto the ctx helpers', () => {
  const spec = {
    dsl: 1,
    pluginId: 'prepdemo',
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
  const reg = new MetaRegistry();
  const handler = registerDslMeta(reg, spec, { pluginId: 'prepdemo' });
  assert.equal(reg.get('effect:prepdemo:demo'), handler);
  const funds = [];
  const layers = [];
  const items = [];
  const ctx = {
    round: 1,
    addFunds: (n) => funds.push(n),
    addLayers: (bond, n, opts) => layers.push([bond, n, opts && opts.reason]),
    grantItem: (id, opts) => items.push([id, opts && opts.source]),
  };
  handler.onRoundStart(ctx, {});
  handler.onBuy(ctx, {});
  handler.onSold(ctx, {});
  const ev = { income: 1 };
  handler.onIncome({ ...ctx, round: 4 }, ev);
  assert.deepEqual(funds, [4]);
  assert.deepEqual(layers, [['lateranoShip', 2, 'plugin:prepdemo']]);
  assert.deepEqual(items, [['chess_item_1_01_e', 'plugin:prepdemo']]);
  assert.equal(ev.income, 1, 'a round that does not match leaves income alone');
  const ev9 = { income: 1 };
  handler.onIncome({ ...ctx, round: 9 }, ev9);
  assert.equal(ev9.income, 3);
});

test('registerDslMeta does not replace an official band or global handler', () => {
  const reg = new MetaRegistry();
  const official = { onIncome() { return 'official'; } };
  reg.register('band:band_lmlee', official);
  reg.register('global:everyone', official);
  const spec = {
    dsl: 1,
    pluginId: 'mine',
    meta: {
      key: 'band:band_lmlee',
      on: [{ when: 'income', if: { round: -1 }, do: [{ funds: { amount: 1, setIncome: true } }] }],
    },
  };
  assert.throws(() => registerDslMeta(reg, spec, { pluginId: 'mine' }), (e) => e.code === 'PLUGIN_DSL_META');
  assert.equal(reg.get('band:band_lmlee'), official);
  const globalSpec = {
    ...spec,
    meta: { ...spec.meta, key: 'global:everyone' },
  };
  assert.throws(() => registerDslMeta(reg, globalSpec, { pluginId: 'mine' }), (e) => e.code === 'PLUGIN_DSL_META');
  assert.equal(reg.get('global:everyone'), official);
  const other = {
    dsl: 1,
    meta: {
      key: 'effect:officialplug:income',
      on: [{ when: 'income', do: [{ funds: { amount: 9 } }] }],
    },
  };
  assert.throws(() => registerDslMeta(reg, other, { pluginId: 'mine' }), (e) => e.code === 'PLUGIN_DSL_META');
  assert.equal(reg.get('effect:officialplug:income'), null);
  assert.equal(reg.get('band:band_lmlee'), official);
});

test('prep bondActive reads the ctx, and unit conditions are rejected', () => {
  const spec = {
    dsl: 1,
    pluginId: 'bondprep',
    meta: {
      key: 'effect:bondprep:income',
      on: [{
        when: 'income',
        if: { bondActive: { id: 'laterano', tier: 1 } },
        do: [{ funds: { amount: 9 } }],
      }],
    },
  };
  const checked = validateDsl(spec);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const handler = compileDslMeta(spec, { pluginId: 'bondprep' });
  const funds = [];
  handler.onIncome({
    round: 1,
    bonds: { laterano: { active: true, tier: 2 } },
    addFunds: (n) => funds.push(n),
  }, {});
  assert.deepEqual(funds, [9]);
  handler.onIncome({
    round: 1,
    bonds: { laterano: { active: false, tier: 2 } },
    addFunds: (n) => funds.push(n),
  }, {});
  assert.deepEqual(funds, [9], 'an inactive bond does not call addFunds');
  for (const cond of ['selfHpBelow', 'enemiesInRange', 'skillActive', 'targetHas']) {
    const value = cond === 'targetHas' ? 'stun' : (cond === 'skillActive' ? true : 1);
    const bad = {
      dsl: 1,
      pluginId: 'bondprep',
      meta: { on: [{ when: 'income', if: { [cond]: value }, do: [{ funds: { amount: 1 } }] }] },
    };
    const problems = validateDsl(bad);
    assert.equal(problems.ok, false, cond);
    assert.equal(problems.problems[0].code, 'PLUGIN_DSL_CONDITION', cond);
    assert.ok(problems.problems.some((p) => p.zh.includes('备战条件不能用这一条')), cond + ' ' + JSON.stringify(problems.problems));
  }
});
