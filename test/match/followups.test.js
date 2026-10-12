// Match follow-ups: multi-round bounties in the Final Assault / Hidden Core, 驰援 cards of fully banned bonds,
// 坚若磐石 = least LP lost, combat time limits in real seconds (× the forced 2× speed), boss-round layout model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GameData, COMBAT_TIME_SCALE } from '../../server/match/gamedata.js';
import { generateDraft, reinforcementBond, cardTargetBonds, bountyBattles } from '../../server/match/choices.js';
import { assignTitles } from '../../server/match/results.js';
import { routeByMotion } from '../../server/match/waves.js';
import { fieldModel } from '../../server/match/bot.js';
import { FIELD, parseKey } from '../../server/match/board.js';
import { createRng } from '../../server/sim/rng.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants, giveItem } from './harness.js';

const bossFields = () => FakeBattle.instances.filter((b) => b.kind === 'boss' || b.kind === 'hidden');

/** A multi-round ("之后的每场作战") kill bounty whose enemy is active in the mode. */
function everyBattleBounty(gd) {
  const c = DATA.choices.cards.bounty.find((x) => x.rounds >= 90 && x.payout === 'kill' && DATA.enemies[x.enemyKey] && !gd.inactiveEnemies.has(x.enemyKey));
  assert.ok(c, 'data has a multi-round kill bounty');
  return c;
}

test('multi-round bounties spawn in the Final Assault on the owner\'s half, show in the boss preview, then use up a battle', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 61, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9, coins: { p_0: 3 } } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  const card = everyBattleBounty(m.gd);
  const [p0, p1] = [h.ps('p_0'), h.ps('p_1')];
  m.addBounty(p0, card);
  m.addBounty(p1, card);
  assert.ok(p0.privateView().nextEnemies.some((e) => e.enemyKey === card.enemyKey && e.tag === 'bounty'), 'boss-round preview lists the bounty');
  assert.ok(p0.privateView().nextEnemies.some((e) => e.tag === 'boss'));
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const f = bossFields()[0];
  const bs = f.opts.spawns.filter((s) => s.tag === 'bounty');
  assert.equal(bs.length, 2, 'one bounty spawn per player of the pair');
  const fly = DATA.enemies[card.enemyKey].stats.motion === 'FLY';
  for (const s of bs) {
    const rt = f.opts.routes[s.routeIndex];
    assert.ok(rt, 'a valid route');
    assert.equal(rt.motion === 'FLY', fly, 'route motion matches the enemy');
    assert.equal(s.count, card.count);
    assert.ok(s.mods.hpMul > 0, 'bounty enemies take the round\'s multipliers');
    const side = f.opts.players.find(p => p.playerId === s.ownerPlayerId)?.side;
    assert.ok(side === 'L' || side === 'R', 'bounty has an actual field owner');
    assert.ok(side === 'L' ? rt.end[1] < 10 : rt.end[1] > 10, `owner's ${side} bounty goes to its own goal (${rt.end})`);
  }
  const pending = p0.pendingFunds;
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  // (a multi-round card lasts two battles since the user's playtest #6 answer — choices.js MULTI_ROUND_BOUNTY_BATTLES)
  assert.equal(p0.bounties[0].roundsLeft, bountyBattles(card) - 1, 'the Final Assault used one of the bounty\'s battles');
  assert.equal(p0.pendingFunds, pending + 3, 'kill-bounty coins of the boss field are credited (spent in the Hidden Core prep)');
  checkInvariants(m);
  m.dispose();
});

