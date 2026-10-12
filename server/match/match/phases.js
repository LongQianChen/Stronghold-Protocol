// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: parallel fixed-pool groups, a BAND_TURN_SECONDS countdown per group turn, group-local 队友已选,
// the highlighted strategy on a timeout and skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { buildNormalWave, buildBossWave } from '../waves.js';
import { pairPlayers } from '../finalAssault.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { botPickBand } from '../bot.js';
import { OK, fail, DELAYS, BAND_TURN_SECONDS } from './common.js';

/** Single-pool diagnostics and old fixtures keep their readable/writable first-group fields. */
export function installDraftFacade(stage, fields) {
  for (const field of fields) Object.defineProperty(stage, field, {
    enumerable: true,
    get() { return this.groups[0]?.[field]; },
    set(value) { if (this.groups[0]) this.groups[0][field] = value; },
  });
  return stage;
}

export class MatchPhases {
  /** A stage identity must not consume the chess/equipment uid stream. */
  nextDraftId(kind) { return `${kind}:${this.battlePrefix}:${this.round}:${++this.draftSeq}`; }

  // Active manual pickers precede AI, autoplay and disconnected seats. Only pending turns are reordered.
  manualDraftPicker(ps) { return !!ps && ps.alive && !ps.left && ps.connected && !ps.botControlled; }

  /** The fixed pool membership persists; only the living, present seats have a turn in this stage. */
  makeDraftGroups({ shuffle = true } = {}) {
    return this.poolGroups.map(({ id, playerIds }) => {
      const order = playerIds.filter((pid) => {
        const ps = this.players.get(pid);
        return ps && ps.alive && !ps.left;
      });
      if (shuffle) {
        if (!this.isSolo) this.rngDraft.shuffle(order);
        this.prioritizeDraftOrder(order);
      }
      return { id, playerIds: playerIds.slice(), order, idx: 0, picks: {}, untimed: this.soloUntimed,
        turnDeadline: 0, turnSeconds: 0, timer: null, token: 0, done: !order.length };
    });
  }

