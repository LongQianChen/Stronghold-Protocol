// server/sim/content/kits/shared/tier4.js — helpers and notes of the hand-authored kits for every tier-4 chess (26: 22
// visible + 4 hidden; formerly tier4.js — the kits live one per file in ../ops/).
// export default { [baseChessId]: (bb, chess, def) => Kit }  (docs/SIM.md §7.2). The same kit serves the elite
// (精锐 `_b`) id: `bb` is the Lv4 / Lv7 skill blackboard, talent/trait blackboards come from `def` (module talent and
// trait upgrades of elites are already merged into the data), `def.raw.module.active` tells whether the module runs.
// Every number comes from a blackboard (skill `bb`, `def.talents[i].bb`, `def.traitBb`, token data); literals below
// are only fall-backs for missing keys or documented [ASSUMED] shapes (tornado radius …).
//
// Notes shared by several kits:
// - `base_attack_time` in skill blackboards is a FLAT change of the base attack time in seconds (白面鸮 −1.8 on 2.85 s
//   ⇒ 1.05 s; 水月 −0.7 on 3.5 s) and is converted to the engine's `batPct` (÷ base BAT). 焰尾's +0.7 (text: 攻击间隔
//   缩短) is a multiplier (×0.7) and 信仰搅拌机's 0.6 is the counter interval ratio — both handled in their kits.
// - "技力光环 (同类效果取最高)" (莫斯提马, 白面鸮) share the buff key `aura:spRecovery`; a unit keeps the highest one.
// - Auras refresh short buffs every AURA s so they lapse within a few ticks after the source leaves.
// - Talents that name a faction use data fields: nationId (拉特兰 laterano, 卡西米尔 kazimierz, 谢拉格 kjerag),
//   profession (术师 CASTER, 重装 TANK, 先锋 PIONEER), enemy tags (萨卡兹 sarkaz, 海怪 seamonster); 深海猎人 = research
//   groupId `abyssal` (data/chess.json has no groupId: charIds from docs/research/03-operators.json).
// - "友方干员" effects touch operators only (summons/devices excluded); SP gifts skip units whose timed skill runs
//   (AK: no SP gain during a skill — the engine's gainSp enforces it too; the kits skip such units when picking).
// - On-hit effects of 卡涅利安's attacks land on every enemy the attack strikes — the 阵法术师 trait strikes every enemy
//   on her range at once (professions.js `allInRange` / `rangeAoe`, community report E3): S2's 停顿 / 束缚 via a
//   `damaged` hook, the charged S3 mark via a `hit` hook (it applies before the damage, PRTS 备注).
// - Dodge from a skill that adds to other dodge sources (焰尾 S3) is rolled independently in a `hit` hook, so the
//   sources combine as 1 − Π(1 − p) (the same rule the engine now applies to stacked dodge mods).
// - Operator loadouts (DESIGN §16): every selectable non-default skill of the 22 visible chess is authored in the kit's
//   `skills` map (see alt() below); logic of one skill (counters, deferrals, auras…) only runs when it is selected,
//   and module effects check the selected module (moduleIs / the module-merged trait & talent blackboards).
//   `node tools/kit-coverage.mjs --tier 4 --strict`; tests: test/content/kits_alt_t4.test.js.

import { bodyInRange } from '../../../body.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { normalizeChess } from '../../../simdata.js';

const AURA = 0.2;          // aura refresh period (s)
const AURA_DUR = 0.25;     // aura buff lifetime (s): lapses ~1 tick after the source stops refreshing it

