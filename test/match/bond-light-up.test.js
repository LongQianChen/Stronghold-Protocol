// test/match/bond-light-up.test.js — onActiveBonds (docs/META.md §2.2, DESIGN §32.14.31): PlayerState.recompute reports
// a change of the set of active bonds, and the layer milestones owed while a bond was inactive pay as soon as it lights
// up. The maintainer's report of 2026-10-15: with 25+ 维多利亚 layers gathered while the bond was off, the 维式重锤
// came only at a later hook (often the prep end); in the official game it arrives the moment the bond lights up — here
// when the third member is placed in prep. Each milestone pays once, however often the bond goes off and on; 远见 /
// 奇迹's funds share the rule; the AI places pieces through the same intents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerMeta as coreMeta } from '../../server/sim/content/bonds/core.js';
import { registerMeta as addonMeta } from '../../server/sim/content/bonds/addon/meta.js';
import { botPrepBegin, botPrepEnd } from '../../server/match/bot.js';
import { tileKey } from '../../server/match/board.js';
import { DATA, makeMatch, give, giveItem, legalTileFor, checkInvariants } from './harness.js';

const VICTORIA = ['chess_char_1_06_a', 'chess_char_2_05_a', 'chess_char_3_08_a']; // 刺玫, 哈洛德, 薄绿
const VISI = ['chess_char_2_02_a', 'chess_char_5_21_a']; // 赫默, 寒檀 (远见 only)
const MIRA = ['chess_char_2_11_a', 'chess_char_4_26_a']; // 风丸, 华法琳 (奇迹 only)
const HAMMERS = new Set(DATA.choices.pools.pool_equip_vict.items.map((id) => id.replace(/_[ab]$/, '')));
const HAMMER_TOAST = '【维多利亚】获得{n}件维式重锤';
const COIN_TOAST = '【{label}】层数达成，获得{gain}资金';

/**
 * A solo 险境 match (NORMAL: every bond can activate, 奇迹 too — 标准模拟 switches it off) at PREP R1 with the bonds' prep
 * effects only (core + add-on meta), an empty board / hand / temp, and recorders: onActiveBonds events, 维多利亚's hammer
 * gains, toasts.
 */
function prep(seed = 5) {
  const reg = createRegistry({ content: false });
  coreMeta(reg);
  addonMeta(reg);
  const events = [];
  const hammers = [];
  reg.global('test_watch', {
    onActiveBonds(ctx, ev) { events.push({ activated: [...ev.activated], deactivated: [...ev.deactivated], phase: ctx.phase }); },
    onGain(ctx, ev) { if (ev.kind === 'item' && ev.source === 'bond:victoriaShip') hammers.push(ev.piece.id); },
  });
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, registry: reg, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps._tempDue.clear();
  ps.recompute();
  events.length = 0;
  const toasts = (msgid) => h.sent.filter(([id, msg]) => id === 'p_0' && msg.t === 'm.toast' && msg.msgid === msgid).map(([, msg]) => msg);
  return { h, m, ps, events, hammers, toasts };
}

/** Free board tiles for `ids` (one each, in order). */
function tiles(m, ps, ids) {
  const used = new Set([...ps.board.keys()]);
  return ids.map((id) => { const t = legalTileFor(m, ps, id, used); used.add(tileKey(t[0], t[1])); return t; });
}

/** Hammer copies the player holds (a golden counts 2): hand, temp, equipped. */
function hammerCopies(ps) {
  let n = 0;
  const see = (p) => { if (p && p.kind === 'item' && HAMMERS.has(p.id.replace(/_[ab]$/, ''))) n += /_b$/.test(p.id) ? 2 : 1; };
  for (const p of [...ps.hand, ...ps.temp]) see(p);
  for (const c of ps.board.values()) for (const it of c.items || []) see(it);
  return n;
}

const move = (m, uid, to) => m.handle('p_0', { t: 'g.move', uid, to });

test('维多利亚: 25+ layers gathered while inactive — placing the third member in prep grants one 维式重锤 at that moment (toast once)', () => {
  const { m, ps, events, hammers, toasts } = prep();
  const [t1, t2, t3] = tiles(m, ps, VICTORIA);
  give(m, ps, VICTORIA[0], 'board', t1);
  give(m, ps, VICTORIA[1], 'board', t2);
  const third = give(m, ps, VICTORIA[2], 'hand');
  assert.equal(ps.bonds.victoriaShip.active, false, 'two members: off');
  // "无需激活" layers (烛煌's 获得时 kind): kept while the bond is off, its milestone owed
  assert.equal(ps.addLayers('victoriaShip', 30), 30);
  assert.equal(ps.counters['bond:victoria:hammers'] || 0, 0);
  assert.equal(hammers.length, 0);
  events.length = 0;
  assert.deepEqual(move(m, third.uid, { area: 'board', row: t3[0], col: t3[1] }), { ok: true });
  assert.equal(ps.bonds.victoriaShip.active, true);
  assert.ok(events.length >= 1 && events[0].activated.includes('victoriaShip') && events[0].phase === 'PREP', JSON.stringify(events));
  assert.deepEqual(events.flatMap((e) => e.activated).filter((id) => id === 'victoriaShip'), ['victoriaShip'], 'one activation reported');
  assert.equal(ps.counters['bond:victoria:hammers'], 1, 'the milestone of 25 is paid');
  assert.equal(hammers.length, 1, 'exactly one hammer, at the placement');
  assert.equal(hammerCopies(ps), 1);
  assert.deepEqual(toasts(HAMMER_TOAST).map((t) => t.params), [{ n: 1 }], 'one toast');
  checkInvariants(m);
  m.dispose();
});

