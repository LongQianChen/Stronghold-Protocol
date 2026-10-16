// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard), the personal bounty choice of the Art 教鞭 (offerBountyChoice / pickPersonalChoice /
// autoPickPersonalChoice: held by the player inside PREP — no phase, no timer of its own) and the rolls the meta effects
// ask for — bounties (addBounty), item ids (rollItemId) and choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateGroupDrafts, applyCard, bountyBattles, isMultiRoundBounty, bountyCard } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';
import { installDraftFacade } from './phases.js';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    if (!this.alivePlayers().length) { this.enterPrep(); return; }
    const groups = this.makeDraftGroups({ shuffle: false });
    const active = groups.filter((g) => g.order.length).map((g) => ({ id: g.id, playerIds: g.order.slice() }));
    const pages = generateGroupDrafts(this.gd, this.rngDraft, this.round, active, {
      stageId: this.stageId, bondAvailable: (bondId, group) => this.bondLive(bondId, group.playerIds[0]),
      itemAvailable: (id, group) => this.itemPoolFor(group.playerIds[0]).canGain(id),
    });
    if (!pages || !pages.length) { this.enterPrep(); return; }
    for (const g of groups) {
      const page = pages.find((p) => p.id === g.id);
      Object.assign(g, page || { cards: [] }, { taken: {} });
      if (!this.isSolo) this.rngDraft.shuffle(g.order);
      this.prioritizeDraftOrder(g.order);
    }
    this.phase = PHASE.SP_DRAFT;
    this.sp = installDraftFacade({ ...pages[0], id: this.nextDraftId('sp'), groups, picks: {}, untimed: this.soloUntimed },
      ['order', 'idx', 'cards', 'taken', 'turnDeadline', 'turnSeconds']);
    this.setDeadline(0);
    for (const g of groups) this.startSpTurn(g);
    this.markPublic();
  }

  spGroup(playerId = null) {
    const groups = this.sp?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  spTurn(playerId = null) {
    const g = this.spGroup(playerId);
    return g && !g.done ? g.order[g.idx] ?? null : null;
  }

  spCardAvailable(card, group = this.spGroup()) {
    return !!card && !!group && group.taken[card.idx] == null &&
      (card.kind !== 'item' || this.itemPoolFor(group.playerIds[0]).canGain(card.id));
  }

  startSpTurn(group = this.spGroup()) {
    const s = this.sp;
    if (this.phase !== PHASE.SP_DRAFT || !s || !group) return;
    const g = group;
    this.clearDraftGroupTimer(g);
    while (g.idx < g.order.length) {
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.alive && !ps.left && s.picks[ps.playerId] == null) break;
      g.idx++;
    }
    this.prioritizeDraftOrder(g.order, g.idx);
    const available = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
    g.done = g.idx >= g.order.length || !available.length;
    if (g.done) {
      this.syncDraftDeadline(s);
      this.markPublic();
      if (s.groups.every((x) => x.done) && !s.finishPending) {
        s.finishPending = true;
        this.later(0, () => {
          if (this.sp === s && this.phase === PHASE.SP_DRAFT && s.groups.every((x) => x.done)) this.finishSpDraft();
        });
      }
      return;
    }
    const token = g.token;
    if (!g.untimed) {
      const first = g.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      const ms = this.scaled(secs * 1000);
      g.turnSeconds = ms / 1000;
      g.turnDeadline = this.sched.gameNow() + ms;
      g.timer = this.later(ms, () => {
        if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
        const ps = this.players.get(g.order[g.idx]);
        if (!ps) return;
        const avail = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
        if (!avail.length) { this.startSpTurn(g); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
    }
    this.syncDraftDeadline(s);
    const cur = this.players.get(g.order[g.idx]);
    if (cur && cur.botControlled) this.scheduleSpBot(g);
    this.markPublic();
  }

  scheduleSpBot(group = this.spGroup()) {
    const s = this.sp;
    const g = group;
    if (!s || !g || g.done) return;
    const token = g.token;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled) return;
      const avail = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
      if (!avail.length) { this.startSpTurn(g); return; }
      this._applyCard(ps, botPickCard(this, ps, g.cards, avail));
    });
  }

  pickCard(ps, idx, opts = {}) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    const g = this.spGroup(ps.playerId);
    const targetError = this.draftTargetError(this.sp, g, opts);
    if (targetError) return targetError;
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= g.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(g.cards[idx], g)) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    const g = ps && this.spGroup(ps.playerId);
    if (!s || !g || !ps.alive || ps.left || s.picks[ps.playerId] != null || !this.spCardAvailable(g.cards[idx], g)) return;
    const card = g.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    g.picks[ps.playerId] = idx;
    g.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.startSpTurn(g);
    // A team tactic can fill another group's stock. Finish an exhausted page immediately, including untimed rooms,
    // while keeping every still-available group's existing turn and timer intact.
    for (const other of s.groups) {
      if (other !== g && !other.done && !other.cards.some((c) => this.spCardAvailable(c, other))) this.startSpTurn(other);
    }
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    for (const g of this.sp.groups) this.clearDraftGroupTimer(g);
    this.enterPrep();
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — the card becomes a bounty on its next battles. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? botPickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items.
   * `also` (pool_equip_kathe: 突变细胞) joins the draw even though it is shopExcluded. The shop item slot does not
   * read it. `pick` still drops ids that `canGain` refuses, so an empty shop item stays out and an uncapped `also`
   * id can still be drawn. `player` selects that seat's group stock for private DIY-aware availability. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6, player = null } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const stock = this.itemPoolFor(player);
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && stock.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return stock.pick(rng, pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return stock.pick(rng, withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return stock.pick(rng, withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return stock.pick(rng, list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, player = null } = {}) {
    const pool = this.poolFor(player);
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl, player });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !pool.has(base) || pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
