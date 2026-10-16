// server/sim/content/kits/ops/op-haak.js — 阿 (char_225_haak) 自选 operator kit: 6★ 怪杰 (特种), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (GEE-X 什锦果味医用箱, GEE-Y 毒医残章) at
// every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_225_haak, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05.
// Full potential (the owner's decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into
// backups.json); PRTS 阿 (混合药物射击 备注 "每次攻击必定触发随机效果，4种效果的概率平均分布" / "<X模组>先判断是否“同时触发”所有
// 效果，未触发情况下再判断随机效果"; 爆发剂 备注 "进行完整的15次攻击后阿与目标获得持续时间相当于技能持续时间的增益；15次攻击均为无途径
// 攻击，但可满足近战/远程攻击相关的触发条件"); PRTS 分支特性信息 怪杰 ("可对空", "每秒流失最大生命值1%的生命值，不会致命且最低保留1
// 生命值"); the client's battle data — charpack char_225_haak (Talents/1: the additive active buff haak_t_1; Talents/2:
// heal_scale; Trait: periodic_damage_by_hp_ratio[skip_modifier_fix][undeadable] every 1 s), buff_template_data
// (haak_t_1: RandomCreateBuff of haak_t_atk (AtkScaleUp `atk_scale` on ON_CALCULATE_DAMAGE) / sluggish / stun / haak_t_heal
// (HealViaMaxHpRatio), weight 1 each; haak_e_002[dice]: Dice `prob` ⇒ all four, else the random one), the skill prefabs
// skchr_haak_2 / _3 (Attack + Fake_Attack: 15 shots — `_additionalTimes` 14, `_triggerDelta` 0.03 s — of
// instant_damage_physical[add_sp] = FixedValueDamage PHYSICAL `damage`; the target's buff fed with the last shot, his own
// by the Buff ability after the volley; ally selector `_targetSide` 1, `_excludeOwner`, `_postFilter` 21, his attack
// range) and the equips haak_equip_1_* (the hidden sp_recovery talent while his HP ratio is in [0.8, 1]) / haak_equip_2_2,
// _2_3 (heal_scale + the ability healinrange: one ally of his range, the same selector, healed healinrange.heal_scale ×
// ATK at once); Terra Wiki Aak (爆发剂: "an ally within range (prioritizes allies directly in front)", "the one in the
// frontal row/column from the closest to the furthest").
// - Trait (怪杰) "自身生命会不断流失": the profession default (professions.js geek, installHpDrain: hp_ratio × max HP every
//   second, never below 1 HP), ranged physical arrows that hit air units (data canHitFly; PRTS "可对空"), blocks 1, 3-3;
//   ground enemies target him (no flag). Module GEE-X adds "生命值高于80%时，技力自然回复速度+0.25/秒" (the hidden module
//   talent sp_recovery_per_sec: SP recovery +0.25/s while his HP ratio is at least 80 % — the equip checker's [0.8, 1]);
//   GEE-Y "再部署时间减少" is its attribute respawn_time −15 (in the stats, as its ATK / ASPD).
// - T1 混合药物射击 "每次攻击时会随机触发下列效果之一": every attack of his on an enemy rolls once, at its hit (the talent's
//   additive active buff rides the attack onto the target — not damage-missable: a dodged hit still rolls), one of four
//   with equal weight: heal himself hp_ratio × max HP (a 治疗: T2 scales it), that attack's damage ×atk_scale (an ATK scale,
//   before mitigation — "当次攻击力提升至150%"), 停顿 `sluggish` s or 晕眩 `stun` s on the target. GEE-X stage 2+: first
//   `prob` to trigger all four at once (haak_e_002[dice]), else the random one; stage 3's numbers are the module's.
//   [ASSUMED] his 爆发剂 shots at an ally never roll (PRTS names no such effect); the client's haak_t_atk lingers until his
//   next roll and could scale damage he deals meanwhile — here it scales the attack that rolled it only.
// - T2 药剂扩散 "自身受到的治疗量+20%" (full potential: +25%): healing received ×heal_scale. GEE-Y stage 2+ (1.3 at stage 3) adds "部署后立即恢复攻击
//   范围内一名友方干员（优先选取正前方）的生命值，恢复量为阿攻击力的150％": at each deployment, after the deploy-time buffs, a heal
//   of healinrange.heal_scale × ATK on the ally frontAlly picks among the healable ones [ASSUMED: injured or not — the
//   selector has no HP filter; summons count, as for 爆发剂's identical selector].
// - S1 快速射击 (MANUAL, data DEFAULT): ASPD +attack_speed for its duration.
// - S2 爆发剂·γ型 / S3 爆发剂·榴莲味 (MANUAL, data DEFAULT; timed: 30 / 20 s): at the cast, `stimulant`: the ally frontAlly
//   picks takes 15 physical hits of `damage` (500) fixed attack power each (FixedValueDamage: DEF applies, 5 % minimum;
//   普通伤害, skill damage — 受击回复 SP and the 重装 TAKE_DAMAGE trigger answer them like any damage taken: the
//   template's "[add_sp]"); then he and — still standing — the target get max HP +max_hp / DEF +def (S2) or ATK +atk / ASPD
//   +attack_speed (S3) for the skill's duration (per 阿 on the target: independentCharacterSource). [ASSUMED] the volley
//   lands at once (its 0.42 s of shots and flight are not modelled); with no ally in his range the cast does nothing (the
//   client's sequence stops when its attack finds no target) — his skill still runs and spends its SP: the data's DEFAULT
//   trigger needs an enemy, not an ally — settled by the sources in 0.2.0 WV: no skillTriggerDataList row names 阿 or 怪杰
//   (the basic strategy), the skill prefabs cast with no target and keep the SP spent (skchr_haak_2 / _3 `_allowNoTarget`
//   1, `_checkHasTargetBeforeDoCast` 0, `_recoverSpIfNoTarget` 0) and PRTS 阿 has no note on it.

