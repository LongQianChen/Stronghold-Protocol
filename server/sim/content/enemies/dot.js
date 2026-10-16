// server/sim/content/enemies/dot.js — DOT 持续 kits (pulses, 污染秽蚀 / burning zones, bleeding) and their part of KITS
// (split from content/enemies.js).

import { SHELL_SPLASH_RADIUS, num, T, elem, hurt, areaAllies, castSlot } from './helpers.js';
import { splashAttack, noAirTargets, resist, immuneTo, bleed, pollution, dmgZone, kitPolluted } from './archetypes.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 萨卡兹枯朽战车 秽蚀轰击: radius of the 【污染秽蚀】 it leaves at its target (PRTS 萨卡兹枯朽战车 技能 "在目标位置生成半径1.7，
 *  持续10s的【污染秽蚀】" — the skill blackboard's range_radius 2.2 is its trigger range; the zone's radius is in no table). */
const TANK_ZONE_RADIUS = 1.7;

/** 集团军重型火炮's 【燃烧区域】: PRTS "碰撞半径1.5" with the source note "1.5倍可变半径" — ×1.5 on the blackboard's
 *  ProjectileBoomRange.attack@projectile_range (1). Until 0.1.3 the zone took the blackboard's 1. */
const UACANN_ZONE_SCALE = 1.5;

// ---------------------------------------------------------------------------------------------------------------
// kits

/** 深溟巢涌者 / 富营养的巢涌者: one pulse every second (PRTS "每秒"; not its attack interval, so 攻速 changes leave it alone). */
const NEST_PULSE_INTERVAL = 1;

const NEST_PULSE_TAG = 'nestPulse';

/**
 * 深溟巢涌者 / 富营养的巢涌者 (PRTS 天赋): "不进行普通攻击", 抵抗 (一减状态抵抗率 −0.5) and 停顿免疫; "未处于消失状态时，令攻击范围
 * 内的所有我方单位每秒受到攻击力100%的无途径法术伤害" and "每次输出伤害时，再造成攻击力5%的神经损伤" (`EpDamage.ep_damage_ratio`).
 * A talent aura, not an attack: `noAttack`, so it walks on while it hurts (ai.js attackStand holds only attackers — until
 * 0.1.3 the pulse was its normal attack, which made it stand for its whole 1 s clip whenever an ally was in range:
 * community report 「…错误的设置了攻击时不移动导致卡在原地」, GitHub #93), needs no target and pauses while it is hidden on a
 * DISAPPEAR leg (消失). The pulse is an area selection (areaAllies: a 迷彩 ally and a flying one — the 炎佑 dragon — are
 * hit, a 隐匿 one is not) of radius `rangeRadius` around its centre, like 鼎沸's. [ASSUMED] the pulse can be dodged (闪避:
 * PRTS names no attack type, which the site reads as 普通伤害 — the 烹泉 splash rule) and a dodged one adds no 神经.
 */
function kitDsubrl(ab, e) {
  const ratio = T(ab, 'EpDamage.ep_damage_ratio') ?? 0;
  return [resist(['sluggish']), {
    spawn(b, e2) {
      e2.profile.noAttack = true;
      // 每次输出伤害时: every pulse that reaches the unit (not dodged, not cancelled — the old attack's `dealt` rule)
      if (ratio > 0) b.on('damaged', (c) => { if (c.source === e2 && c.dmg && c.dmg.tags.includes(NEST_PULSE_TAG)) elem(b, e2, c.target, 'neural', e2.s.atk * ratio); }, { owner: e2 });
    },
    iv: NEST_PULSE_INTERVAL,
    tick(b, e2) {
      if (e2.hidden) return;
      const r = e2.base.rangeRadius || 1.6;
      const l = areaAllies(b, e2, e2.x, e2.y, r);
      if (!l.length) return;
      b.fx('pulse', { x: e2.x, y: e2.y, r, id: e2.id, element: 'neural' });
      for (const u of l) hurt(b, e2, u, e2.s.atk, 'arts', { canDodge: true, tags: [NEST_PULSE_TAG] });
    },
  }];
}