// A 战术特训 card pays its coins when the player's own battle is perfect (PRTS "若各自行动阶段就达成完美作战，获得N资金");
// the Final Assault and the Hidden Core are such battles — they pay it with the kill coins, at the next income.
test('perfect-payout bounties in the boss rounds: a 战术特训 card\'s coins join the kill coins at the next income (R14 → R15, then the Hidden Core)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 61, fake: true,
    script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9, coins: { p_0: 3 } } : {}) }).start();
  const m = h.m;
  h.toPrep(14);
  const ps = h.ps('p_0');
  const [card, second] = DATA.choices.cards.bounty.filter((c) => c.payout === 'perfect' && m.gd.enemy(c.enemyKey) && !m.gd.inactiveEnemies.has(c.enemyKey));
  m.addBounty(ps, card);
  const pending = ps.pendingFunds, gained = ps.stats.fundsGained;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  m.hiddenLayerSum = 1e6; // the Hidden Core opens
  assert.ok(bossFields()[0].opts.spawns.some((s) => s.tag === 'bounty' && s.enemyKey === card.enemyKey && s.ownerPlayerId === ps.playerId), 'the card\'s enemies are in the boss battle');
  h.run(() => m.runner === null);
  assert.equal(ps.pendingFunds, pending + 3 + card.coin, 'kill coins + one card amount, regardless of its enemy count');
  assert.equal(ps.stats.fundsGained, gained + 3 + card.coin);
  const left = bountyBattles(card);
  assert.equal(ps.bounties.length, left > 1 ? 1 : 0, 'the boss battle used one of its battles');
  if (left > 1) assert.equal(ps.bounties[0].roundsLeft, left - 1);
  h.toPrep(15);
  assert.equal(ps.pendingFunds, 0);
  assert.equal(ps.funds, m.gd.income(15) + pending + 3 + card.coin, 'the base income is separate from the bounty funds');
  m.addBounty(ps, second);
  const owed = ps.bounties.filter((b) => b.card.payout === 'perfect').reduce((n, b) => n + b.card.coin, 0);
  h.drive(() => m.phase === PHASE.HIDDEN_CORE);
  assert.ok(bossFields().at(-1).opts.spawns.some((s) => s.tag === 'bounty' && s.enemyKey === second.enemyKey), 'and in the Hidden Core');
  h.runToEnd();
  assert.equal(ps.pendingFunds, 3 + owed, 'the Hidden Core pays by the same rule');
  assert.equal(ps.bounties.length, 0, 'every bounty used its battles');
  checkInvariants(m);
  m.dispose();
});

test('教鞭 in the boss rounds (R14, R15): the card the owner chose spawns in the boss battle and pays at the next income, the Hidden Core takes another choice', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 61, fake: true,
    script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9, coins: { p_0: 3 } } : {}) }).start();
  const m = h.m;
  h.toPrep(14);
  const ps = h.ps('p_0');
  const art = giveItem(m, ps, 'chess_item_6_03_m');
  assert.deepEqual(ps.useArt(art.uid, 10, 5), { ok: true });
  assert.equal(ps.bounties.length, 0, 'nothing is applied before the owner confirms');
  assert.equal(ps.setReady(true).error, 'BAD_TARGET', 'Ready waits for the choice');
  const card = ps.personalChoice.cards[2];
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.choice', idx: 2, choiceId: ps.personalChoice.id }), { ok: true });
  assert.equal(ps.bounties[0].card.effectId, card.effectId, 'the card of the tapped slot');
  const pending = ps.pendingFunds;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  m.hiddenLayerSum = 1e6;
  assert.ok(bossFields()[0].opts.spawns.some((s) => s.tag === 'bounty' && s.enemyKey === card.enemyKey && s.ownerPlayerId === ps.playerId), 'the chosen card\'s enemies come in the boss battle');
  h.run(() => m.runner === null);
  assert.equal(ps.pendingFunds, pending + 3 + card.coin, 'kill coins + the chosen card\'s coins');
  h.toPrep(15);
  assert.equal(ps.funds, m.gd.income(15) + pending + 3 + card.coin, 'paid at the R15 income, apart from the base income');
  const hiddenArt = giveItem(m, ps, 'chess_item_6_03_m');
  assert.deepEqual(ps.useArt(hiddenArt.uid, 10, 5), { ok: true });
  const hiddenCard = ps.personalChoice.cards[0];
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id }), { ok: true });
  const owed = ps.bounties.filter((b) => b.card.payout === 'perfect').reduce((n, b) => n + b.card.coin, 0);
  h.drive(() => m.phase === PHASE.HIDDEN_CORE);
  assert.ok(bossFields().at(-1).opts.spawns.some((s) => s.tag === 'bounty' && s.enemyKey === hiddenCard.enemyKey));
  h.runToEnd();
  assert.equal(ps.pendingFunds, 3 + owed, 'the Hidden Core pays by the same rule');
  checkInvariants(m);
  m.dispose();
});

test('boss victory without a perfect own result keeps the kill coins but gives no perfect-card funds', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 61, fake: true,
    script: (b) => (b.kind === 'boss' ? { bossDps: 1e9, leaks: { p_0: 1 }, coins: { p_0: 3 } } : {}) }).start();
  h.toPrep(14);
  const m = h.m, ps = h.ps('p_0');
  const card = DATA.choices.cards.bounty.find((c) => c.payout === 'perfect' && !m.gd.inactiveEnemies.has(c.enemyKey));
  m.addBounty(ps, { ...card, rounds: 2, multiRound: false });
  const gained = ps.stats.fundsGained;
  const result = h.drive(() => h.ended != null);
  assert.ok(result && h.ended.victory);
  assert.equal(ps.pendingFunds, 3);
  assert.equal(ps.stats.fundsGained, gained + 3);
  assert.equal(ps.bounties[0].roundsLeft, 1);
  m.dispose();
});

