// server/sim/content/kits/shared/tier3.js — helpers and notes of the hand-authored kits for the 21 tier-3 chess (19
// visible + 见行者/巫恋 hidden; formerly tier3.js — the kits live one per file in ../ops/).
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). `bb` is the skill blackboard at the
// chess's level (normal Lv4 `_a` / elite Lv7 `_b`), `chess` the data/chess.json record (talents incl. module upgrades,
// trait incl. module trait bb), `def` the normalised def. Every number comes from a blackboard; the few values that
// only exist in the text ("三连击", "至多5个", "初始两只", "至多3只") are parsed from the description with fallbacks.
// Profession defaults (server/sim/professions.js) are kept and extended: fastshot fly bonus, instructor, reaperrange,
// hunter ammo, funnel ramp, phalanx guard, merchant drain, tactician reinforcement, underminer module weaken.
// Summons: the match hands 伺夜's 狼群 and 巫恋's 诅咒娃娃 to the player as placeable board pieces (tokens.js kits);
// 伺夜's kit adopts his pack piece instead of adding a second pack, 巫恋's S2 brings her placed doll onto its tile
// (tokens.js releaseSkillSummon), and every summon tile avoids the home tile of an ally that has not (re)deployed yet
// (freeTile). Offensive skills whose own range differs from the attack
// range trigger on that skill range (CUSTOM_RANGE: 松果 shortened range, 见行者 push row — research 03 §1.4).
//
// Client VFX (battle.fx kinds used here, all `{x, y, id, …extra}`): 'aoe' (radius, dmgType), 'strike' (special single
// hit), 'volley' (multi-target shot), 'push', 'pull', 'summon' (token), 'coin' (n), 'dp' (n), 'revive', 'buff',
// 'shield', 'shieldBreak', 'camouflage', 'explode'.
//
// Operator loadouts (DESIGN §16): the kit is built for the SELECTED skill (`bb`, `chess.skill`, `def.skill`) and module
// (talents / trait bb). `skill` is the default skill's spec; `skills: { [skillId]: SkillSpec }` holds every other
// selectable skill of the visible chess, each built from its OWN record at the chess's level (skillData: Lv4 normal /
// Lv7 elite blackboard, range, charges) — the loader picks the selected one. Talents / trait / install are shared: the
// parts that belong to one skill only (琳琅诗怀雅 bombs, 菲莱 counters, 雪猎 special bullets…) check the selected skill id.
// Triggers come from the data record of each skill (skills[i].trigger: tools/build-data.mjs resolveTrigger — the official
// 技能策略 incl. SKILL_RANGE for a MANUAL skill's own 技能范围 and the class rows for every MANUAL skill; ACTIVE_RANGE, the
// owner's rule of 2026-10-05, for a MANUAL basic-strategy or SEARCH-row skill whose running range strictly contains the
// own one — 薄绿 S1 on its x-2), except the kits' own automatic casts (雪猎 special bullets, 伺夜 S1 / S2's pack check).
// Non-default modules: 能天使 MAR-Y (ASPD vs ground), 琳琅诗怀雅 MER-Y (ATK per payment), 斯卡蒂 DRE-X (× vs blocked), 瑕光 GUA-X (heal × under 50 %), 伺夜 TAC-Y (×165 % trait, pack-blocked enemies taunt +1),
// 空弦 MAR-X (fly ×, profession layer). No in-battle effect here: 忍冬 SOL-Y "首次部署时部署费用-4" (the initial
// deployment is free) and the 集成战略-only ISW-A modules of 琳琅诗怀雅 / 空弦 (their stats and trait cost still apply).

import { textCount, textFinite } from '../../../../../shared/plugins/textNumber.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { COLS } from '../../../constants.js';
import { bodyInRange } from '../../../body.js';
import { normalizeChess, normalizeSkill } from '../../../simdata.js';
import { tacticalPoint as sharedTacticalPoint } from '../../tokens.js';

// ---------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const defOf = (chess, def) => def ?? normalizeChess(chess);
const talentBb = (d, i) => d?.talents?.[i]?.bb ?? {};
const traitBb = (d) => d?.traitBb ?? {};
/** Module-only talent (data: `hidden && fromModule`, e.g. 空弦 精锐 "范围内存在地面敌人时攻击速度+8"). */
const moduleTalentBb = (chess) => (chess?.talents ?? []).find((t) => t && t.hidden && t.fromModule)?.bb ?? null;
/** Id of the SELECTED skill the kit is built for (DESIGN §16: `bb`, `chess.skill` and `def.skill` belong to it). */
const selectedId = (chess, d) => d?.skill?.id ?? chess?.skill?.skillId ?? null;
/**
 * Normalised record (simdata normalizeSkill shape: bb, rangeGrid, maxCharges, duration, description, trigger) of the
 * selectable skill `id` at this chess's level: the selected one is `def.skill` with the kit's `bb`, any other comes
 * from `chess.skills[]` (DATA §2.2) — every spec of `skills` is built from its own numbers whichever skill is selected.
 */
