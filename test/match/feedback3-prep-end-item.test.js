// An item that arrives at 休整期结束 waits in the hand and merges at the next prep start (owner's decision 2026-10-04).
// 维多利亚 pays 战栗维式重锤 when a <休整期结束时> layer gain (刺玫 / 薄绿 / 维娜, 助力) crosses a milestone while it is active;
// merging in that call used to detach the equipped copy before the fight. [ASSUMED] every grant while that dispatch is
// on the stack, not only this hammer. (Milestones owed while it was inactive pay as soon as it lights up — onActiveBonds,
// DESIGN §32.14.31, test/match/bond-light-up.test.js — so a prep-end payment is one that a prep-end gain crosses.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerMeta as coreRegisterMeta } from '../../server/sim/content/bonds/core.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { tileKey } from '../../server/match/board.js';

const HAMMER = 'chess_item_2_03_e_a'; // 战栗维式重锤
const GOLDEN = 'chess_item_2_03_e_b';
const FILLER = 'chess_item_1_01_e_a';
const OPS = ['chess_char_1_06_a', 'chess_char_2_05_a', 'chess_char_3_08_a'];

function copies(ps, id) {
  let n = 0;
  const see = (p) => { if (p && p.kind === 'item' && p.id === id) n++; };
  for (const p of ps.hand) see(p);
  for (const p of ps.temp) see(p);
  for (const c of ps.board.values()) if (c && c.kind === 'chess') for (const it of c.items || []) see(it);
  return n;
}

function fresh() {
  const reg = createRegistry({ content: false });
  coreRegisterMeta(reg);
  // a <休整期结束时> gain of 已激活的【维多利亚】: `test:prepEndLayers` layers on onPrepEnd
  reg.global('test_prep_end_layers', {
    onPrepEnd(ctx) { const n = ctx.counter('test:prepEndLayers'); if (n > 0) ctx.addLayers('victoriaShip', n, { requireActive: true }); },
  });
  const h = makeMatch({ mode: 'solo', seed: 5, registry: reg, fake: true }).start();
  h.toPrep(1);
  const orig = h.m.rollItemId.bind(h.m);
  h.m.rollItemId = (opts = {}) => (opts.pool === 'pool_equip_vict' ? HAMMER : orig(opts));
  return h;
}

/** Three 维多利亚 operators (the bond active, no milestone owed); `layers` land at the prep end. One wears the hammer when `equip`. */
function arm(h, { layers, equip = true, fill = false } = {}) {
  const ps = h.ps('p_0');
  assert.equal(ps.setReady(false).ok, true);
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) {
    if (p && p.kind === 'chess') ps.returnCopies(p);
  }
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps._tempDue.clear();
  ps.recompute();
  assert.equal(ps.bonds.victoriaShip?.active ?? false, false);
  const used = new Set();
  const ops = OPS.map((id) => {
    const t = legalTileFor(h.m, ps, id, used);
    used.add(tileKey(t[0], t[1]));
    return give(h.m, ps, id, 'board', t);
  });
  assert.equal(ps.bonds.victoriaShip.active, true);
  assert.equal(ps.counters['bond:victoria:hammers'] || 0, 0, 'no milestone yet');
  ps.counters['test:prepEndLayers'] = layers;
  let equipped = null;
  if (equip) {
    equipped = giveItem(h.m, ps, HAMMER);
    const eq = ps.equip(equipped.uid, ops[0].uid);
    assert.equal(eq.ok, true, eq.error || eq.detail);
    assert.equal(ops[0].items[0].uid, equipped.uid);
  }
  if (fill) {
    for (let i = 0; i < ps.hand.length; i++) if (!ps.hand[i]) giveItem(h.m, ps, FILLER, 'hand', i);
    for (let i = 0; i < ps.temp.length; i++) if (!ps.temp[i]) giveItem(h.m, ps, FILLER, 'temp', i);
    assert.ok(ps.hand.every(Boolean) && ps.temp.every(Boolean));
  }
  return { ps, carrier: ops[0], equipped };
}