import { textCount } from '../../../../../shared/plugins/textNumber.js';
import { num, talentBb, moduleBb, moduleOn, skillRec, statBuff, toggleBuff, up } from '../shared/tier1.js';
import { toLocal } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_haak_1';
const S2 = 'skchr_haak_2';
const S3 = 'skchr_haak_3';
/** 爆发剂's shots when the text names none ("攻击15次"; skill prefab `_additionalTimes` 14 + the first). */
const SHOTS_FALLBACK = 15;
/** GEE-X "生命值高于80%时" when the trait text names none (the equip checker's `_minHpRatio`). */
const GEEX_HP_FALLBACK = 0.8;
/** 混合药物射击's four effects, in the client's RandomCreateBuff order (weight 1 each). */
const DICE = Object.freeze(['atk', 'sluggish', 'stun', 'heal']);
const TAG_STIM = 'haak:stim';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

/**
 * 爆发剂 / 药剂扩散's target (the client selector `_postFilter` 21; Terra Wiki Aak): an ally — an operator or a summon,
 * never a device, never a 孤立 one (Battle.allySelectable) — standing in his current attack range, himself excluded; the
 * ones on his straight line ahead (local row 0) first, each group nearest first; ties: the higher taunt level, then the
 * latest deployed [ASSUMED: the Terra Wiki's "highest aggression level"], then the unit id. `heal` = a heal selector: no
 * 禁疗 / 无法被友方治疗 ally (PRTS 选择器 "若掩码中禁疗为1，且选择器属于治疗行为，则不可选中").
 */
export function frontAlly(battle, unit, heal = false) {
  const keys = unit.rangeKeySet || new Set(unit.rangeKeys || []);
  let best = null, bk = null;
  for (const a of battle.allyUnits) {
    if (a === unit || !a.alive || !a.deployed || a.hidden || a.kind === 'device') continue;
    if (!keys.has(a.tileR * COLS + a.tileC) || !battle.allySelectable(a, unit)) continue;
    if (heal && (a.s.flags.noHeal || a.s.flags.healFree || a.profile?.noHeal)) continue;
    const dr = a.tileR - unit.tileR, dc = a.tileC - unit.tileC;
    const [lr, lc] = toLocal(dr, dc, unit.dir);
    const k = [lr === 0 && lc > 0 ? 0 : 1, hypot(dr, dc), -(a.s.taunt || 0), -(a.aggroSeq || a.deploySeq || 0), a.id];
    let less = !bk;
    for (let i = 0; !less && i < k.length; i++) {
      if (k[i] === bk[i]) continue;
      less = k[i] < bk[i];
      break;
    }
    if (less) { best = a; bk = k; }
  }
  return best;
}

/**
 * 爆发剂 at the cast: `shots` hits of `damage` fixed attack power on frontAlly's pick, then `mods` on him and on the
 * target (if it still stands) for `dur` s. No ally in range: nothing [ASSUMED, header].
 */
function stimulant(battle, unit, { damage, shots, dur, mods, key }) {
  const t = frontAlly(battle, unit);
  if (!t) return;
  for (let i = 0; i < shots && t.alive && unit.alive; i++) { // loop-cap: textCount attack-times
    battle.dealDamage(unit, t, { amount: damage, type: 'phys', isSkill: true, tags: ['skill', TAG_STIM] });
  }
  battle.fx('volley', { x: t.x, y: t.y, id: unit.id, target: t.id, n: shots, skill: key });
  if (!(dur > 0)) return;
  if (unit.alive) battle.addBuff(unit, { key: `${key}:self`, duration: dur, mods, source: unit, tags: ['skill'] });
  if (t.alive && t !== unit) {
    battle.addBuff(t, { key: `${key}:${unit.id}`, duration: dur, mods, source: unit, tags: ['skill'] });
    battle.fx('buff', { x: t.x, y: t.y, id: t.id, kind: key });
  }
}

