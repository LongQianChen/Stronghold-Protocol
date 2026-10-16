// shared/potential.js — operator potential (潜能 1–6) as a runtime input, and the 自持有 练度 bonus (0.2.2; the owner's
// decision of 2026-10-08: 「调配干员里自己设置吧，默认满潜满加成」). Pure ESM shared by the build (tools/build-data.mjs
// proves the composition below rebuilds every record at every potential), the simulation (server/sim/simdata.js), the
// server (PlayerState) and the client (干员调配 / detail cards).
//
// Official (调度手册 autochess_shop_3 「卫戍协议中干员潜能由自身已持有干员潜能决定」; PRTS 卫戍协议 「干员的潜能等级始终以自身
// 持有状态为准」): an operator fights at the player's own potential; the season's chess rows carry none. The data records
// (data/chess.json, data/backups.json forms, the token variants of data/tokens.json and backups.json `tokens`) are
// built at FULL potential (潜能 6 = rank 5, the default) and carry what any lower potential changes (docs/DATA.md §2.3):
//   * `potDown` on a record / form / token variant: `{ "<rank>": { "<dotted.path>": value } }` — the exact value at that
//     rank of every leaf (stats.cost, statsBase.atk, count, stats.deployLimit, byModule.<id>.stats.deckStack …) that
//     differs from the rank above; applied from rank 4 down to the wanted rank (each overwrites), so a leaf ends at its
//     value for that rank (the potentialRanks attribute steps: 「部署费用-1」, 「攻击力+22」, 「再部署时间-4秒」 …);
//   * on a talent entry (talents / talentsBase / modules[].talentChanges / a variant's talents and byModule talents):
//     `potMin` = the lowest rank the entry holds for and `potBelow` = the fields the entry below it changes (desc /
//     descRaw / bb …; itself chained): the talent candidates by `requiredPotentialRank` (「天赋效果增强」: 刺玫's
//     土壤基肥改良 11% → 8% below rank 4). A summon's talents follow its OWNER's potential (their candidates mirror the
//     owner's steps; DESIGN §26.14).
// Data rank r = potential − 1 (character_table `potentialRanks[r]` is the step from rank r to r + 1).
//
// 练度 (cultivate 0–3, activity_table autoChessData.cultivateEffectList): the effects.json CHAR_MAP records
// aceffect_char_1 … 4 — 未精英化 / 精英阶段1 / 精英阶段2 / 精英阶段2-60级 — whose `char_attribute_mul` buff multiplies ATK /
// DEF / max HP (×1 / ×1.05 ATK, DEF / ×1.1 ATK, ×1.05 DEF, HP / ×1.1 all three): a multiplier of its own (the sim's Πmul),
// never summed with the 直接乘算 bonuses (PRTS 盟约记录 「…均为直接乘算，与自持有干员的属性加成独立」). Only an owned operator
// of the same name has it — initial, elite and 自选 forms alike; a 补位 stand-in and a prototype 自选 pick have neither
// potential nor 练度 (`cultivationOf`).

/** Potential bounds (潜能 1–6) and the default (full potential, the data's own). */
export const POTENTIAL_MIN = 1;
export const POTENTIAL_MAX = 6;
export const POTENTIAL_DEFAULT = 6;
/** The data rank every record is built at (potential 6). */
export const FULL_RANK = POTENTIAL_MAX - 1;

/** The 练度 tiers: effects.json CHAR_MAP effect ids in cultivateEffectList order (cultivateNum 1 / 1001 / 2001 / 2060). */
export const CULTIVATE_EFFECTS = Object.freeze(['aceffect_char_1', 'aceffect_char_2', 'aceffect_char_3', 'aceffect_char_4']);
export const CULTIVATE_MAX = CULTIVATE_EFFECTS.length - 1;
/** The default 练度: 精英阶段2-60级 (the owner's 「默认满潜满加成」). */
export const CULTIVATE_DEFAULT = CULTIVATE_MAX;

/** Is `v` a potential (integer 1–6)? */
export const isPotential = (v) => Number.isInteger(v) && v >= POTENTIAL_MIN && v <= POTENTIAL_MAX;
/** Is `v` a 练度 tier (integer 0–3)? */
export const isCultivate = (v) => Number.isInteger(v) && v >= 0 && v <= CULTIVATE_MAX;
/** The data rank of a potential (anything else: full potential). */
export const rankOf = (potential) => (isPotential(potential) ? potential - 1 : FULL_RANK);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