// ---------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : d));
const tbb = (def, i) => (def && def.talents && def.talents[i] && def.talents[i].bb) || {};
/** Hidden module talent blackboard (name null, e.g. 水月 move_speed, 魔王 cnt/atk). */
const moduleBb = (def) => (def?.talents || []).filter((t) => !t.name && t.bb && Object.keys(t.bb).length).reduce((o, t) => Object.assign(o, t.bb), {});
const grid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);
/** Flat BAT change (s) → batPct. */
const batFlat = (def, v) => { const b = num(def?.stats?.bat, 1) || 1; return Math.max(-0.9, num(v, 0) / b); };
const nationOf = (u) => u?.def?.raw?.nationId ?? null;
const enemyHasTag = (e, tag) => !!e && e.side === 'enemy' && Array.isArray(e.def?.tags) && e.def.tags.includes(tag);
const keySet = (unit) => unit.rangeKeySet || new Set(unit.rangeKeys || []);
/** Every living, visible enemy standing on the unit's range (ignores stealth/untargetable: auras, reveals). */
function enemiesOnRange(battle, unit, keys = null) {
  const set = keys || keySet(unit);
  const out = [];
  for (const e of battle.enemies) if (e.alive && !e.hidden && bodyInRange(e, set)) out.push(e);
  return out;
}
/** Targetable enemies in the unit's current range (flyers included), best targets first. */
function targetsInRange(battle, unit, n = 0, keys = null) {
  const list = battle.enemiesInKeys(keys || unit.rangeKeys, unit, { canHitFly: true });
  sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
/** Targetable enemies on the tiles of `g` (offsets) around the unit. */
function targetsInGrid(battle, unit, g) {
  return battle.unitsInGrid(unit, g, { side: 'enemy' }).filter((e) => canTargetEnemy(unit, e, { canHitFly: true }));
}
/** Run `fn` every `iv` s while the unit is alive and deployed. */
const whileDeployed = (battle, unit, iv, fn) => battle.every(iv, () => { if (unit.alive && unit.deployed) fn(); }, { owner: unit });
/** Short-lived aura buff. */
const pulse = (battle, target, key, mods, extra = {}) => battle.addBuff(target, { key, mods, duration: AURA_DUR, ...extra });
/** Keep (or remove) a permanent self buff. */
function toggleBuff(battle, unit, key, on, mods) {
  const cur = unit.findBuff(key);
  if (on) {
    if (!cur || JSON.stringify(cur.mods) !== JSON.stringify(mods)) battle.addBuff(unit, { key, mods });
  } else if (cur) battle.removeBuff(unit, key);
}
/** "技力光环（同类效果取最高）": shared key, highest value wins. */
function spAura(battle, source, value, filter) {
  whileDeployed(battle, source, AURA, () => {
    for (const a of battle.alliesFor(source, source.ownerId)) {
      if (!filter(a)) continue;
      const cur = a.findBuff('aura:spRecovery');
      if (cur && cur.source !== source && cur.source?.alive && (cur.data?.v ?? 0) > value) continue;
      battle.addBuff(a, { key: 'aura:spRecovery', mods: { spRecoveryFlat: value }, duration: AURA_DUR, source, data: { v: value } });
    }
  });
}
/** Reveal stealthed enemies on the given tiles. */
/** RES cut mods for a blackboard magic_resistance value (battle.applyStrongest): |v| < 1 = ×(1 + v), else flat v. */
const resCut = (v) => (Math.abs(v) < 1 ? { resMul: Math.max(0, 1 + v) } : { resFlat: v });
const reveal = (battle, enemies) => { for (const e of enemies) if (e.s.flags.stealth) pulse(battle, e, 'aura:reveal', null, { flags: { reveal: true } }); };
const skillActive = (u) => !!(u.skill && u.skill.active && u.skill.kind !== 'passive');

// ---- operator loadouts (DESIGN §16) ----------------------------------------------------------------------------
// The kit function receives the def of the SELECTED skill / module: `bb` = that skill's blackboard (normal Lv4 /
// elite Lv7), `def.skill` its record, talents / trait already carry the selected module's changes. `skills` holds the
// hand-authored spec of every selectable non-default skill (only the selected one is built, with its own `bb`);
// install / talent logic that belongs to ONE skill is gated on that skill being the selected one.

/** Id of the selected skill. */
const selId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;
/** Is `id` the selected skill? */
const isSel = (def, id) => selId(def) === id;
/** `skills` map of a kit: the spec of the selected skill when a builder exists for it (DESIGN §16 kit contract). */
function alt(def, builders) {
  const id = selId(def);
  return id && typeof builders[id] === 'function' ? { [id]: builders[id]() } : {};
}
/** Instant or charges kind from the data (maxChargeTime). */
const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');
/** No other ally operator / summon on the 4 (or 8) tiles around the unit. */
function lonely(battle, unit, diag = false) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((!dr && !dc) || (!diag && dr && dc)) continue;
      const r = unit.tileR + dr, c = unit.tileC + dc;
      if (!battle.grid.inBounds(r, c)) continue;
      const o = battle.unitAt(r, c);
      if (o && o !== unit && o.side === 'ally' && o.kind !== 'device') return false;
    }
  }
  return true;
}
/**
 * Module "攻击范围扩大" given as a new range (the selected module's data-only talent `rangeGrid`, e.g. SPC-X / RIN-X:
 * the 3×3 caster range + ONE centre tile [0,3]). It replaces the unit's own range — so also the initial range of the
 * DEFAULT trigger — while a skill with its own range (莫斯提马 S3, 白面鸮 S2…) keeps that range, as in AK. Null when the
 * selected module (or 'none') changes no range. (The rangeGrid-only talent is dropped from `def.talents`: read the
 * module record.)
 */
