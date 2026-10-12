// server/sim/battle/queries.js — Battle methods: queries: the per-tick enemy tile index, enemies / allies by tile keys,
// grid, radius and selectability, the ally targets (allies our attacks select like enemies), players, and the range
// rebuild of an ally (current, base and extra range keys).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { ROWS, COLS } from '../constants.js';
import { absoluteRangeKeys, canTargetEnemy, extendedGrid, enemyStealthed } from '../targeting.js';
import { bodyKeys, bodyInKeys, bodyInRadius } from '../body.js';
import { roundHalfEven } from '../detmath.js';

export class BattleQueries {
  /**
   * Tile buckets of the living enemies: a regular enemy on the tile of its position, a huge one (body.js) on every tile
   * it occupies.
   */
  _buildEnemyIndex() {
    for (const k of this._ebUsed) this._eb[k].length = 0;
    this._ebUsed.length = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.hidden) continue;
      if (e.hitArea) {
        for (const k of bodyKeys(e)) { const b = this._eb[k]; if (!b.length) this._ebUsed.push(k); b.push(e); }
        continue;
      }
      const r = roundHalfEven(e.y), c = roundHalfEven(e.x); // the tile body.js gives a point enemy
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const k = r * COLS + c;
      const b = this._eb[k];
      if (!b.length) this._ebUsed.push(k);
      b.push(e);
    }
  }

  /** Targetable enemies whose body is on any of `keys` (absolute tile keys; a huge enemy is listed once). */
  enemiesInKeys(keys, attacker, profile) {
    const out = [];
    if (!keys) return out;
    for (let i = 0; i < keys.length; i++) {
      const b = this._eb[keys[i]];
      if (!b || !b.length) continue;
      for (const e of b) if (e.alive && (!e.hitArea || !out.includes(e)) && canTargetEnemy(attacker, e, profile)) out.push(e);
    }
    return out;
  }

  /**
   * Ally units an ally's attack selects like an enemy — the "ally targets" content registers (setAllyTarget): 白铁's
   * 铁钳号·原型机, a summon of the enemy camp that "可被我方干员攻击但不受伤害" (PRTS 铁钳号·原型机 备注 "该召唤物阵营为敌方";
   * kits/ops/op-ironmn.js). Those standing on one of `keys` (tile keys, or a Set of them), alive and deployed — never
   * `attacker` itself, and an ally target selects none. ai.js acquireTargets appends them after the enemies (their 嘲讽等级
   * −2 puts them last); a skill that acts on them counts them like an enemy for its automatic start (skills.js
   * `_allyTargetIn` / `allyTargetsOk`). [] at
   * once while none is registered, so every other battle runs exactly as before.
   */
  allyTargetsInKeys(keys, attacker) {
    const set = this._allyTargets;
    if (!set || !set.size || !keys || !attacker || set.has(attacker)) return [];
    const ks = keys instanceof Set ? keys : (keys === attacker.rangeKeys && attacker.rangeKeySet ? attacker.rangeKeySet : new Set(keys));
    const out = [];
    for (const a of set) if (a.alive && a.deployed && !a.hidden && ks.has(a.tileR * COLS + a.tileC)) out.push(a);
    return out;
  }

  /**
   * The registered ally targets within `r` of (x, y) (centre distance) — the radius form of allyTargetsInKeys, for a kit
   * whose area selection takes them too (a skill flagged `allyTargets`, skills.js allyTargetsOk). [] while none is registered.
   */
  allyTargetsInRadius(x, y, r, attacker) {
    const set = this._allyTargets;
    if (!set || !set.size || !attacker || set.has(attacker)) return [];
    const r2 = r * r + 1e-9;
    const out = [];
    for (const a of set) if (a.alive && a.deployed && !a.hidden && (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) <= r2) out.push(a);
    return out;
  }

  /** Register (`on`) or drop an ally target (allyTargetsInKeys); one off the field is skipped while registered. */
  setAllyTarget(unit, on = true) {
    if (!unit || unit.side !== 'ally') return false;
    if (on) (this._allyTargets ??= new Set()).add(unit);
    else if (this._allyTargets) this._allyTargets.delete(unit);
    return true;
  }

  /** Is `unit` a registered ally target (setAllyTarget)? */
  isAllyTarget(unit) {
    return !!(unit && this._allyTargets && this._allyTargets.has(unit));
  }

  /**
   * A living enemy whose body is on any of `keys` — targetable or not (stealthed, untargetable, asleep, flying): the
   * 技能范围 trigger "技能范围内存在敌人（无视其不可选中）" (skills.js SKILL_RANGE).
   */
  anyEnemyInKeys(keys) {
    if (!keys) return false;
    for (let i = 0; i < keys.length; i++) {
      const b = this._eb[keys[i]];
      if (b && b.length) for (const e of b) if (e.alive && e.deployed) return true;
    }
    return false;
  }

  /**
   * Allies (not devices) within tiles `keys`, sorted by HP ratio (lowest first) that need healing. A `noHeal` (禁疗) ally
   * is left out unless the healer's profile heals it through its 禁疗 (`healThrough(healer, ally)`: 凯尔希's Mon3tr —
   * damage.js heal).
   */
  injuredAlliesInKeys(keys, healer, includeElement = false) {
    const out = [];
    if (!keys) return out;
    const set = keys instanceof Set ? keys : (healer && healer.rangeKeys === keys && healer.rangeKeySet ? healer.rangeKeySet : new Set(keys));
    const through = healer && healer.profile && typeof healer.profile.healThrough === 'function' ? healer.profile.healThrough : null;
    for (const a of this.allyUnits) {
      if (!a.alive || !a.deployed || a.hidden || a.kind === 'device') continue;
      if (!set.has(a.tileR * COLS + a.tileC)) continue;
      if (a !== healer && ((a.s.flags.noHeal && !(through && through(healer, a))) || (a.profile && a.profile.noHeal))) continue;
      const injured = a.hp < a.s.maxHp - 1e-6;
      const elem = includeElement && (a.elem.burn + a.elem.neural + a.elem.necrosis + a.elem.apoptosis + a.elem.erosion) > 0;
      if (injured || elem) out.push(a);
    }
    out.sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
    return out;
  }

  lowestHpAllyInRange(unit) {
    const l = this.injuredAlliesInKeys(unit.rangeKeys, unit);
    return l[0] ?? null;
  }

  /** Units of the opposite side (or `side`) whose tile is inside `grid` offsets relative to `unit`. */
  unitsInGrid(unit, grid, { side = null, extend = 0 } = {}) {
    const keys = absoluteRangeKeys(grid || unit.rangeGrid || [[0, 0]], Math.round(unit.y), Math.round(unit.x), unit.dir, extend);
    const want = side ?? (unit.side === 'ally' ? 'enemy' : 'ally');
    const set = new Set(keys);
    const out = [];
    const list = want === 'enemy' ? this.enemies : this.allyUnits;
    for (const x of list) {
      if (!x.alive || !x.deployed || x.hidden) continue;
      if (bodyInKeys(x, set)) out.push(x);
    }
    return out;
  }

  /** Allies inside `unit`'s current range (for auras) — not the 孤立 ones ("无法被同阵营选中": 炎佑), `unit` aside. */
  alliesInGrid(unit) {
    const set = unit.rangeKeySet || new Set(unit.rangeKeys || []);
    return this.allyUnits.filter((a) => a.alive && a.deployed && !a.hidden && a.kind !== 'device' && set.has(a.tileR * COLS + a.tileC) && this.allySelectable(a, unit));
  }

  /**
   * May an ability of ally `by` select ally `a`? Never a 孤立 unit (炎佑, 从不混淆的方向; flag `isolated`) other than `by`
   * itself — PRTS 选择器: selectors decide "天赋是否能给予某个干员Buff" and every heal / buff / aura target, and their 可选判定
   * rejects a 孤立 target of a friendly selector ("若掩码中孤立为1，且选择器的阵营与目标为友好关系，则不可选中"; user playtest #6
   * item 18). Enemies still target it (a hostile selector). 禁疗 only keeps heals off (heal pipeline, injuredAlliesInKeys).
   */
  allySelectable(a, by = null) {
    return !!a && (a === by || !a.s.flags.isolated);
  }

  /** Deployed allies (no devices) an ability of ally `by` may select: allies(ownerId) without the 孤立 ones. */
  alliesFor(by, ownerId = null) {
    return this.allies(ownerId).filter((a) => this.allySelectable(a, by));
  }

  /**
   * Living enemies whose body (body.js: a huge enemy's hit rectangle, else its position) is within `r` of (x, y).
   * `centre` = a 中点判定 radius — splash around a struck / marked target (PRTS 作战机制: "中点判定…案例：阻挡，酒神1天赋的1.3
   * 溅射半径"): every enemy counts by its position (判定中心), a huge one too.
   */
  enemiesInRadius(x, y, r, centre = false) {
    const out = [];
    const r2 = r * r + 1e-9;
    for (const e of this.enemies) {
      if (!e.alive || e.hidden) continue;
      if (e.hitArea && !centre) { if (bodyInRadius(e, x, y, r)) out.push(e); continue; }
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  }

  /**
   * The enemies within `r` (as enemiesInRadius) an ally-side area effect can select — PRTS 作战机制 §AOE伤害判定 "AOE的判定是
   * 对攻击范围内的每个可以被选中的敌人进行判定", 隐匿 "隐匿状态下的单位一般无法被敌方的索敌机制和Buff选择器选中为目标": no
   * untargetable enemy and no 隐匿 one unless revealed, blocked or not hidden again yet after a block (targeting.js
   * enemyStealthed; tile selectors — enemiesInKeys / canTargetEnemy — already skip them). Flying and asleep enemies stay
   * the caller's choice. Enemy-side effects on other enemies (auras, heals) and physical collisions keep enemiesInRadius.
   * Player report #8 after 0.1.0 (the 逐火 余烬): until 0.1.1 profession splash and skill circles still reached an
   * unblocked 隐匿 enemy.
   */
  foesInRadius(x, y, r, centre = false) {
    const out = this.enemiesInRadius(x, y, r, centre);
    let n = 0;
    for (const e of out) {
      const f = e.s.flags;
      if (f.untargetable || (f.stealth && enemyStealthed(e))) continue;
      out[n++] = e;
    }
    out.length = n;
    return out;
  }

  /**
   * Every deployed ally within `r` of (x, y) — no selection rule: an enemy's area effect selects among them with
   * targeting.js areaSelectable (content/enemies/helpers.js areaAllies: no 隐匿 ally, the blocker included, GitHub #97; DESIGN §22.12).
   */
  alliesInRadius(x, y, r, ownerId = null, { includeDevices = false } = {}) {
    const out = [];
    const r2 = r * r + 1e-9;
    for (const a of this.allyUnits) {
      if (!a.alive || !a.deployed || a.hidden) continue;
      if (!includeDevices && a.kind === 'device') continue;
      if (ownerId != null && a.ownerId !== ownerId) continue;
      const dx = a.x - x, dy = a.y - y;
      if (dx * dx + dy * dy <= r2) out.push(a);
    }
    return out;
  }

  /** Alive deployed allies (ops + tokens), optionally of one player. */
  allies(ownerId = null) {
    return this.allyUnits.filter((a) => a.alive && a.deployed && a.kind !== 'device' && (ownerId == null || a.ownerId === ownerId));
  }

  aliveEnemies() { return this.enemies.filter((e) => e.alive); }

  unitAt(r, c) { const u = this._occ[r * COLS + c]; return u && u.alive ? u : null; }

  unitById(id) { return this.units.find((u) => u.id === id) ?? null; }

  tileInfo(r, c) { return this.grid.tile(r, c); }

  getPlayer(playerId) { return this.players.find((p) => p.playerId === playerId) ?? null; }

  _pp(playerId) { return playerId == null ? null : this._perPlayer[playerId] ?? null; }

  // =============================================================================================================
  // ranges

  /**
   * Recompute a unit's absolute range tile keys: `rangeKeys` / `rangeKeySet` = current range (skill range override +
   * rangeExtend — the unit's own 攻击距离 unless the running skill's range ignores it, `targeting.noRangeExtend`: 信仰搅拌机
   * S3, PRTS 备注 "此技能的攻击范围不受'攻击距离'属性影响" — plus the skill's own `targeting.rangeExtend`) ∪
   * `unit.extraRangeKeys` (content extra targets — setExtraRange); `baseRangeKeys` = the INITIAL range of the DEFAULT
   * skill trigger: the unit's own grid + its permanent rangeExtend (`s.baseRangeExtend`: persistent, never-expiring
   * buffs — talents, modules, bonds), no skill range, no temporary extend, no extra keys; `liveRangeGrid` = the
   * relative grid (facing RIGHT) of the 攻击范围 the detail card shows (shared/protocol.js unitStatsEntry `range`;
   * community report E1 after 0.1.0: the card kept the base grid while 烛煌 S3 attacked with 4-11): the grid behind
   * `rangeKeys` without the extra keys (targeting.js extendedGrid; the grid itself when nothing extends it), or the
   * unit's own range while a skill's grid only selects targets (`targeting.showOwnRange`: 荒芜拉普兰德 S1, no official
   * range change). Rebuilt on deploy / relocate / skill range switches and whenever either extend changes (rangeChanged).
   */
  _refreshRange(u) {
    const tg = u.skill && u.skill.active ? u.skill.spec.targeting : null;
    const grid = (tg && tg.rangeGrid) || u.rangeGrid || [[0, 0]];
    const ext = (tg && tg.noRangeExtend ? 0 : u.s.rangeExtend) + ((tg && tg.rangeExtend) || 0);
    u._rangeExtend = u.s.rangeExtend;
    u._baseExtend = u.s.baseRangeExtend;
    const keys = absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, ext);
    const set = new Set(keys);
    const extra = u.extraRangeKeys;
    if (extra) for (const k of extra) if (!set.has(k)) { set.add(k); keys.push(k); }
    u.rangeKeys = keys;
    u.rangeKeySet = set;
    const own = !!(tg && tg.showOwnRange);
    const lg = own ? u.rangeGrid || [[0, 0]] : grid, le = own ? u.s.rangeExtend : ext;
    u.liveRangeGrid = le > 0 ? extendedGrid(lg, le) : lg;
    if (u.kind !== 'device') u.baseRangeKeys = absoluteRangeKeys(u.rangeGrid || [[0, 0]], u.tileR, u.tileC, u.dir, u.s.baseRangeExtend);
    if (u.skill) u.skill._trigKeys = null; // CUSTOM_RANGE trigger grid is relative to the tile
  }

  /** True when a buff changed the unit's rangeExtend (total or permanent part) since its range was last built. */
  rangeChanged(u) {
    return u._rangeExtend !== undefined && (u._rangeExtend !== u.s.rangeExtend || u._baseExtend !== u.s.baseRangeExtend);
  }

  /** Public: rebuild a unit's range after content changed `unit.rangeGrid` (流形 copies) or its tile keys. */
  refreshRange(unit) {
    if (!unit || unit.side !== 'ally' || !unit.alive || !unit.deployed) return false;
    this._refreshRange(unit);
    return true;
  }

  /**
   * Extra targetable tiles merged into the unit's range (蕾缪安 wanted targets, 维娜 S3, …): absolute tile keys
   * (row × COLS + col), kept across every later range rebuild until content sets them again (null / [] clears).
   * Not part of `baseRangeKeys` (the DEFAULT trigger range) — see SkillRuntime.addTriggerRange for that.
   */
  setExtraRange(unit, keys) {
    if (!unit || unit.side !== 'ally') return false;
    const out = [];
    const seen = new Set();
    for (const k of keys || []) if (Number.isInteger(k) && k >= 0 && k < ROWS * COLS && !seen.has(k)) { seen.add(k); out.push(k); }
    unit.extraRangeKeys = out.length ? out : null;
    if (unit.alive && unit.deployed) this._refreshRange(unit);
    return true;
  }
}