/**
 * 萨卡兹枯朽战车 / 尖端 (PRTS; enemy_database spData "初始技力 2 / 技力上限 2 / 攻击回复"): an attack made with full SP is the
 * skill 秽蚀轰击 — "对目标造成100%物理普通伤害，同时在目标位置生成半径1.7，持续10s的【污染秽蚀】" — and empties the SP; every
 * other attack gains 1. Initial SP = max, so the FIRST attack is the skill, then every 3rd (attacks 1, 4, 7 …). Talent:
 * "普通攻击只攻击位于低地的我方单位，且不会攻击飞行单位" (a candidate filter, ai.js enemyAttack: a FLY ally such as the 炎佑 dragon on a
 * low tile is no target either); "被阻挡时进行近战攻击，造成攻击力200%的伤害" — normal attacks on its blocker ×chuang_atk_scale.
 * [ASSUMED] the skill also fires on its blocker and deals the skill's own 100 % there (PRTS names no blocked exception:
 * enemy SP skills fire as soon as they are ready and its condition — a low-ground non-flying ally within 2.2 — holds for
 * the blocker), so a blocked tank hits 100 / 200 / 200 % … (v2.4.1: 200 % on every attack, the skill included).
 * Reach: the 2.2 range circle takes an ally whose 0.25 collider touches it (ai.js enemyAttack, constants.js
 * ALLY_COLLIDER_RADIUS; PRTS 作战机制 §碰撞体积) — 2.45 from the ally's centre, 21 tiles around it instead of 13 (user
 * playtest #6 follow-up: the user remembers a long-reaching, hard-hitting ranged attack; the data scale stays 100 %).
 */
