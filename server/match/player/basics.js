// server/match/player/basics.js — PlayerState methods: the basics — seat flags and counts (isHumanActive,
// botControlled, deployCap, deployCount, tempEmpty), the prep that resolves a temp piece (tempDue, _putTemp: every
// write into a temp slot), the operator loadout (DESIGN §16: setLoadout, loadoutFor; 0.2.2 潜能 / 练度: cultivationFor), the not-owned operators fielded
// as their stand-ins (0.2.0 补位: setNotOwned, fieldsStandIn, fieldRecord), the deploy map on the field the
// player deploys on (Match.deployFieldOf) and the withdrawal of pieces a terrain / deploy-field change left on tiles
// they may no longer occupy (_evictIllegal), dirty.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { PHASE } from '../../../shared/constants.js';
import { msg, dn } from '../../../shared/i18n.js';
import { checkLoadout, checkLoadoutOps, cultivationCharIds, checkNotOwned, resolveLoadout, charPotentialChanges } from '../../../shared/protocol.js';
import { cultivationOf } from '../../../shared/potential.js';
import { tileKey, boardOrder } from '../board.js';

/** The charIds a player may set a potential / 练度 for, per game-data object (shared/protocol.js cultivationCharIds). */
const OPS_IDS = new WeakMap();
function opsCharIds(raw) {
  if (!raw || typeof raw !== 'object') return new Set();
  let ids = OPS_IDS.get(raw);
  if (!ids) { ids = cultivationCharIds(raw.chess, raw.backups); OPS_IDS.set(raw, ids); }
  return ids;
}

export class PlayerBasics {
  get isHumanActive() { return !this.isBot && !this.left; }
  get pool() { return this.m.poolFor(this); }
  /** The engine acts for this seat (AI teammate or "AI 托管"; a departed human is eliminated, so nothing is left to do). */
  get botControlled() { return this.isBot || this.left || this.autoplay; }

  get deployCap() { return Math.max(1, this.gd.deployCap + this.deployCapBonus, this.deployCapMin); }
  get deployCount() { let n = 0; for (const p of this.board.values()) if (p.kind === 'chess') n++; return n; }
  get tempEmpty() { return this.temp.every((x) => x == null); }

  /**
   * Index of the prep whose deadline resolves a temp piece (compare with `prepsEnded`): recorded when the piece entered
   * temp (_putTemp); a piece put there by other means counts as due at the current (or next) prep.
   */
  tempDue(piece) {
    const due = piece ? this._tempDue.get(piece.uid) : undefined;
    return Number.isInteger(due) ? due : this.prepsEnded;
  }

  /**
   * Due prep of a piece entering temp now: the current prep while the player can still act on it (PREP, not ready);
   * after Ready or at the prep end (onPrepEnd grants) the next one; outside PREP (COMBAT, SETTLE, ROUND_START, 机变)
   * the next prep to end — `prepsEnded` then already names it.
   */
  _tempDueNow() {
    return this.prepsEnded + (this.m.phase === PHASE.PREP && this.ready ? 1 : 0);
  }

  /** Every write of a piece into a temp slot goes through here (records its due prep). */
  _putTemp(i, piece) {
    this.temp[i] = piece;
    this._tempDue.set(piece.uid, this._tempDueNow());
  }

