// Community report of 2026-10-14: three 投资人 did not multiply 获得时 effects; 耶拉 (and 缪尔赛思's 变形同构体)
// seemed to fire once. The real purchase path already matches the bond text. What looks like one trigger:
//   - 标准 (FUNNY) lists investShip inactive, so the multiplier stays 1 even at 3 members and 100 layers;
//   - BOARD_AND_DECK counts distinct base ids, so copies of one investor do not light the bond;
//   - 谢拉格不融冰 merges at 2, so 耶拉's ×2 grant is one golden card.
// Round 39's #590 measurement (缪尔赛思 1 / 2 / 3 / 6) is the same multiplier. This file drives g.buy, not a forced bond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, DATA } from './harness.js';

const ICE = 'chess_item_5_02_e_a';
const ISO = 'chess_item_6_09_e_a';
const INVESTORS = Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && (c.bonds || []).includes('investShip'))
  .map((c) => c.chessId)
  .sort();

function cards(ps) {
  const n = {};
  const see = (id) => { if (id) n[id] = (n[id] || 0) + 1; };
  for (const p of [...ps.hand, ...ps.temp, ...ps.board.values()]) {
    if (!p) continue;
    if (p.kind === 'item') see(p.id);
    for (const it of p.items || []) see(it.id);
  }
  return n;
}
function held(gd, ps, base) {
  const n = cards(ps);
  const golden = gd.item(base)?.goldenId;
  return { normal: n[base] || 0, golden: golden ? (n[golden] || 0) : 0, equiv: (n[base] || 0) + (golden ? 2 * (n[golden] || 0) : 0) };
}

function prep(difficulty) {
  const h = makeMatch({ mode: 'solo', difficulty, humans: 1, seed: 3, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) {
    if (p.kind === 'chess') ps.returnCopies(p);
  }
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.offers.length = 0;
  ps.funds = 99;
  ps.recompute();
  return h;
}

function light(h, { distinct = true, layers = 0 } = {}) {
  const ps = h.ps('p_0');
  const members = distinct ? INVESTORS.slice(0, 3) : [INVESTORS[0], INVESTORS[0]];
  for (const id of (distinct ? members : [members[0], members[0]])) give(h.m, ps, id);
  ps.layers.investShip = layers;
  ps.recompute();
  return ps;
}

function buy(h, id) {
  const ps = h.ps('p_0');
  ps.shop.slots[0] = { kind: 'chess', id, price: 1, basePrice: 1, sold: false, frozen: false };
  assert.deepEqual(h.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  // The injected id may be banned in this seed. The purchase has already run; drop it so the shop invariant holds.
  ps.shop.slots[0] = null;
}

test('投资人 on a real purchase: ×2 while three different members are active, ×3 at 100 layers, ×1 otherwise', () => {
  assert.ok(INVESTORS.length >= 3, INVESTORS.join(' '));
  const cases = [
    ['FUNNY', true, 0, false, 1],
    ['FUNNY', true, 100, false, 1],
    ['FUNNY', false, 0, false, 1],
    ['NORMAL', false, 100, false, 1],
    ['NORMAL', true, 0, true, 2],
    ['NORMAL', true, 100, true, 3],
    ['HARD', true, 0, true, 2],
    ['HARD', true, 100, true, 3],
  ];
  for (const [difficulty, distinct, layers, active, equiv] of cases) {
    const h = prep(difficulty);
    const ps = light(h, { distinct, layers });
    assert.equal(!!ps.bonds.investShip?.active, active, `${difficulty} distinct=${distinct} layers=${layers}`);
    buy(h, 'chess_char_3_20_a');
    assert.equal(held(h.m.gd, ps, ICE).equiv, equiv, `${difficulty} distinct=${distinct} layers=${layers}: 耶拉`);
    h.invariants();
    h.m.dispose();
  }
});

test('投资人: 耶拉 ×2 is one golden 谢拉格不融冰; her elite and 缪尔赛思 follow the garrison count', () => {
  const h = prep('NORMAL');
  const ps = light(h, { layers: 0 });
  buy(h, 'chess_char_3_20_a');
  const ice = held(h.m.gd, ps, ICE);
  assert.deepEqual(ice, { normal: 0, golden: 1, equiv: 2 }, 'two normals merge, so the hand shows one card');
  h.m.dispose();

  const expect = (id, item, layers, equiv, shape) => {
    const m = prep('NORMAL');
    const p = light(m, { layers });
    buy(m, id);
    const got = held(m.m.gd, p, item);
    assert.equal(got.equiv, equiv, `${id} layers ${layers}`);
    assert.deepEqual({ normal: got.normal, golden: got.golden }, shape, `${id} layers ${layers}`);
    m.invariants();
    m.m.dispose();
  };
  // 耶拉 garrison_92: normal 1, elite 2, then ×2 / ×3. The ice merges every two normals.
  expect('chess_char_4_03_a', ICE, 0, 2, { normal: 0, golden: 1 });
  expect('chess_char_3_20_b', ICE, 0, 4, { normal: 0, golden: 2 });
  expect('chess_char_3_20_b', ICE, 100, 6, { normal: 0, golden: 3 });
  expect('chess_char_4_03_a', ICE, 100, 3, { normal: 1, golden: 1 });
  // 缪尔赛思 变形同构体 does not merge (upgradeNum 100): the count is the cards. #590: 2 / 4 / 3 / 6.
  expect('chess_char_6_11_a', ISO, 0, 2, { normal: 2, golden: 0 });
  expect('chess_char_6_11_b', ISO, 0, 4, { normal: 4, golden: 0 });
  expect('chess_char_6_11_a', ISO, 100, 3, { normal: 3, golden: 0 });
  expect('chess_char_6_11_b', ISO, 100, 6, { normal: 6, golden: 0 });
});