/**
 * A talent entry at data rank `rank`: its `potBelow` chain followed while `rank < potMin`, returned without the chain
 * fields (a copy only when the entry carries them).
 * @param {any} t @param {number} rank
 */
export function talentAtRank(t, rank) {
  if (!isObj(t) || !(own(t, 'potMin') || own(t, 'potBelow'))) return t;
  const { potMin: _m, potBelow: _b, ...out } = t;
  // each `potBelow` holds the fields its rank changes (a partial entry); merged down the chain
  let x = t;
  while (isObj(x.potBelow) && rank < (Number.isInteger(x.potMin) ? x.potMin : 0)) {
    x = x.potBelow;
    for (const [k, v] of Object.entries(x)) if (k !== 'potMin' && k !== 'potBelow') out[k] = v;
  }
  return out;
}

/** A talent list at data rank `rank` (talentAtRank of every entry). */
export function talentsAtRank(list, rank) {
  return Array.isArray(list) ? list.map((t) => talentAtRank(t, rank)) : list;
}

/** `obj` with the `potDown` leaves of ranks FULL_RANK − 1 … `rank` applied (copy-on-write; `potDown` dropped). */
function applyPotDown(obj, rank) {
  const out = { ...obj };
  delete out.potDown;
  const down = obj.potDown;
  if (!isObj(down)) return out;
  const copied = new Set([out]);
  for (let r = FULL_RANK - 1; r >= rank; r--) {
    const step = down[String(r)];
    if (!isObj(step)) continue;
    for (const [path, value] of Object.entries(step)) {
      const keys = path.split('.');
      // [ASSUMED] Potential and loadout overlays are stat leaves. They cannot attach behavior (`dsl`) or
      // identity (`pluginId`), and a missing leaf of those names is not created (DESIGN §32.7).
      if (keys.some((k) => k === 'dsl' || k === 'pluginId')) continue;
      let cur = out;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = Array.isArray(cur) ? Number(keys[i]) : keys[i];
        const next = cur[k];
        if (!next || typeof next !== 'object') { cur = null; break; }
        if (!copied.has(next)) { cur[k] = Array.isArray(next) ? next.slice() : { ...next }; copied.add(cur[k]); }
        cur = cur[k];
      }
      if (cur) cur[Array.isArray(cur) ? Number(keys[keys.length - 1]) : keys[keys.length - 1]] = value;
    }
  }
  return out;
}

/**
 * A record / backups form / token variant at data rank `rank`: its `potDown` applied and every talent list resolved —
 * `talents`, `talentsBase`, `modules[].talentChanges`, `byModule[*].talents` (a variant's `bySkill` holds no talents).
 * `rank` ≥ FULL_RANK (or no potential data) returns `obj` itself.
 * @template T
 * @param {T} obj
 * @param {number} rank
 * @returns {T}
 */
export function atRank(obj, rank) {
  if (!isObj(obj) || !(Number.isInteger(rank) && rank >= 0 && rank < FULL_RANK)) return obj;
  const out = applyPotDown(obj, rank);
  for (const k of ['talents', 'talentsBase']) if (Array.isArray(out[k])) out[k] = talentsAtRank(out[k], rank);
  if (Array.isArray(out.modules)) {
    out.modules = out.modules.map((m) => (isObj(m) && Array.isArray(m.talentChanges) ? { ...m, talentChanges: talentsAtRank(m.talentChanges, rank) } : m));
  }
  if (isObj(out.byModule)) {
    const bm = {};
    for (const [id, m] of Object.entries(out.byModule)) bm[id] = isObj(m) && Array.isArray(m.talents) ? { ...m, talents: talentsAtRank(m.talents, rank) } : m;
    out.byModule = bm;
  }
  return out;
}

/**
 * A data/chess.json record (or a backups form, or a token variant) at `potential` (1–6; anything else = full
 * potential, the record itself) — atRank of its data rank.
 * @template T
 * @param {T} rec
 * @param {number|null|undefined} potential
 * @returns {T}
 */
export function atPotential(rec, potential) {
  return isPotential(potential) && potential < POTENTIAL_MAX ? atRank(rec, potential - 1) : rec;
}