  /**
   * Replace the operator loadout (DESIGN §16) — and, when `ops` is given, the per-operator 潜能 / 练度 (0.2.2; null = none
   * set, undefined = unchanged) — after re-checking them against this match's data. Accepts the checked form
   * `{ id: { skill, module|null } }` or raw `room.loadout` entries, and the checked or raw `ops`. Returns false (nothing
   * changes) when either does not fit the data; bots keep the defaults.
   * @param {any} loadout
   * @param {any} [ops]
   * @returns {boolean}
   */
  setLoadout(loadout, ops = undefined) {
    if (this.isBot) return false;
    let opsRes = null;
    if (ops !== undefined) {
      const raw = {};
      if (ops && typeof ops === 'object' && !Array.isArray(ops)) {
        for (const [id, e] of Object.entries(ops)) {
          if (!e || typeof e !== 'object') continue;
          const x = {};
          if (Number.isInteger(e.potential)) x.potential = e.potential;
          if (Number.isInteger(e.cultivate)) x.cultivate = e.cultivate;
          if (Object.keys(x).length) raw[id] = x;
        }
      }
      const ids = opsCharIds(this.gd.raw);
      opsRes = checkLoadoutOps(raw, (id) => ids.has(id), (id) => charPotentialChanges(this.gd.raw, id));
      if (!opsRes || !opsRes.ok) {
        this.m.log?.warn?.(`[match ${this.m.roomCode}] operator settings of ${this.playerId} ignored: ${opsRes && opsRes.detail}`);
        return false;
      }
    }
    const entries = {};
    if (loadout && typeof loadout === 'object' && !Array.isArray(loadout)) {
      for (const [id, e] of Object.entries(loadout)) {
        if (!e || typeof e !== 'object') continue;
        const x = {};
        if (Number.isInteger(e.skill)) x.skill = e.skill;
        if (typeof e.module === 'string') x.module = e.module;
        if (Object.keys(x).length) entries[id] = x;
      }
    }
    const res = checkLoadout(entries, (id) => this.gd.chess(id));
    if (!res || !res.ok) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] loadout of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const out = {};
    for (const [id, e] of Object.entries(res.loadout)) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
    this.loadout = Object.freeze(out);
    if (opsRes) {
      const o = {};
      for (const [id, e] of Object.entries(opsRes.ops)) o[id] = Object.freeze({ potential: e.potential, cultivate: e.cultivate });
      this.ops = Object.freeze(o);
    }
    return true;
  }

  /**
   * The potential / 练度 this player's piece of chess record `chessRecord` fights at (0.2.2; shared/potential.js
   * cultivationOf over `this.ops` — defaults 潜能 6, 精英2 Lv.60): the operator the player owns — the chess fielded as
   * itself, an owned 自选 pick (its charId) — or null for a 补位 stand-in and a prototype 自选 pick.
   * @param {object|null} chessRecord
   * @returns {{ potential: number, cultivate: number } | null}
   */
  cultivationFor(chessRecord) {
    if (!chessRecord || this.fieldsStandIn(chessRecord)) return null;
    const rec = chessRecord.isDiy && typeof chessRecord.chessId === 'string' ? this.gd.chess(chessRecord.chessId) || chessRecord : chessRecord;
    return cultivationOf(rec, this.ops);
  }

  /**
   * The skill index / module a chess record fights with under this player's loadout (DESIGN §16) — for a chess this
   * player fields as its stand-in (0.2.0 补位) the stand-in's backup selection, whatever the loadout says; for a slotted
   * 自选 slot (0.2.0, player/diy.js) its pick's skill and module (the composed record's defaults — the loadout never names
   * a DIY slot: shared/protocol.js checkLoadout).
   */
  loadoutFor(chessRecord) {
    if (this.fieldsStandIn(chessRecord)) {
      return { ...resolveLoadout(null, this.gd.standIn(chessRecord.chessId), (id) => this.gd.standIn(id) || this.gd.chess(id)), potential: null, cultivate: null };
    }
    const rec = chessRecord && chessRecord.isDiy && typeof chessRecord.chessId === 'string' ? this.gd.chess(chessRecord.chessId) || chessRecord : chessRecord;
    // 0.2.2: with the operator's potential / 练度 (null for a prototype 自选 pick) — the 自选 summons' hand count reads it
    const cv = this.cultivationFor(chessRecord);
    return { ...resolveLoadout(this.loadout, rec, (id) => this.gd.chess(id)), potential: cv ? cv.potential : null, cultivate: cv ? cv.cultivate : null };
  }

  /**
   * Replace the not-owned list (0.2.0 补位; the seat's list at the match start — the setting never changes during a
   * match): keeps the droppable chess (checkNotOwned) whose stand-in this match's data has. Bots own every operator.
   * @param {any} list base chess ids
   * @returns {boolean} false when the list is malformed (nothing changes) or the player is a bot
   */
  setNotOwned(list) {
    if (this.isBot) return false;
    const res = checkNotOwned(list, (id) => this.gd.chess(id));
    if (!res || !res.ok) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] not-owned list of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const ids = res.notOwned.filter((id) => !!this.gd.standIn(id));
    this.standIns = Object.freeze(ids);
    this._standInSet = new Set(ids);
    return true;
  }

  /**
   * Whether this player's piece of chess record (or id) `rec` fights as its stand-in (0.2.0 补位): its base chess is
   * in `standIns` and the data has the stand-in. Normal and elite alike (the elite uses the same backup).
   * @param {object|string|null} rec
   */
  fieldsStandIn(rec) {
    if (!this._standInSet || this._standInSet.size === 0 || !rec) return false;
    const r = typeof rec === 'string' ? this.gd.chess(rec) : rec;
    if (!r || typeof r.chessId !== 'string') return false;
    return this._standInSet.has(r.baseId || r.chessId) && !!this.gd.standIn(r.chessId);
  }

  /**
   * The record this player's piece of chess record `rec` fights with (0.2.0 补位): the stand-in record
   * (gd.standIn — the chess's identity, the stand-in's body) when the player fields its stand-in; for a DIY slot record
   * the player's 自选 record of that slot (this.gd — a caller holding the match's own record of the slot gets the
   * operator); else `rec` itself. Rules about the unit's body read it (placement class, summon / bot ranges), and so
   * does what shows the piece (the scouting art, the elite / gift tickers' names — the owner's recall of 2026-10-06: the official
   * mode shows the stand-in everywhere); rules about the chess (price, bonds, 特质, merges, pools) keep reading gd.chess.
   * @param {object|null} rec
   */
  fieldRecord(rec) {
    if (rec && this.fieldsStandIn(rec)) return this.gd.standIn(rec.chessId) || rec;
    if (rec && rec.isDiy && !rec.diyFor && typeof rec.chessId === 'string') return this.gd.chess(rec.chessId) || rec;
    return rec;
  }

  /**
   * Deploy classes of the board tiles (server/match/board.js buildDeployMap) on the field the player deploys on now
   * (Match.deployFieldOf: the own board, or its half of the boss field in a boss round — user playtest #5 item 7).
   * A change of that field (the boss round begins, a re-pairing) re-checks the board's legality like a terrain change.
   */
  deployMap() {
    const field = typeof this.m.deployFieldOf === 'function' ? this.m.deployFieldOf(this) : 'normal';
    if (this._deployMap && this._deployField !== undefined && this._deployField !== field) {
      this._deployMap = null;
      this._legalityStale = true;
    }
    if (!this._deployMap) this._deployMap = this.m.deployMapFor(this, field);
    this._deployField = field;
    return this._deployMap;
  }
  /**
   * The board's terrain changed (terrain 机变 cards, content device / tile overrides): legality is re-checked at the
   * next recompute() / battleInput() — after the whole change, so an intermediate state of a card that toggles several
   * devices never moves a piece.
   */
  invalidateDeployMap() { this._deployMap = null; this._legalityStale = true; }

  /**
   * After a terrain change, pieces standing on tiles they may no longer occupy (a melee operator on a tile that became
   * a 射击台, anything on a tile that became undeployable) are withdrawn like 撤退: an operator goes to the hand
   * (overflow temp — a passive move; the player re-places it during the prep), its summons leave the board with it; a
   * summon returns to its owner's stack. Nothing is lost: with the hand and the visible temp row both full the piece
   * joins the expandable overflow queue (PRTS 卫戍协议/帮助 §手牌区).
   * @returns {number} pieces moved
   */
  _evictIllegal() {
    this._legalityStale = false;
    const names = [];
    let moved = 0;
    for (const kind of ['chess', 'token']) {
      for (const { r, c, piece } of boardOrder(this.board)) {
        if (piece.kind !== kind || this._legal(piece, r, c)) continue;
        const key = tileKey(r, c);
        this.board.delete(key);
        const ok = kind === 'chess' ? !!this.stow(piece, { allowTemp: true }) : this._returnToken(piece);
        if (!ok) { this.board.set(key, piece); continue; }
        moved++;
        if (kind === 'chess') {
          this.removeTokensOf(piece.uid);
          const rec = this.gd.chess(piece.id);
          names.push(rec && rec.name ? rec.name : piece.id);
        }
      }
    }
    if (names.length) this.m.toast(this, 'warn', msg('地形变化：{names}无法停留在原位置，已撤回整备区', { names: names.map(dn) }));
    return moved;
  }

  dirty() { this.m.markPrivate(this); }
}