function skillData(chess, d, bb, id) {
  if (id != null && selectedId(chess, d) === id && d?.skill) return { ...d.skill, bb: bb ?? d.skill.bb ?? {} };
  const rec = (chess?.skills ?? []).find((s) => s && s.skillId === id);
  return (rec && normalizeSkill({ skill: rec })) || { id, bb: {}, rangeGrid: null, maxCharges: 1, duration: 0, description: '' };
}
/** `{ [skillId]: SkillSpec }` of the non-default selectable skills: `builders[id](skillData(id))` each. */
function altSkills(chess, d, bb, builders) {
  const out = {};
  for (const [id, build] of Object.entries(builders)) out[id] = build(skillData(chess, d, bb, id));
  return out;
}
/** instant, or charges when the skill stores several (可充能N次). */
const instantKindOf = (s) => ((s?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');
/** Timed stat skill (迅捷打击 / 攻击力强化 / 防御力强化 …): bb atk / def / max_hp / attack_speed on the operator. */
const statSkill = (s) => {
  const b = s.bb || {};
  const mods = {};
  if (num(b.atk)) mods.atkPct = num(b.atk);
  if (num(b.def)) mods.defPct = num(b.def);
  if (num(b.max_hp)) mods.hpPct = num(b.max_hp);
  if (num(b.attack_speed)) mods.aspd = num(b.attack_speed);
  return { kind: 'duration', mods };
};
/**
 * "范围内存在地面敌人时攻击速度+N" (能天使 MAR-Y trait, 空弦 MAR-Y talent): ASPD buff `key` while at least `cnt` ground
 * enemies stand in the current range.
 */
function groundAspd(key, aspd, cnt = 1) {
  return (battle, unit) => {
    let on = false;
    battle.every(0.1, () => {
      const n = alive(unit) ? battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => !e.isFlying).length : 0;
      const want = n >= Math.max(1, cnt);
      if (want === on && (!want || unit.findBuff(key))) return;
      on = want;
      if (want) battle.addBuff(unit, { key, mods: { aspd } });
      else battle.removeBuff(unit, key);
    }, { owner: unit });
  };
}
const alive = (u) => !!(u && u.alive && u.deployed);
const tileKeyOf = (u) => (u.side === 'ally' ? u.tileR * COLS + u.tileC : Math.round(u.y) * COLS + Math.round(u.x));
/** On a tile of `set`: an ally by its tile, an enemy by its body (every tile a huge enemy occupies — sim/body.js). */
const onTiles = (x, set) => (x.side === 'ally' ? set.has(tileKeyOf(x)) : bodyInRange(x, set));
const gridKeys = (grid, u, ext = 0) => absoluteRangeKeys(grid || [[0, 0]], u.tileR, u.tileC, u.dir, ext);
const fx = (battle, kind, u, extra = {}) => battle.fx(kind, { x: u.x, y: u.y, id: u.id, ...extra });
const copyGrid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);
const NINE = [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
/** Finite capture (arabic or one chinese numeral). Counts go through textCount. */
function textNum(text, re, fallback) {
  return textFinite(text, re, fallback);
}
/**
 * A tile a summon may take: inside the field and not reserved (Battle.isReservedTile: nobody on it, no knocked-out
 * operator lying there, not the home tile of an ally that has not deployed yet / waits to redeploy — the initial
 * deployment runs one unit after another: a summon placed while it runs must not steal a later board unit's tile).
 */
function freeTile(battle, r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c);
}
/** Walkable ground tile a melee summon can stand on. */
const groundTile = (battle, r, c) => battle.grid.groundPassable(r, c) && battle.grid.canStand(r, c);
/**
 * Tactical point (战术点) of a tactician: `prefer` (the board piece's tile, i.e. the player's choice) when usable —
 * free, standable ground (never 深水区: grid.canStand) inside her initial range ("只能部署在召唤者攻击范围内"; the prep
 * already keeps the piece there, PlayerState._legal) —, else the shared tactical point (tokens.js tacticalPoint =
 * Battle.findTacticalPoint: a free walkable tile of its initial range on an enemy ground path first, then the nearest).
 */
function tacticalPoint(battle, unit, prefer = null) {
  const inRange = (r, c) => (unit.baseRangeKeys || unit.rangeKeys || []).includes(r * COLS + c);
  if (prefer && freeTile(battle, prefer[0], prefer[1]) && groundTile(battle, prefer[0], prefer[1]) && inRange(prefer[0], prefer[1])) return prefer;
  return sharedTacticalPoint(battle, unit);
}