test('solo Final Assault: the bounty spawns on the `_s` template; bountySpawns route choice by side', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 62, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  m.addBounty(h.ps('p_0'), everyBattleBounty(m.gd));
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const f = bossFields()[0];
  assert.ok(/_s$/.test(f.opts.waveId));
  assert.equal(f.opts.spawns.filter((s) => s.tag === 'bounty' && s.ownerPlayerId === 'p_0').length, 1);
  m.dispose();
  const routes = [{ motion: 'WALK', end: [1, 17] }, { motion: 'WALK', end: [1, 3] }, { motion: 'FLY', end: [1, 17] }, { motion: 'FLY', end: [1, 3] }];
  assert.equal(routeByMotion(routes, false), 0);
  assert.equal(routeByMotion(routes, false, 'L'), 1);
  assert.equal(routeByMotion(routes, false, 'R'), 0);
  assert.equal(routeByMotion(routes, true, 'L'), 3);
  assert.equal(routeByMotion(routes, true, 'R'), 2);
  assert.equal(routeByMotion([{ motion: 'WALK', end: [9, 2] }], false, 'R'), 0, 'falls back to any route of the motion');
});

test('驰援 cards: a bond without chess in this match\'s pool is never offered', () => {
  const gd = new GameData(DATA, 'mode_multi_funny');
  assert.equal(reinforcementBond(gd, 'allybuff_select_7_1'), 'yanShip');
  assert.equal(reinforcementBond(gd, 'allybuff_select_11'), null);
  const offered = (bondAvailable) => {
    const seen = new Set();
    for (let s = 1; s <= 300; s++) {
      const d = generateDraft(gd, createRng(s), 9, { bondAvailable });
      if (d && d.family === 'tactic') for (const c of d.cards) seen.add(c.id);
    }
    return seen;
  };
  const all = offered(null);
  assert.ok(all.has('allybuff_select_7_1'), 'sanity: 炎盟约驰援 is offered normally');
  const filtered = offered((b) => b !== 'yanShip');
  assert.ok(!filtered.has('allybuff_select_7_1'), '炎盟约驰援 filtered');
  assert.ok(filtered.has('allybuff_select_7_3') || filtered.has('allybuff_select_7_2'), 'other 驰援 cards stay');
  // Match wiring: bondInPool follows the pool (banned chess are never in it)
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, seed: 63, fake: true });
  const m = h.m;
  for (const id of m.gd.bondIds) {
    const want = [...m.pool.entries.keys()].some((c) => (m.gd.chess(c).bonds || []).includes(id));
    assert.equal(m.bondInPool(id), want, id);
  }
  for (const id of [...m.pool.entries.keys()]) if ((m.gd.chess(id).bonds || []).includes('yanShip')) m.pool.entries.delete(id);
  assert.equal(m.bondInPool('yanShip'), false);
  m.dispose();
});

test('标准 (FUNNY) 机变: tactic cards acting only on mode-inactive bonds (玛恩纳 / 莫斯提马的盟誓, 卡西米尔 / 拉特兰 / 阿戈尔驰援) are never offered', () => {
  // the draft the finding saw at R3 of seed 18: 玛恩纳的盟誓 (卡西米尔 +12) and 卡西米尔驰援 in a mode without 卡西米尔
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed: 18, fake: true }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.SP_DRAFT);
  const inactive = m.gd.modeInactiveBonds;
  assert.ok(['kazimierzShip', 'lateranoShip', 'arcaneShip', 'egirShip'].every((b) => inactive.has(b)));
  const dead = (c) => { const bonds = cardTargetBonds(m.gd, c.id); return !!bonds && bonds.every((b) => inactive.has(b) || !m.bondInPool(b)); };
  assert.deepEqual(m.sp.cards.filter((c) => c.kind === 'tactic' && dead(c)).map((c) => c.name), []);
  // every FUNNY tactic draft of the match's wiring (Match.bondLive)
  const seen = new Set();
  for (let s = 1; s <= 400; s++) {
    const d = generateDraft(m.gd, createRng(s), 3, { stageId: m.stageId, bondAvailable: (b) => m.bondLive(b) });
    if (d && d.family === 'tactic') for (const c of d.cards) seen.add(c.id);
  }
  for (const id of ['allybuff_select_2_7', 'allybuff_select_2_5', 'allybuff_select_7_5', 'allybuff_select_7_6', 'allybuff_select_7_8']) assert.ok(!seen.has(id), `${id} never offered in 标准`);
  assert.ok(seen.has('allybuff_select_2_1'), '斯卡蒂的盟誓 (阿戈尔 off, but 深海猎人 / 坚守 on) stays');
  assert.ok(seen.has('allybuff_select_7_1'), '炎盟约驰援 stays');
  assert.deepEqual(cardTargetBonds(m.gd, 'allybuff_select_2_5'), ['lateranoShip', 'arcaneShip']);
  assert.equal(cardTargetBonds(m.gd, 'allybuff_select_11'), null, 'cards that do anything else are always useful');
  m.dispose();
  // other modes keep them
  const h2 = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, seed: 18, fake: true });
  if (h2.m.bondInPool('kazimierzShip')) assert.equal(h2.m.bondLive('kazimierzShip'), true);
  h2.m.dispose();
});