function kitTank(ab, e) {
  const melee = T(ab, 'Empty.attack@chuang_atk_scale') ?? 1;
  const sk = ab.sk.PollutedRangedAtk || null;
  const s = sk ? sk.bb : {};
  const spd = (e.def.raw && e.def.raw.sp) || null;
  const max = Math.max(1, num(spd && spd.maxSp, 0) || (sk && sk.sp) || (T(ab, 'Empty.sp') ?? 2));
  const init = Math.min(max, Math.max(0, num(spd && spd.initSp, 0)));
  return [{
    spawn(b, e2, a) { a.sp = init; a.skill = false; e2.profile.canTarget = (u) => !!u.ground && !u.isFlying; },
    // SP full: this attack is 秽蚀轰击 (a blocked hit lands at once, inside this attack, while `a.skill` is set) — the
    // client is told its skill slot (castSlot, display only)
    before(c, b, e2, a) { a.skill = a.sp >= max; if (a.skill) castSlot(b, e2, sk); },
    hitOut(c, b, e2, a) { if (c.dmg.isAttack && !a.skill && c.target === e2.blockedBy) c.dmg.amount *= melee; },
    attack(c, b, e2, a) {
      if (!a.skill) { a.sp = Math.min(max, a.sp + 1); return; }
      a.skill = false;
      a.sp = 0;
      const t = c.targets[0];
      if (t) pollution(b, e2, t.x, t.y, TANK_ZONE_RADIUS, s.projectile_life_time ?? 0, s.polluted_damage_low ?? 0, s.polluted_damage_high ?? 0);
    },
  }];
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

export const DOT_KITS = Object.freeze({
  // --- DOT 持续
  enemy_1234_dsubrl: kitDsubrl,                                      // 深溟巢涌者 · no attack: an arts pulse on every ally in range each second + neural; 抵抗, immune 停顿
  enemy_1234_dsubrl_2: kitDsubrl,                                    // 富营养的巢涌者 · same
  enemy_1267_nhpbr: kitPolluted,                                     // 萨卡兹枯朽战士 · death: 污染秽蚀 zone (50 / 25 true per second)
  enemy_1267_nhpbr_2: kitPolluted,                                   // 萨卡兹枯朽战士组长 · same
  enemy_1270_nhstlk: (ab) => [bleed(ab)],                            // 逐腐兽 · bleeding (arts/s, cleared by healing)
  enemy_1270_nhstlk_2: (ab) => [bleed(ab)],                          // 疯狂的逐腐兽 · same
  enemy_1272_nhtank: kitTank,                                        // 萨卡兹枯朽战车 · ground targets only, melee ×2, 秽蚀轰击 on attacks 1, 4, 7 …
  enemy_1272_nhtank_2: kitTank,                                      // 尖端萨卡兹枯朽战车 · same
  enemy_9006_actoxi: (ab) => [{                                      // 假想敌：蚀裂 · death: poison cloud on its killer
    sil: true,
    death(c, b, e) {
      if (c.reason !== 'killed') return;
      const k = c.killer && c.killer.side === 'ally' && c.killer.alive ? c.killer : null;
      const atk = e.s.atk;
      // a sourceless zone (`src` null): its ticks skip a 隐匿 / untargetable / sleeping operator (PRTS 假想敌：蚀裂: no 无视
      // 可选性 note — PRTS 作战机制's "无来源的毒雾" that reaches 隐匿 units is the stage hazard), not an airborne 起飞 one
      const cloud = (x, y) => dmgZone(b, null, x, y, T(ab, '1.projectile_range') ?? 0.8, T(ab, '1.projectile_life_time') ?? 0, T(ab, '1.interval') ?? 1, atk * (T(ab, '1.damage_atk_scale') ?? 0), 'arts', 'poison');
      if (k) b.addProjectile({ from: e, target: k, speed: 8, visual: 'lob', source: null, hitDead: true, onHit: (h) => cloud(h.x ?? k.x, h.y ?? k.y) });
      else cloud(e.x, e.y);
    },
  }],
  // 集团军重型火炮 · PRTS 天赋: "不会攻击飞行单位"; the shell hits every unit within 1.0 of its target for 100 % ATK ("此弹道会强制
  // 击中主目标，碰撞无视迷彩，不可对空"; no splash until 0.1.3) and each hit on the main target leaves a 3 s 【燃烧区域】 of radius
  // projectile_range × UACANN_ZONE_SCALE
  enemy_10122_uacann_2: (ab) => [noAirTargets(), splashAttack({ unblocked: false, radius: SHELL_SPLASH_RADIUS, noAir: true, fxKind: 'shell' }), {
    dealt(c, b, e) {
      // 【燃烧区域】 "不可对空": a flying ally (the 炎佑 dragon) standing in it takes nothing (until 0.1.3 it burned)
      dmgZone(b, e, c.target.x, c.target.y, (T(ab, 'ProjectileBoomRange.attack@projectile_range') ?? 1) * UACANN_ZONE_SCALE, T(ab, 'ProjectileBoomRange.attack@projectile_life_time') ?? 0, 1, T(ab, 'ProjectileBoomRange.attack@value') ?? 0, 'arts', 'burning', null, 0, { noAir: true });
    },
  }],
  enemy_10054_cjhot: (ab, e) => [immuneTo('sluggish'), {             // 鼎沸 · pulses arts + burn around itself; immune 停顿
    iv: e.base.bat || 1,
    tick(b, e2) {
      const r = (e2.def.raw.stats && e2.def.raw.stats.rawRangeRadius) || 1.6;
      b.fx('explode', { x: e2.x, y: e2.y, r, kind: 'boil' });
      // PRTS 鼎沸 "攻击范围内的所有我方单位每秒受到…法术持续伤害与…灼燃损伤（不可对空）": never a flying ally (the 炎佑 dragon;
      // until 0.2.1 it burned)
      for (const u of areaAllies(b, e2, e2.x, e2.y, r)) {
        if (u.isFlying) continue;
        hurt(b, e2, u, e2.s.atk * (T(ab, 'aoe.atk_scale') ?? 1), 'arts');
        elem(b, e2, u, 'burn', e2.s.atk * (T(ab, 'aoe.ep_damage_ratio') ?? 0));
      }
    },
  }],
});