function moduleRangeGrid(def) {
  const m = def?.raw?.module;
  if (!m || !m.active || !m.id) return null;
  const rec = (def.raw.modules || []).find((x) => x && x.uniEquipId === m.id);
  for (const t of rec?.talentChanges || []) { const g = grid(t?.rangeGrid); if (g) return g; }
  return null;
}
const applyModuleRange = (battle, unit, def) => { const g = moduleRangeGrid(def); if (g) { unit.rangeGrid = g; battle.refreshRange(unit); } };
/**
 * Pull `e` "至面前" of the unit with 力度 `force` (Battle.pullToFront: the official 拉力起点 half a tile ahead, 急停 0.6708
 * around it, 力度 − 重量 — weight ≤ force all the way, one heavier a third of the way, …); returns the distance moved.
 */
function pullToFront(battle, unit, e, force) {
  return e && e.alive ? battle.pullToFront(e, unit, num(force, 0)) : 0;
}

/** Physician module trait (录武官, 华法琳 elites): heals on allies below hp_ratio are ×heal_scale. */
/**
 * The module trait "治疗生命值低于50%的友方单位时治疗量提升15%" (heal_scale, hp_ratio): the client's module buff filters the
 * target's HP before the heal with its own comparison — `atOrBelow` for the template heal_scale_up[hpratio][LE] (华法琳's
 * PHY-X), strictly below otherwise (录武官's reckpr_e_002_tr: LT). [ASSUMED as before: not on herself]
 */
function installLowHpHealBonus(battle, unit, tb, { atOrBelow = false } = {}) {
  const s = num(tb.heal_scale, 0), r = num(tb.hp_ratio, 0);
  if (!(s > 0) || !(r > 0)) return;
  const low = atOrBelow ? (t) => t.hpRatio <= r + 1e-9 : (t) => t.hpRatio < r;
  battle.on('heal', (c) => { if (c.source === unit && c.target !== unit && low(c.target)) c.amount *= s; }, { owner: unit });
}

// DESIGN §5.6 documents `(bb, chess)`; content/index.js also passes the normalised def — rebuild it when absent.
const withDefaults = (kits) => Object.fromEntries(Object.entries(kits).map(([id, f]) => [id, (bb, chess, def) => f(bb || {}, chess, def || normalizeChess(chess))]));

export {
  AURA, AURA_DUR, num, tbb, moduleBb, grid, batFlat, nationOf, enemyHasTag, keySet, enemiesOnRange, targetsInRange,
  targetsInGrid, whileDeployed, pulse, toggleBuff, spAura, resCut, reveal, skillActive, isSel, alt, instantKind, lonely,
  applyModuleRange, pullToFront, installLowHpHealBonus, withDefaults,
};