test('维多利亚: taking a member off and putting it back pays nothing more; a second milestone pays once (active, or owed while off)', () => {
  const { m, ps, events, hammers, toasts } = prep();
  const [t1, t2, t3] = tiles(m, ps, VICTORIA);
  give(m, ps, VICTORIA[0], 'board', t1);
  give(m, ps, VICTORIA[1], 'board', t2);
  const third = give(m, ps, VICTORIA[2], 'hand');
  ps.addLayers('victoriaShip', 30);
  assert.ok(move(m, third.uid, { area: 'board', row: t3[0], col: t3[1] }).ok);
  assert.equal(hammers.length, 1);
  // off (withdrawn to the hand) and on again, twice
  for (let i = 0; i < 2; i++) {
    events.length = 0;
    const idx = ps.hand.findIndex((p) => p == null);
    assert.ok(move(m, third.uid, { area: 'hand', idx }).ok);
    assert.equal(ps.bonds.victoriaShip.active, false);
    assert.ok(events.some((e) => e.deactivated.includes('victoriaShip')), 'the withdrawal reports the bond going off');
    assert.ok(move(m, third.uid, { area: 'board', row: t3[0], col: t3[1] }).ok);
    assert.equal(ps.bonds.victoriaShip.active, true);
    assert.ok(events.some((e) => e.activated.includes('victoriaShip')), 'and on again');
  }
  assert.equal(ps.counters['bond:victoria:hammers'], 1);
  assert.equal(hammers.length, 1, 'no second hammer for the same milestone');
  assert.equal(toasts(HAMMER_TOAST).length, 1);
  // a move on the board that keeps the set of active bonds reports nothing
  events.length = 0;
  const free = legalTileFor(m, ps, VICTORIA[2], new Set([...ps.board.keys()]));
  assert.ok(move(m, third.uid, { area: 'board', row: free[0], col: free[1] }).ok);
  assert.deepEqual(events, [], 'no change of the active set, no onActiveBonds');
  // the second milestone while active (onLayers): one more
  ps.addLayers('victoriaShip', 20);
  assert.equal(ps.counters['bond:victoria:hammers'], 2);
  assert.equal(hammers.length, 2);
  assert.equal(toasts(HAMMER_TOAST).length, 2);
  // the third milestone owed while off, paid once when it lights up again
  assert.ok(move(m, third.uid, { area: 'hand', idx: ps.hand.findIndex((p) => p == null) }).ok);
  ps.addLayers('victoriaShip', 25);
  assert.equal(hammers.length, 2, 'off: owed, not paid');
  assert.ok(move(m, third.uid, { area: 'board', row: t3[0], col: t3[1] }).ok);
  assert.equal(ps.counters['bond:victoria:hammers'], 3);
  assert.equal(hammers.length, 3);
  assert.equal(toasts(HAMMER_TOAST).length, 3);
  assert.equal(hammerCopies(ps), 3);
  checkInvariants(m);
  m.dispose();
});

test('维多利亚: two milestones owed when it lights up pay two hammers — the grant\'s nested onGain pays nothing twice', () => {
  const { m, ps, hammers } = prep();
  const [t1, t2, t3] = tiles(m, ps, VICTORIA);
  give(m, ps, VICTORIA[0], 'board', t1);
  give(m, ps, VICTORIA[1], 'board', t2);
  const third = give(m, ps, VICTORIA[2], 'hand');
  ps.addLayers('victoriaShip', 60);
  assert.ok(move(m, third.uid, { area: 'board', row: t3[0], col: t3[1] }).ok);
  assert.equal(ps.counters['bond:victoria:hammers'], 2);
  assert.equal(hammers.length, 2);
  assert.equal(hammerCopies(ps), 2);
  // the next hooks find nothing owed
  ps.setReady(true);
  m.endPrep();
  assert.equal(hammers.length, 2);
  checkInvariants(m);
  m.dispose();
});