test('坚若磐石 (目标生命值损失最少): least LP lost among the players still alive (tuning override of the title rule)', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const t3 = gd.titles.find((t) => t.id === 'comment_3');
  assert.deepEqual([t3.stat, t3.rule, t3.name], ['lpLost', 'min', '坚若磐石']);
  const fake = (seat, lpLost, alive = true, s = {}) => ({ playerId: `p${seat}`, seat, alive, lp: 10, lpAtFinal: 10, stats: { bossDamage: 0, merges: 0, itemsEquipped: 0, gold: 0, lpLost, ...s }, activatedLayers: () => 0 });
  const players = [fake(0, 12, true, { gold: 30 }), fake(1, 3, true, { gold: 10 }), fake(2, 0, false, { gold: 5 }), fake(3, 7, true, { merges: 2 })];
  const won = assignTitles(gd, players, true);
  assert.equal(won.get('p1').id, 'comment_3', 'the least LP lost among the alive');
  assert.notEqual(won.get('p2')?.id, 'comment_3', 'an eliminated player never is 坚若磐石');
  // a perfect player (0 LP lost) still qualifies
  const perfect = assignTitles(gd, [fake(0, 0), fake(1, 5, true, { gold: 9 })], false);
  assert.equal(perfect.get('p0').id, 'comment_3');
  // without the tuning override the config rule applies
  const { tuning, ...raw } = DATA; // eslint-disable-line no-unused-vars
  const plain = new GameData(raw, 'mode_multi_hard');
  assert.equal(plain.titles.find((t) => t.id === 'comment_3').stat, 'lpRemaining');
});

test('combat time limits: data maxPlayTime is real seconds, the sim gets game seconds (× the forced 2× speed)', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  assert.equal(COMBAT_TIME_SCALE, 2);
  for (let r = 1; r <= 13; r++) {
    assert.equal(gd.combatTimeLimitReal(r), DATA.config.modes.mode_multi_normal.rounds[r].combatTimeLimit);
    assert.equal(gd.combatTimeLimit(r), gd.combatTimeLimitReal(r) * 2);
    // every enemy of the round's template spawns inside the limit (the game-second reading fails R2 / R3)
    const tpl = DATA.waves[gd.roundCfg(r).template];
    const last = Math.max(...tpl.spawns.map((s) => (s.time || 0) + ((s.count || 1) - 1) * (s.interval || 0)));
    assert.ok(last < gd.combatTimeLimit(r), `R${r}: last spawn ${last} s < limit ${gd.combatTimeLimit(r)} s`);
  }
  const custom = new GameData({ ...DATA, config: { ...DATA.config, combatTimeScale: 1 } }, 'mode_multi_normal');
  assert.equal(custom.combatTimeLimit(3), 55);
  // the combat deadline shown to players is maxPlayTime real seconds
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, seed: 64, fake: true, instant: false, script: () => ({ duration: 1e9 }) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.COMBAT);
  assert.equal(m.wave.timeLimit, 90);
  assert.ok(Math.abs(m.deadline - m.sched.now() - 45000) < 50, 'deadline = 45 real seconds at R1');
  m.dispose();
});

test('boss-round layout model: the player\'s boss field on the own board, the leader weighted with a dwell, sides mirrored', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 65, fake: true }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  assert.equal(m.wave, null);
  const left = fieldModel(m, h.ps('p_0'));
  const right = fieldModel(m, h.ps('p_1'));
  for (const model of [left, right]) {
    assert.ok(model.routes.length > 0);
    assert.ok(model.routes.some((r) => r.dwell > 0), 'the leader\'s route carries a dwell');
    for (const rt of model.routes) for (const k of rt.tiles) {
      const [r, c] = parseKey(k);
      assert.ok(r >= FIELD.r0 && r <= FIELD.r1 && c >= 0 && c <= FIELD.c1, `tile ${k} on the own board`);
    }
  }
  assert.notEqual(left.key, right.key, 'cached per side');
  assert.equal(fieldModel(m, h.ps('p_1')), right);
  m.dispose();
});