/** Targetable enemies on `keys`, sorted by the unit's priority (at most `n` when n > 0). */
function enemiesOn(battle, unit, keys, n = 0, profile = null) {
  const list = battle.enemiesInKeys(keys, unit, profile ?? { canHitFly: true });
  sortEnemyTargets(battle, unit, list, (profile ?? unit.profile)?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

/**
 * Tile aura: every `interval` s (0 ⇒ call the returned update() yourself, e.g. from a skill onTick) buffs the
 * units of `side` standing on `tiles()` (filter/mods per unit, mods null ⇒ skipped) and drops the buff from units
 * that left. update.clear() removes everything this aura applied. Same-key auras of several sources do not stack.
 */
function aura(battle, unit, o) {
  let cur = new Set();
  const iv = o.interval ?? 0.2;
  const dur = Math.max(iv * 2, 0.1) + 0.05;
  const drop = (x) => { const b = x.findBuff(o.key); if (b && b.source === unit) battle.removeBuff(x, b); };
  const update = () => {
    const next = new Set();
    if (alive(unit) && (!o.active || o.active())) {
      const keys = o.tiles();
      const set = keys instanceof Set ? keys : new Set(keys || []);
      const list = o.side === 'ally' ? battle.allyUnits : battle.enemies;
      for (const x of list) {
        if (!x.alive || !x.deployed || x.hidden || x.kind === 'device') continue;
        if (o.side === 'ally' && !battle.allySelectable(x, unit)) continue; // never a 孤立 unit (炎佑)
        if (!onTiles(x, set) || (o.filter && !o.filter(x))) continue;
        const mods = typeof o.mods === 'function' ? o.mods(x) : o.mods;
        if (!mods) continue;
        battle.addBuff(x, { key: o.key, duration: dur, refresh: 'extend', mods, source: unit, tags: ['aura'] });
        next.add(x);
      }
    }
    for (const x of cur) if (!next.has(x)) drop(x);
    cur = next;
  };
  update.clear = () => { for (const x of cur) drop(x); cur = new Set(); };
  // immediate: installed at construction ⇒ first runs right after the initial deployment (t = 0), not 1 interval later
  if (iv > 0) battle.every(iv, update, { owner: unit, immediate: true });
  return update;
}

/** Buff present exactly while `cond()` holds (checked every tick). */
function whileTrue(battle, unit, key, cond, mods) {
  battle.on('tick', () => {
    const on = alive(unit) && cond();
    const has = !!unit.findBuff(key);
    if (on && !has) battle.addBuff(unit, { key, mods: typeof mods === 'function' ? mods() : mods });
    else if (!on && has) battle.removeBuff(unit, key);
  }, { owner: unit });
}

/** Team-wide talents never stack: only the lowest-id living carrier of `tag` of this player applies them. */
function isLeader(battle, unit, tag) {
  let best = null;
  for (const a of battle.allyUnits) if (alive(a) && a.ownerId === unit.ownerId && a.mem[tag] && (!best || a.id < best.id)) best = a;
  return best === unit;
}

/** SP gain that respects "no SP while a timed skill runs". */
function giveSp(u, n, reason = 'talent') {
  const sk = u?.skill;
  if (!sk || sk.noSkill || !(n > 0) || (sk.active && sk.isTimed)) return 0;
  return sk.gainSp(n, reason);
}

/**
 * Funnel ramp tracked per target (耶拉's 2 drones each ramp on their own lock; 1 drone = profession behaviour). Two
 * drones locked on the same enemy land in the same tick: they ramp in parallel (one step per volley, same scale).
 */
function funnelMap(battle, unit, target) {
  const f = unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
  const m = unit.trait.funnelMap || (unit.trait.funnelMap = new Map());
  const prev = m.get(target.id);
  if (prev && prev.t === battle.time) return prev.s;
  const s = prev == null ? f.init : Math.min(f.max, prev.s + f.delta);
  m.set(target.id, { s, t: battle.time });
  return s;
}
/** Drones return when their lock is dropped: forget ramps of enemies no longer attacked. */
function installFunnelPrune(battle, unit) {
  battle.on('beforeAttack', (ctx) => {
    if (ctx.attacker !== unit || !unit.trait.funnelMap) return;
    const ids = new Set(ctx.targets.map((t) => t.id));
    for (const k of [...unit.trait.funnelMap.keys()]) if (!ids.has(k)) unit.trait.funnelMap.delete(k);
  }, { owner: unit, priority: -100 });
}

export {
  num, defOf, talentBb, traitBb, moduleTalentBb, selectedId, altSkills, instantKindOf, statSkill, groundAspd, alive,
  onTiles, gridKeys, fx, copyGrid, NINE, textNum, textCount, freeTile, groundTile, tacticalPoint, enemiesOn, aura, whileTrue,
  isLeader, giveSp, funnelMap, installFunnelPrune,
};