/** Whether a record / form / variant changes below full potential at all (`potDown` or a chained talent list). */
export function hasPotentialData(obj) {
  if (!isObj(obj)) return false;
  if (isObj(obj.potDown) && Object.keys(obj.potDown).length) return true;
  const chained = (list) => Array.isArray(list) && list.some((t) => isObj(t) && isObj(t.potBelow));
  if (chained(obj.talents) || chained(obj.talentsBase)) return true;
  if (Array.isArray(obj.modules) && obj.modules.some((m) => chained(m?.talentChanges))) return true;
  return isObj(obj.byModule) && Object.values(obj.byModule).some((m) => chained(m?.talents));
}

/**
 * A deep copy of `v` without the potential annotations (`potDown`, `potMin`, `potBelow`): what a record built at one
 * rank looks like (the build's self-check; tests).
 */
export function stripPotential(v) {
  if (Array.isArray(v)) return v.map(stripPotential);
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (k !== 'potDown' && k !== 'potMin' && k !== 'potBelow') out[k] = stripPotential(x);
  return out;
}

// ---- 练度 (自持有) ---------------------------------------------------------------------------------------------------

/**
 * The ATK / DEF / max HP multipliers of 练度 tier `cultivate` (0–3): the `char_attribute_mul` buff of its effects.json
 * CHAR_MAP record (a key the record does not name is ×1: aceffect_char_1 names only atk 1). Null for no tier / no data.
 * @param {any} effects data/effects.json (or a lookup `(id) => record`)
 * @param {number|null|undefined} cultivate
 * @returns {{ atk: number, def: number, hp: number } | null}
 */
export function cultivateMul(effects, cultivate) {
  if (!isCultivate(cultivate)) return null;
  const id = CULTIVATE_EFFECTS[cultivate];
  const rec = typeof effects === 'function' ? effects(id) : own(effects, id) ? effects[id] : null;
  const buff = isObj(rec) && Array.isArray(rec.buffs) ? rec.buffs.find((b) => isObj(b) && b.key === 'char_attribute_mul') : null;
  if (!buff) return null;
  const bb = isObj(buff.bb) ? buff.bb : {};
  const m = (k) => (typeof bb[k] === 'number' && Number.isFinite(bb[k]) && bb[k] > 0 ? bb[k] : 1);
  return { atk: m('atk'), def: m('def'), hp: m('max_hp') };
}

/**
 * Stats with a 练度 multiplier applied to ATK / DEF / max HP (what the unit's own numbers read: the detail card, the
 * 干员调配 局内数值). The sim keeps the multiplier on the unit (units.js Πmul): these are the same products.
 * @param {any} stats @param {{ atk: number, def: number, hp: number } | null} mul
 */
export function cultivatedStats(stats, mul) {
  if (!isObj(stats) || !mul) return stats;
  const out = { ...stats };
  if (typeof out.atk === 'number') out.atk *= mul.atk;
  if (typeof out.def === 'number') out.def *= mul.def;
  if (typeof out.maxHp === 'number') out.maxHp *= mul.hp;
  return out;
}

/**
 * The potential / 练度 a player's piece of record `rec` fights at, from the player's per-operator settings `ops`
 * (`{ [charId]: { potential?, cultivate? } }`; a missing entry or field is the default — 潜能 6, 精英阶段2-60级), or null
 * when it has neither: a 补位 stand-in (`standInFor`) or a prototype 自选 pick (`diyProto`) — another character than
 * the operator the player owns.
 * @param {any} rec a chess record or a composed 自选 / stand-in record
 * @param {Record<string, { potential?: number, cultivate?: number }> | null | undefined} ops
 * @returns {{ potential: number, cultivate: number } | null}
 */
export function cultivationOf(rec, ops) {
  if (!isObj(rec) || rec.standInFor || rec.diyProto || typeof rec.charId !== 'string' || !rec.charId) return null;
  const e = own(ops, rec.charId) && isObj(ops[rec.charId]) ? ops[rec.charId] : null;
  return {
    potential: e && isPotential(e.potential) ? e.potential : POTENTIAL_DEFAULT,
    cultivate: e && isCultivate(e.cultivate) ? e.cultivate : CULTIVATE_DEFAULT,
  };
}