  draftGroup(playerId = null) {
    const groups = this.draft?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  /** Optional request metadata prevents a stale stage or a read-only other-group page being submitted. */
  draftTargetError(stage, group, { draftId, groupId } = {}) {
    if (draftId != null && draftId !== stage.id) return fail(ERR.WRONG_PHASE);
    if (!group || (groupId != null && groupId !== group.id)) return fail(ERR.BAD_TARGET);
    return null;
  }

  clearDraftGroupTimer(group) {
    this.cancel(group.timer);
    group.timer = null;
    group.turnDeadline = 0;
    group.turnSeconds = 0;
    group.token++;
  }

  syncDraftDeadline(stage) {
    // A shared public frame cannot have one current-turn countdown for multiple parallel groups.
    this.deadline = stage.groups.length === 1 ? stage.groups[0].turnDeadline || 0 : 0;
  }

  /** Stable partition after one shuffle, preserving the random order within each priority group. */
  prioritizeDraftOrder(order, from = 0) {
    const pending = order.slice(from);
    const manual = [];
    const automatic = [];
    for (const pid of pending) (this.manualDraftPicker(this.players.get(pid)) ? manual : automatic).push(pid);
    const next = [...manual, ...automatic];
    if (next.every((pid, i) => pid === pending[i])) return false;
    order.splice(from, pending.length, ...next);
    return true;
  }

  refreshDraftPriority(playerId = null) {
    if (this.emergencyFrozen) return;
    const d = this.phase === PHASE.BAND_DRAFT ? this.draft : this.phase === PHASE.SP_DRAFT ? this.sp : null;
    if (!d) return;
    for (const g of d.groups) {
      if (g.done || (playerId != null && !g.playerIds.includes(playerId))) continue;
      const turn = g.order[g.idx];
      if (!this.prioritizeDraftOrder(g.order, g.idx)) continue;
      if (turn === g.order[g.idx]) { this.markPublic(); continue; }
      if (this.phase === PHASE.BAND_DRAFT) this.startDraftTurn(g);
      else this.startSpTurn(g);
    }
  }

  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: the official 25 s guard
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.emergencyFrozen) return;
    if (this.phase !== PHASE.INFO_CHECK || this.setupVote || this._infoAdvanceTimer) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this.setupVote) this.enterBandDraft();
      });
    }
  }

  /**
   * Every fixed pool group drafts in parallel with a BAND_TURN_SECONDS clock per turn. The group view publishes its
   * own turnDeadline; single-group matches also retain m.public.deadline. No separate step cap. AI seats pick at once. A
   * turn that runs out takes the strategy the player has highlighted (g.bandFocus) while it is free, else the default
   * (timeoutBand). Solo, and any single-human match (soloUntimed): untimed. Solo also keeps seat order and has no skip.
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    const groups = this.makeDraftGroups();
    for (const g of groups) g.skipsLeft = Object.fromEntries(g.order.map((pid) => [pid, skips]));
    this.draft = installDraftFacade({
      id: this.nextDraftId('band'), groups, picks: {}, untimed,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    }, ['order', 'idx', 'skipsLeft', 'turnDeadline']);
    this.setDeadline(0);
    for (const g of groups) this.startDraftTurn(g);
    this.markPublic();
  }

  draftTurn(playerId = null) {
    const g = this.draftGroup(playerId);
    return g && !g.done ? g.order[g.idx] ?? null : null;
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn(group = this.draftGroup()) {
    const d = this.draft;
    if (this.phase !== PHASE.BAND_DRAFT || !d || !group) return;
    const g = group;
    this.clearDraftGroupTimer(g);
    while (g.idx < g.order.length) {
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.alive && !ps.left && !d.picks[ps.playerId]) break;
      g.idx++;
    }
    this.prioritizeDraftOrder(g.order, g.idx);
    g.done = g.idx >= g.order.length;
    if (g.done) {
      this.syncDraftDeadline(d);
      this.markPublic();
      if (d.groups.every((x) => x.done) && !d.finishPending) {
        d.finishPending = true;
        this.later(0, () => {
          if (this.draft === d && this.phase === PHASE.BAND_DRAFT && d.groups.every((x) => x.done)) this.finishBandDraft(false);
        });
      }
      return;
    }
    const token = g.token;
    g.turnSeconds = g.untimed ? 0 : this.bandTurnMs() / 1000;
    if (!g.untimed) {
      const ms = this.bandTurnMs();
      g.turnDeadline = this.sched.gameNow() + ms;
      g.timer = this.later(ms, () => {
        if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
        const pid = this.draftTurn(g.playerIds[0]);
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      });
    }
    this.syncDraftDeadline(d);
    const cur = this.players.get(g.order[g.idx]);
    if (cur && cur.botControlled) this.scheduleBandBot(g);
    this.markPublic();
  }

  /** An AI seat's (or an AI 托管 seat's) turn: it picks at once (user playtest #4 item 4 — nobody waits on the AI). */
  scheduleBandBot(group = this.draftGroup()) {
    const d = this.draft;
    const g = group;
    if (!d || !g || g.done) return;
    const token = g.token;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled) return;
      // a strategy a teammate already took is not selectable (队友已选): the bot re-draws, else the first free one
      let id = botPickBand(this, ps);
      for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = botPickBand(this, ps);
      if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
      this._applyBand(ps, id, { dedupe: true });
    });
  }

  /**
   * Whether `bandId` was already picked by another player in this fixed pool group. Cross-group repeats are legal.
   * Research 09 §5 / DESIGN §14 corrections:
   * the strategy draft marks a teammate's pick as 队友已选 and it cannot be chosen again (co-op). The automatic
   * assignments — a turn that runs out and a departing seat — obey the same rule: see timeoutBand / defaultBand.
   */
  bandTaken(bandId, playerId) {
    const picks = this.draftGroup(playerId)?.picks || {};
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no teammate holds it, else the
   * first strategy of the mode (sortId order, gd.bandIds) that nobody else in this group picked — never a duplicate (队友已选; the
   * client shows the same choice: public/js/screens/bandDraft.js timeoutBand). Solo drafts have no teammates, so it is
   * always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId)) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || def;
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the draft
   * screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no teammate holds
   * it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const f = this.draft && this.draft.focus instanceof Map ? this.draft.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    const targetError = this.draftTargetError(d, this.draftGroup(ps.playerId), opts);
    if (targetError) return targetError;
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const targetError = this.draftTargetError(this.draft, this.draftGroup(ps.playerId), opts);
    if (targetError) return targetError;
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    const g = ps && this.draftGroup(ps.playerId);
    if (!d || !g || !ps.alive || ps.left || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    g.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn(g);
  }

  skipBand(ps, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    const g = this.draftGroup(ps.playerId);
    const targetError = this.draftTargetError(d, g, opts);
    if (targetError) return targetError;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(g.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (!g.order.slice(g.idx + 1).some((pid) => !d.picks[pid] && this.manualDraftPicker(this.players.get(pid)))) {
      return fail(ERR.BAD_TARGET, 'no manual teammate to pass to');
    }
    g.skipsLeft[ps.playerId]--;
    g.order.splice(g.idx, 1);
    g.order.push(ps.playerId);
    this.prioritizeDraftOrder(g.order, g.idx);
    this.startDraftTurn(g);
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    for (const g of this.draft.groups) this.clearDraftGroupTimer(g);
    for (const ps of this.order) {
      if (!ps.alive || ps.left) continue;
      if (!this.draft.picks[ps.playerId]) {
        // One after another in seat order, so each default sees earlier assignments within its group.
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        this.draftGroup(ps.playerId).picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    this.enterBattleCheck();
  }

  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.startRound(1), { silent: this.soloUntimed });
    this.markPublic();
  }

  startRound(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    this.fields = [];
    this.watchers.clear();
    this.unitePlan = null;
    this.uniteResultView = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    const isBoss = r === this.gd.bossRound || r === this.gd.hiddenRound;
    if (isBoss) {
      this._planBossWaves();
    } else {
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, r);
    }
    for (const ps of alive) ps.startRound(r);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
    // eliminated humans and spectator seats scout the board of the player they follow through the round's prep, not
    // their own empty board (community report of 2026-10-06, item 56; MatchWatch._followScout)
    for (const ps of this._viewers()) this._followScout(ps);
  }

  /** Stable per-match pairs and their templates, generated before the prep preview / board validation. */
  _planBossWaves() {
    const r = this.round;
    const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness.
    const groups = pairPlayers(this.alivePlayers(), createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    this.bossWaves = groups.map((g) => ({
      players: g.map((p) => p.playerId),
      wave: buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1 }),
    }));
  }

  afterRoundStart() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.enterPrep();
  }
}