test('维多利亚 pays a 战栗维式重锤 for a milestone crossed at prep end: the equipped copy stays for the fight, and they merge at the next prep', () => {
  const h = fresh();
  const { ps, carrier, equipped } = arm(h, { layers: 25 });
  assert.equal(ps.setReady(true).ok, true);
  h.m.endPrep();
  assert.equal(h.m.phase, 'COMBAT');
  assert.equal(carrier.items.length, 1);
  assert.equal(carrier.items[0].uid, equipped.uid, 'the equipped hammer was not taken off');
  assert.equal(carrier.items[0].id, HAMMER);
  assert.equal(copies(ps, HAMMER), 2, 'the new copy is in hand or temp');
  assert.equal(copies(ps, GOLDEN), 0, 'no golden yet');
  const input = FakeBattle.instances.at(-1).opts.players[0];
  const unit = input.units.find((u) => u.uid === carrier.uid);
  assert.ok(unit && unit.items.includes(HAMMER), 'the fight is built with the hammer still equipped');
  h.toPrep(2);
  assert.equal(h.m.phase, 'PREP');
  assert.equal(copies(ps, GOLDEN), 1, 'the pair merged when the next prep started');
  assert.equal(copies(ps, HAMMER), 0);
  h.invariants();
  h.m.dispose();
});

test('two milestones owed at prep end both wait: no golden before the fight; the next prep merges the hand copies and leaves the equipped one', () => {
  const h = fresh();
  const { ps, carrier, equipped } = arm(h, { layers: 50 });
  assert.equal(ps.setReady(true).ok, true);
  h.m.endPrep();
  assert.equal(carrier.items[0].uid, equipped.uid);
  assert.equal(copies(ps, HAMMER), 3, 'equipped + two stowed, the nested onGain grant included');
  assert.equal(copies(ps, GOLDEN), 0);
  h.toPrep(2);
  assert.equal(copies(ps, GOLDEN), 1);
  assert.equal(copies(ps, HAMMER), 1);
  assert.equal(carrier.items[0] && carrier.items[0].uid, equipped.uid, 'the hand copies merged with each other; the equipped one stayed');
  h.m.dispose();
});

test('full visible bench at prep end: new hammers queue, then merge next prep without removing the equipped one', () => {
  const h = fresh();
  const { ps, carrier, equipped } = arm(h, { layers: 50, fill: true });
  ps.ready = true; // Model late overflow after Ready, before the prep-end grant dispatch.
  h.m.endPrep();
  assert.equal(carrier.items.length, 1);
  assert.equal(carrier.items[0].uid, equipped.uid);
  assert.equal(carrier.items[0].id, HAMMER);
  assert.equal(copies(ps, GOLDEN), 0);
  assert.equal(copies(ps, HAMMER), 3);
  const toasts = h.sent.filter(([, msg]) => msg.t === 'm.toast').map(([, msg]) => msg.text);
  assert.equal(toasts.filter((t) => t === '整备区已满，获得的装备已销毁').length, 0);
  const input = FakeBattle.instances.at(-1).opts.players[0];
  assert.ok(input.units.find((u) => u.uid === carrier.uid).items.includes(HAMMER));
  h.toPrep(2);
  assert.equal(carrier.items[0].uid, equipped.uid, 'nothing was merged into the slot');
  assert.equal(copies(ps, GOLDEN), 1);
  assert.equal(copies(ps, HAMMER), 1);
  h.m.dispose();
});

test('a buy during prep still merges at once', () => {
  const h = fresh();
  const ps = h.ps('p_0');
  assert.equal(ps.setReady(false).ok, true);
  giveItem(h.m, ps, HAMMER);
  ps.funds = 50;
  ps.shop.slots[0] = { kind: 'item', id: HAMMER, price: 1, basePrice: 1, sold: false };
  assert.equal(ps.buy(0).ok, true);
  assert.equal(h.m.phase, 'PREP');
  assert.equal(copies(ps, HAMMER), 0);
  assert.equal(copies(ps, GOLDEN), 1);
  h.m.dispose();
});

test('a grant after the prep has ended (onLayers during combat) still merges at once', () => {
  const h = fresh();
  const { ps, carrier, equipped } = arm(h, { layers: 0 });
  assert.equal(ps.setReady(true).ok, true);
  h.m.endPrep();
  assert.equal(h.m.phase, 'COMBAT');
  assert.equal(carrier.items[0].uid, equipped.uid);
  assert.equal(ps.addLayers('victoriaShip', 25), 25);
  assert.equal(copies(ps, HAMMER), 0, 'the equipped copy was merged immediately');
  assert.equal(copies(ps, GOLDEN), 1);
  assert.equal(h.m.phase, 'COMBAT');
  h.m.dispose();
});