test('onActiveBonds: the event lists the bonds that went on / off (data order); an eliminated player gets none', () => {
  const { m, ps, events } = prep();
  const [t1, t2, t3] = tiles(m, ps, VICTORIA);
  give(m, ps, VICTORIA[0], 'board', t1);
  give(m, ps, VICTORIA[1], 'board', t2);
  events.length = 0;
  give(m, ps, VICTORIA[2], 'board', t3);
  assert.equal(events.length, 1);
  const order = m.gd.bondIds;
  const on = Object.entries(ps.bonds).filter(([, b]) => b.active).map(([id]) => id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  assert.deepEqual(events[0].activated, on, 'every bond the placement lit, in data order');
  assert.deepEqual(events[0].deactivated, []);
  events.length = 0;
  ps.eliminate(m.round);
  assert.deepEqual(events, [], 'elimination clears the board without dispatching');
  m.dispose();
});

test('远见 / 奇迹 (they count the hand): funds owed for layers gained while off pay when a temp piece moves into a freed hand slot and lights the bond; each later milestone pays once', () => {
  // [bond, members, layers gathered while off, funds they owe, label, layers of one milestone, funds of one milestone]
  for (const [bond, members, layers, gain, label, step, per] of [['visiShip', VISI, 25, 4, '远见', 10, 2], ['miraShip', MIRA, 100, 20, '奇迹', 100, 20]]) {
    const { m, ps, toasts } = prep();
    // a full hand of distinct items, the two members waiting in temp (the temp never counts)
    const items = Object.values(DATA.items).filter((it) => !it.isGolden && it.itemType === 'EQUIP' && m.gd.itemPoolCopies(it.id) > 0).map((it) => it.id).slice(0, ps.hand.length);
    assert.equal(items.length, ps.hand.length);
    const filler = items.map((id, i) => giveItem(m, ps, id, 'hand', i));
    for (const id of members) give(m, ps, id, 'temp');
    assert.equal(ps.temp.filter(Boolean).length, 2);
    assert.equal(ps.bonds[bond].active, false);
    assert.equal(ps.addLayers(bond, layers), layers);
    const f0 = ps.funds;
    assert.equal(toasts(COIN_TOAST).length, 0, `${label}: off — owed`);
    // one freed slot: one member in, still off
    assert.ok(m.handle('p_0', { t: 'g.destroy', uid: filler[0].uid }).ok);
    assert.equal(ps.bonds[bond].active, false);
    assert.equal(ps.funds, f0);
    // the second: on, paid at once
    assert.ok(m.handle('p_0', { t: 'g.destroy', uid: filler[1].uid }).ok);
    assert.equal(ps.bonds[bond].active, true, `${label}: lit by the temp → hand move`);
    assert.equal(ps.funds, f0 + gain, `${label}: the owed funds at that moment`);
    assert.deepEqual(toasts(COIN_TOAST).map((t) => t.params.gain), [gain], `${label}: one toast`);
    // off and on again (sold, then the same operator gained again): nothing more for the same milestones
    const member = ps.hand.find((p) => p && p.kind === 'chess' && p.id === members[0]);
    assert.ok(m.handle('p_0', { t: 'g.sell', uid: member.uid }).ok);
    assert.equal(ps.bonds[bond].active, false);
    const f1 = ps.funds;
    ps.acquireChess(members[0], { source: 'grant' });
    assert.equal(ps.bonds[bond].active, true);
    assert.equal(ps.funds, f1, `${label}: no second payment`);
    assert.equal(toasts(COIN_TOAST).length, 1);
    // the next milestone while on (onLayers): once
    const f2 = ps.funds;
    ps.addLayers(bond, step);
    assert.equal(ps.funds, f2 + per, `${label}: the next milestone`);
    assert.equal(toasts(COIN_TOAST).length, 2);
    // one more owed while off, paid once when the bond lights up again
    const again = ps.hand.find((p) => p && p.kind === 'chess' && p.id === members[0]);
    assert.ok(m.handle('p_0', { t: 'g.sell', uid: again.uid }).ok);
    assert.equal(ps.bonds[bond].active, false);
    ps.addLayers(bond, step);
    const f3 = ps.funds;
    ps.acquireChess(members[0], { source: 'grant' });
    assert.equal(ps.bonds[bond].active, true);
    assert.equal(ps.funds, f3 + per, `${label}: the milestone owed while off, once`);
    assert.equal(toasts(COIN_TOAST).length, 3);
    checkInvariants(m);
    m.dispose();
  }
});

test('the AI places pieces through the same intents: its placement lights 维多利亚 and takes exactly the owed hammer', () => {
  const { m, ps, hammers } = prep(11);
  ps.shop.level = m.gd.maxShopLevel;
  for (const slot of ps.shop.slots) if (slot) slot.sold = true;
  ps.shop.freeRefreshes = 0;
  ps.funds = 0;
  for (const id of VICTORIA) give(m, ps, id, 'hand');
  ps.addLayers('victoriaShip', 40);
  assert.equal(ps.bonds.victoriaShip.active, false);
  assert.equal(hammers.length, 0);
  ps.autoplay = true;
  botPrepEnd(m, ps, botPrepBegin(m, ps));
  assert.equal(ps.bonds.victoriaShip.active, true, 'the AI deployed the three members');
  assert.equal(ps.counters['bond:victoria:hammers'], 1);
  assert.equal(hammers.length, 1, 'one hammer for the one milestone, however the AI moved its pieces');
  assert.equal(hammerCopies(ps), 1);
  checkInvariants(m);
  m.dispose();
});
