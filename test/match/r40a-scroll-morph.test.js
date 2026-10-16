// Community report of 2026-10-14: 夕's 画卷 seemed not to copy 变形同构体, and the copy brought no extra bond.
// Official (PRTS 画卷 备注, already §27.27): the copy includes the operator's elite state and its equipment, and the
// copied items arrive unequipped. The extra bond exists only while 变形同构体 and a giveBondId item are both worn
// (bondsMeta pieceBonds). 变形同构体 does not merge (upgradeNum 100). A copied shop item still takes stock: the
// tier-VI cap is 3, and only fixed operator gifts may overdraw (acquire.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor } from './harness.js';

const SCROLL = 'chess_item_6_02_m';
const ISO = 'chess_item_6_09_e_a';
const HAMMER = 'chess_item_1_01_e_a';
const OUTSIDER = 'chess_char_1_01_a'; // 隐现: not 维多利亚
const OK = { ok: true };

function tally(ps, id) {
  let n = 0;
  const see = (p) => { if (p && p.id === id) n++; };
  for (const p of [...ps.hand, ...ps.temp, ...ps.board.values()]) {
    if (!p) continue;
    see(p);
    for (const it of p.items || []) see(it);
  }
  return n;
}

function open() {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 8 }).start();
  h.toPrep(1, { band: 'band_dusk' });
  const m = h.m, ps = h.ps('p_0');
  const art = ps.hand.find((p) => p?.id === SCROLL);
  assert.ok(art, 'Dusk grants the scroll in round 1');
  for (const p of [...ps.board.values()]) if (p?.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  for (let i = 0; i < ps.hand.length; i++) if (ps.hand[i]?.kind === 'chess') { ps.returnCopies(ps.hand[i]); ps.hand[i] = null; }
  for (let i = 0; i < ps.temp.length; i++) if (ps.temp[i]?.kind === 'chess') { ps.returnCopies(ps.temp[i]); ps.temp[i] = null; }
  ps.funds = 99;
  ps.recompute();
  return { h, m, ps, art };
}

function place(m, ps, id) {
  const piece = ps.acquireChess(id);
  assert.ok(piece, id);
  const at = legalTileFor(m, ps, piece.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: at[0], col: at[1] }, dir: 'RIGHT' }), OK);
  return { piece, at };
}

test('画卷 copies a worn 变形同构体 into the hand; the extra bond waits until the copy wears the pair', (t) => {
  const { h, m, ps, art } = open();
  t.after(() => h.m.dispose());
  const { piece, at } = place(m, ps, OUTSIDER);
  const iso = ps.acquireItem(ISO);
  const hammer = ps.acquireItem(HAMMER);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: iso.uid, targetUid: piece.uid }), OK);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: hammer.uid, targetUid: piece.uid }), OK);
  assert.equal(ps.bonds.victoriaShip.count, 1, 'the worn pair counts');
  assert.equal(tally(ps, ISO), 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: at[0], col: at[1], dir: 'RIGHT' }), OK);
  const copies = ps.allChess().filter((p) => m.gd.baseIdOf(p.id) === OUTSIDER);
  assert.equal(copies.length, 2);
  const copy = copies.find((p) => p.uid !== piece.uid);
  assert.deepEqual(copy.items, [], 'the copy wears nothing');
  assert.deepEqual(piece.items.map((it) => it.id), [ISO], 'the morph does not merge off the original');
  assert.equal(tally(ps, ISO), 2, 'the second morph is in the hand');
  assert.equal(tally(ps, m.gd.item(HAMMER).goldenId), 1, 'the copied hammer merged into the hand');
  assert.equal(ps.bonds.victoriaShip.count, 0, 'the pair was split, so the bond is gone until someone wears both');
  const loose = ps.hand.find((p) => p?.id === ISO);
  const gold = ps.hand.find((p) => p?.id === m.gd.item(HAMMER).goldenId);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: loose.uid, targetUid: copy.uid }), OK);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: gold.uid, targetUid: copy.uid }), OK);
  const spot = legalTileFor(m, ps, copy.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: copy.uid, to: { area: 'board', row: spot[0], col: spot[1] }, dir: 'RIGHT' }), OK);
  assert.equal(ps.bonds.victoriaShip.count, 1, 'the copy counts once it wears the pair');
  h.invariants();
});

test('画卷 does not overdraw 变形同构体 once the tier-VI stock is full', (t) => {
  const { h, m, ps, art } = open();
  t.after(() => h.m.dispose());
  const { piece, at } = place(m, ps, OUTSIDER);
  assert.equal(m.itemPool.cap(ISO), 3);
  const got = [];
  for (let i = 0; i < 3; i++) got.push(ps.acquireItem(ISO));
  assert.ok(got.every(Boolean));
  assert.equal(m.itemPool.canGain(ISO), false);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: got[0].uid, targetUid: piece.uid }), OK);
  assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: at[0], col: at[1], dir: 'RIGHT' }), OK);
  const copy = ps.allChess().find((p) => m.gd.baseIdOf(p.id) === OUTSIDER && p.uid !== piece.uid);
  assert.ok(copy);
  assert.deepEqual(copy.items, []);
  assert.equal(tally(ps, ISO), 3, 'the scroll refuses a fourth morph');
  h.invariants();
});

test('画卷 of 缪尔赛思 runs her 获得时 and grants another 变形同构体', (t) => {
  for (const [id, extra] of [['chess_char_6_11_a', 1], ['chess_char_6_11_b', 2]]) {
    const { h, m, ps, art } = open();
    t.after(() => h.m.dispose());
    const before = tally(ps, ISO);
    const { at } = place(m, ps, id);
    assert.equal(tally(ps, ISO) - before, extra, `${id}: her own 获得时`);
    assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: at[0], col: at[1], dir: 'RIGHT' }), OK);
    const copies = ps.allChess().filter((p) => p.id === id);
    assert.equal(copies.length, 2, id);
    assert.ok(copies.every((p) => (p.items || []).length === 0), `${id}: gifts and copies arrive unequipped`);
    assert.equal(tally(ps, ISO) - before, extra * 2, `${id}: the copy's 获得时 grants another`);
    h.invariants();
  }
});