/**
 * 混合药物射击: one roll per attack on an enemy (its `attackId`), at its first hit — `all` (GEE-X stage 2+) for the four
 * at once, else one of DICE uniformly; the heal and the statuses then, the ATK scale on every damage instance of it.
 */
function installDice(battle, unit, t0) {
  const hr = num(t0.hp_ratio), scale = num(t0.atk_scale, 1), slug = num(t0.sluggish), stun = num(t0.stun), all = num(t0.prob);
  battle.on('hit', (ctx) => {
    const d = ctx.dmg, t = ctx.target;
    if (ctx.source !== unit || !d || !d.isAttack || d.isSplash || d.type === 'element' || !t || t.side !== 'enemy') return;
    const m = unit.mem;
    if (!d.attackId || m.haakDiceId !== d.attackId) {
      m.haakDiceId = d.attackId;
      m.haakDice = all > 0 && battle.rng.chance(all) ? DICE : [DICE[battle.rng.int(DICE.length)]];
      for (const e of m.haakDice) {
        if (e === 'heal' && hr > 0) battle.heal(unit, unit, unit.s.maxHp * hr, { self: true });
        else if (e === 'sluggish' && slug > 0) battle.applyStatus(t, 'sluggish', { duration: slug, source: unit });
        else if (e === 'stun' && stun > 0) battle.applyStatus(t, 'stun', { duration: stun, source: unit });
      }
      if (m.haakDice.includes('atk') && scale !== 1) battle.fx('crit', { x: t.x, y: t.y, id: unit.id });
    }
    if (m.haakDice.includes('atk')) d.amount *= scale;
  }, { owner: unit });
}

export default {
  char_225_haak: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 混合药物射击 (GEE-X stage 2+: + prob, its own numbers)
    const t1 = talentBb(chess, 1);   // 药剂扩散 (GEE-Y stage 2+: heal_scale 1.3, healinrange.heal_scale)
    const hidden = moduleBb(chess);  // GEE-X: sp_recovery_per_sec
    const b1 = bbOf(chess, S1);
    const stim = (id, key, mods) => {
      const rec = skillRec(chess, id);
      const b = rec?.bb ?? {};
      const shots = Math.max(1, Math.floor(textCount(String(rec?.desc ?? ''), /攻击(\d+)次/, SHOTS_FALLBACK, 'attack-times')));
      const dur = num(rec?.duration, 0);
      return {
        kind: 'duration',
        onStart({ battle, unit }) { stimulant(battle, unit, { damage: num(b.damage, 500), shots, dur, mods: mods(b), key }); },
      };
    };
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { aspd: num(b1.attack_speed) } },
        [S2]: stim(S2, 'haak:s2', (b) => ({ hpPct: num(b.max_hp), defPct: num(b.def) })),
        [S3]: stim(S3, 'haak:s3', (b) => ({ atkPct: num(b.atk), aspd: num(b.attack_speed) })),
      },
      talents: [
        { install(battle, unit) { installDice(battle, unit, t0); } }, // 混合药物射击
        { install(battle, unit) { // 药剂扩散: healing received ×heal_scale; GEE-Y stage 2+: the deploy heal
          statBuff(battle, unit, 'talent:haak:heal', { healingTakenMul: num(t1.heal_scale, 1) });
          const hs = num(t1['healinrange.heal_scale']);
          if (!(hs > 0)) return;
          battle.on('deploy', (c) => {
            if (c.unit !== unit || c.move || !up(unit)) return;
            const t = frontAlly(battle, unit, true);
            if (!t) return;
            battle.heal(unit, t, unit.s.atk * hs);
            battle.fx('heal', { x: t.x, y: t.y, id: t.id, src: unit.id });
          }, { owner: unit, priority: -10 });
        } },
      ],
      install(battle, unit) {
        // GEE-X "生命值高于80%时，技力自然回复速度+0.25/秒"
        const sp = num(hidden.sp_recovery_per_sec);
        if (sp > 0 && moduleOn(chess)) {
          const pct = +(/生命值高于(\d+)%/.exec(String(chess?.trait?.moduleDesc ?? ''))?.[1]);
          const thr = Number.isFinite(pct) ? pct / 100 : GEEX_HP_FALLBACK;
          toggleBuff(battle, unit, 'module:haak:sp', () => unit.hp >= unit.s.maxHp * thr - 1e-9, { spRecoveryFlat: sp });
        }
      },
    };
  },
};
