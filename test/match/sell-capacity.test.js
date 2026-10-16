import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor, checkInvariants } from './harness.js';

const SILENCE = 'chess_char_2_02_a';
const CATHY = 'chess_char_4_11_a';
const EQUIPMENT = 'chess_item_1_02_e_b'; // Elite equipment does not merge.

function setup(t) {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 1, fake: true }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1);
  return { h, m: h.m, ps: h.ps('p_0') };
}

function deploy(m, ps, piece, chessId = piece.id) {
  const tile = legalTileFor(m, ps, chessId);
  assert.ok(tile);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
}

function equip(m, ps, owner, count) {
  return Array.from({ length: count }, () => {
    const item = ps.acquireItem(EQUIPMENT, { silent: true });
    assert.ok(item);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.equip', itemUid: item.uid, targetUid: owner.uid }), { ok: true });
    return item;
  });
}

function fillStorage(ps) {
  // Fill storage independently of the equipment-stock limit; the sold operator's real equipment remains unchanged.
  while ([...ps.hand, ...ps.temp].some((p) => p === null)) assert.ok(ps.acquireItem('chess_item_2_03_e_b', { silent: true }));
}

function swapIntoTemp(m, ps, piece) {
  const idx = ps.hand.indexOf(piece);
  const filler = ps.temp.find((p) => p?.kind === 'item');
  assert.ok(idx >= 0 && filler);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: filler.uid, to: { area: 'hand', idx } }), { ok: true });
  assert.equal(ps.find(piece.uid).area, 'temp');
}

const inventory = (ps) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter(Boolean);
const tokensOf = (ps, owner) => inventory(ps).filter((p) => p.kind === 'token' && p.ownerUid === owner.uid);

for (const area of ['hand', 'temp']) {
  for (const itemCount of [1, 2]) {
    test(`sale uses the freed ${area} summon slot to return ${itemCount} equipment item(s)`, (t) => {
      const { h, m, ps } = setup(t);
      const owner = ps.acquireChess(SILENCE, { silent: true });
      deploy(m, ps, owner);
      const items = equip(m, ps, owner, itemCount);
      const other = ps.acquireChess(SILENCE, { silent: true });
      deploy(m, ps, other);
      const [stack] = tokensOf(ps, owner);
      fillStorage(ps);
      if (area === 'temp') swapIntoTemp(m, ps, stack);
      assert.equal(ps.find(stack.uid).area, area);
      // Two items need one existing free slot as well as the slot released by the stack.
      if (itemCount === 2) {
        const filler = ps.temp.find((p) => p?.kind === 'item');
        assert.deepEqual(m.handle(ps.playerId, { t: 'g.destroy', uid: filler.uid }), { ok: true });
      }
      const untouched = structuredClone(inventory(ps).filter((p) => p !== owner && p !== stack));
      const funds = ps.funds;
      const poolBefore = m.pool.left(SILENCE);
      const copies = owner.poolCopies;
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: owner.uid }), { ok: true });
      assert.equal(ps.find(owner.uid), null);
      assert.deepEqual(tokensOf(ps, owner), []);
      assert.equal(ps.funds, funds + 1);
      assert.equal(m.pool.left(SILENCE), poolBefore + copies);
      assert.deepEqual(owner.items, []);
      for (const item of items) {
        assert.equal(ps.find(item.uid).piece, item, 'the original equipment object and UID return');
        assert.ok(['hand', 'temp'].includes(ps.find(item.uid).area));
      }
      assert.equal(ps.find(items[0].uid).area, area, 'hand is preferred, with overflow into temp');
      for (const piece of untouched) assert.deepEqual(ps.find(piece.uid).piece, piece);
      assert.equal(inventory(ps).length, untouched.length + items.length);
      assert.deepEqual(h.logs.warn, []);
      checkInvariants(m);
    });
  }
}

for (const { name, ownerId, area, itemCount, stackCount } of [
  { name: 'one hand stack cannot hold two equipment items', ownerId: SILENCE, area: 'hand', itemCount: 2, stackCount: 1 },
  { name: 'one temp stack cannot hold two equipment items', ownerId: SILENCE, area: 'temp', itemCount: 2, stackCount: 1 },
  { name: 'a two-summon stack frees only one slot', ownerId: CATHY, area: 'hand', itemCount: 2, stackCount: 2 },
  { name: 'board summons and foreign stacks free no usable slot', ownerId: SILENCE, area: 'board', itemCount: 1, stackCount: 1 },
]) {
  test(`sale retains returned equipment when ${name}`, (t) => {
    const { m, ps } = setup(t);
    const owner = ps.acquireChess(ownerId, { silent: true });
    deploy(m, ps, owner);
    const items = equip(m, ps, owner, itemCount);
    const other = ps.acquireChess(SILENCE, { silent: true });
    deploy(m, ps, other);
    const [stack] = tokensOf(ps, owner);
    assert.equal(stack.count, stackCount);
    if (area === 'board') deploy(m, ps, stack, owner.id);
    fillStorage(ps);
    if (area === 'temp') swapIntoTemp(m, ps, stack);
    assert.equal(ps.find(stack.uid).area, area);
    const funds = ps.funds;
    const poolBefore = m.pool.left(ownerId);
    const copies = owner.poolCopies;
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: owner.uid }), { ok: true });
    assert.equal(m.pool.left(ownerId), poolBefore + copies);
    assert.equal(ps.temp.length, 6, 'one returned item waits behind the visible window');
    assert.equal(ps.find(owner.uid), null);
    assert.deepEqual(tokensOf(ps, owner), []);
    assert.equal(ps.funds, funds + 1);
    for (const item of items) {
      assert.equal(ps.find(item.uid).piece, item);
      assert.ok(['hand', 'temp'].includes(ps.find(item.uid).area));
    }
    assert.equal(tokensOf(ps, other).length, 1);
    checkInvariants(m);
  });
}

for (const area of ['hand', 'temp']) {
  test(`sale still counts the operator's own ${area} slot`, (t) => {
    const { m, ps } = setup(t);
    const owner = ps.acquireChess(SILENCE, { silent: true });
    const [item] = equip(m, ps, owner, 1);
    fillStorage(ps);
    if (area === 'temp') swapIntoTemp(m, ps, owner);
    assert.equal(ps.find(owner.uid).area, area);
    const funds = ps.funds;
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.sell', uid: owner.uid }), { ok: true });
    assert.equal(ps.find(owner.uid), null);
    assert.equal(ps.find(item.uid).piece, item);
    assert.equal(ps.find(item.uid).area, area);
    assert.equal(ps.funds, funds + 1);
    checkInvariants(m);
  });
}
