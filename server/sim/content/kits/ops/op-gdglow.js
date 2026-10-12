// server/sim/content/kits/ops/op-gdglow.js — 澄闪 (char_377_gdglow) 自选 operator kit: 6★ 驭械术师 (术师), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (FUN-X “辛劳之翼”, FUN-Y 梦想终将实现) at every
// form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_377_gdglow): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 澄闪 (信标的愤怒 备注:
// "每层1.5%概率，初始1层；未成功自爆时对应浮游单元层数增加1层，叠加至40层后下次攻击必定自爆。对应浮游单元成功自爆后/澄闪部署时层数
// 重置。每个浮游单元自爆概率独立计算", "自爆伤害半径1.1；自爆不计入特性叠加；自爆伤害不受特性影响"; 精准导流 备注 "增加自身法术穿透
// 属性（直接加算）"; S3 备注 "停顿效果可应用于自爆"), PRTS 分支特性信息 驭械术师 ("浮游单元攻击不同目标/干员再部署时，上述的伤害立刻
// 恢复至初始值", "通过技能释放的浮游单元造成技能直接伤害，不受缴械类效果制约"), Arknights Terra Wiki Goldenglow, and the client's
// battle data read from the local install — charpack char_377_gdglow (the skill modes S1 / S2 / S3: an attack whose
// `_funnelActions` S1Funnel1–2 / S2Funnel1–2 / S3Funnel1–3 each throw a persistent funnel projectile at the attack's target
// (`_alwaysIncludeTarget`) and fire again only once it is gone (`_waitForProjectileInvalid`); S3's attack has no projectile
// of its own — "停止攻击" — and its funnels carry `sluggish`; OverrideTrait swaps the trait's Funnel trigger off in every
// skill mode; the talent config copies attack@prob / attack@atk_scale_2 into the skills), the funnel projectiles
// projectile_chr_gdglow_funnel_s1_1 … s3_3 (`_lifeTimeType` 2: until stopped, `_stopWhenSourceInvalid`, its crash
// AdvancedApplyDamage MAGICAL at atk_scale_2) and their s12 / s3 blast projectiles.
// - Trait (驭械术师) "操作浮游单元造成法术伤害；单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）" (trait bb init / delta /
//   max_atk_scale): the engine's funnel profile (professions.js: her normal attack = a body hit plus one drone addition at init → +delta per hit on
//   the same target → max). FUN-X: init 0.35 ("单元初始伤害提高"); FUN-Y: max 1.2. Ranged arts, 3-1, hits air (PRTS "可对空"),
//   blocks 1, ground enemies target her.
// - Skill drones (the three skills "浮游单元+N，释放浮游单元锁定敌人攻击 … 锁敌后直至敌人被击杀、自爆或技能结束后返回干员身边"): while a
//   skill runs she makes no attack of her own — every drone is out, 1 + attack@cnt of them — and each drone locks the target
//   her targeting ranks first in her current range (the one her attack would take: the client's `_alwaysIncludeTarget`; so the
//   drones mostly share one enemy), keeps it — in range or not — until it falls or turns unselectable, then takes her current
//   first target again at once [ASSUMED: the client re-sends it with her next attack]. A drone attacks its enemy every attack
//   interval of hers (her live ASPD), the first as it locks [ASSUMED: no flight time], for ATK × its own ramp (the trait's
//   init, +delta per hit, ≤ max; every new lock starts at init [ASSUMED: a new funnel projectile]) — arts 技能直接伤害
//   (isSkill, no normal attack: on-attack items skip it), and no 缴械 stops it (PRTS); [ASSUMED] nor do her stun / freeze /
//   silence: the skill ticks on and so do the drones.
// - T1 信标的愤怒 "技能开启后浮游单元攻击时有10%概率自爆（回到干员身边）对小范围敌人造成澄闪300%攻击力的法术伤害" (full potential:
//   315 %; bb attack@prob / attack@atk_scale_2 / attack@max_stack_cnt; FUN-X stage 3: 375 %): each skill drone (by its slot,
//   S3's third one too) holds a stack count from 1: on each of its attacks it self-destructs with prob × stacks (sure past
//   attack@max_stack_cnt), else +1 stack; the blast — after that attack's hit [ASSUMED: in addition to it] — deals
//   atk_scale_2 × her ATK arts (isSkill, no ramp) to every enemy within 1.1 of its target (中点判定, air units too), the drone
//   goes back to her (its lock is free) and its count restarts at 1; every deployment of hers resets the counts.
// - T2 精准导流 "自身与浮游单元无视敌人15点法术抗性" (full potential: 18; bb magic_resist_penetrate_fixed; FUN-Y stage 3: 23):
//   resIgnoreFlat on her (her drones' damage is hers).
// - S1 火花四溅 (MANUAL, data DEFAULT, 25 s): ATK +atk, ASPD +attack_speed, 2 drones.
// - S2 电流翻涌 (AUTO, 持续时间无限 — a toggle): range 3-18 (the skill's grid), ATK +atk, 2 drones. A self buff (no target to
//   wait for): the owner's AUTO rule fires it as soon as its SP is full (`trigger: 'SP_FULL'`, kits/README.md checklist 5; as
//   黄's 链锯延伸模块 and 谬因's 连续映射).
// - S3 澄净闪耀 (MANUAL, data GDGLOW_SKILL_2 — "全场存在可选目标时释放技能", the rule named after it; 30 s): "停止攻击", range the
//   whole field, ATK +atk, 3 drones; every drone hit — and every blast (PRTS 备注) — 停顿 attack@sluggish s.

import { num, talentBb, skillRec, statBuff } from '../shared/tier1.js';
import { WHOLE_FIELD } from '../shared/tier6.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_gdglow_1';
const S2 = 'skchr_gdglow_2';
const S3 = 'skchr_gdglow_3';
/** 信标的愤怒's blast radius (PRTS 备注 "自爆伤害半径1.1"; no blackboard key). */
export const BLAST_RADIUS = 1.1;
export const DRONE_TAG = 'gdglow:drone';
export const BLAST_TAG = 'gdglow:blast';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

/** Her first-ranked target of her current range (and the enemies she blocks), or null. */
function firstTarget(battle, unit) {
  const prof = unit.profile;
  const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
  for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
  if (!cands.length) return null;
  sortEnemyTargets(battle, unit, cands, prof?.priority ?? null);
  return cands[0];
}

export default {
  char_377_gdglow: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const prob = num(t0['attack@prob']), blastScale = num(t0['attack@atk_scale_2']);
    const maxStack = Math.max(1, Math.floor(num(t0['attack@max_stack_cnt'], 40)));
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const drones = (b) => 1 + Math.max(0, Math.floor(num(b['attack@cnt'])));

    /** One drone of `unit` hits its enemy (and may self-destruct). */
    const droneHit = (battle, unit, d, t, sluggish) => {
      const f = unit.profile?.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
      d.ramp = d.rampId === t.id ? Math.min(f.max, d.ramp + f.delta) : f.init;
      d.rampId = t.id;
      battle.fx('drone', { x: t.x, y: t.y, id: unit.id });
      battle.dealDamage(unit, t, { amount: unit.s.atk * unit.s.atkScaleMul * d.ramp, type: 'arts', isSkill: true, tags: ['skill', 'drone', DRONE_TAG] });
      if (sluggish > 0 && t.alive) battle.applyStatus(t, 'sluggish', { duration: sluggish, source: unit });
      if (!(prob > 0) || !(blastScale > 0) || !unit.alive) return;
      // 信标的愤怒: prob × stacks, sure past the cap; a miss adds a stack
      const st = unit.mem.gdStacks || (unit.mem.gdStacks = []);
      const k = st[d.i] ?? 1;
      if (!(k > maxStack || battle.rng.chance(Math.min(1, prob * k)))) { st[d.i] = Math.min(maxStack + 1, k + 1); return; }
      st[d.i] = 1;
      const x = t.x, y = t.y;
      d.lock = null; // back to her
      battle.fx('explode', { x, y, radius: BLAST_RADIUS, id: unit.id, dmgType: 'arts', skill: 'gdglow:blast' });
      for (const e of battle.foesInRadius(x, y, BLAST_RADIUS, true)) {
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount: unit.s.atk * blastScale, type: 'arts', isSkill: true, tags: ['skill', BLAST_TAG] });
        if (sluggish > 0 && e.alive) battle.applyStatus(e, 'sluggish', { duration: sluggish, source: unit });
      }
    };

    /** A skill's drones: `n` of them; S3's carry 停顿 `sluggish` s. */
    const droneSpec = (n, sluggish) => ({
      onStart({ battle, unit }) {
        unit.mem.gdDrones = Array.from({ length: n }, (_, i) => ({ i, lock: null, cd: 0, rampId: null, ramp: 0 }));
        battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n });
      },
      onTick({ battle, unit, dt }) {
        const D = unit.mem.gdDrones;
        if (!D) return;
        const ok = (e) => !!e && e.alive && !e.hidden && canTargetEnemy(unit, e, unit.profile);
        for (const d of D) {
          if (unit.mem.gdDrones !== D || !unit.alive) return;
          d.cd = Math.max(0, d.cd - dt);
          if (d.lock && !ok(d.lock)) d.lock = null;
          if (!d.lock) {
            const t = firstTarget(battle, unit);
            if (!t) continue;
            d.lock = t;
            d.rampId = null;
            battle.fx('droneLock', { x: t.x, y: t.y, id: t.id, src: unit.id });
          }
          if (d.cd > 1e-9) continue;
          d.cd = unit.s.interval;
          droneHit(battle, unit, d, d.lock, sluggish);
        }
      },
      onEnd({ unit }) { unit.mem.gdDrones = null; },
    });

    return {
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) },
          attack: { noAttack: true },
          ...droneSpec(drones(b1), 0),
        },
        [S2]: {
          kind: 'toggle',
          trigger: 'SP_FULL',
          mods: { atkPct: num(b2.atk) },
          ...(s2?.rangeGrid ? { targeting: { rangeGrid: s2.rangeGrid.map((p) => [p[0], p[1]]) } } : {}),
          attack: { noAttack: true },
          ...droneSpec(drones(b2), 0),
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: WHOLE_FIELD },
          attack: { noAttack: true },
          ...droneSpec(drones(b3), num(b3['attack@sluggish'])),
        },
      },
      talents: [
        { install(battle, unit) { // 信标的愤怒: the skill drones' self-destruct (droneHit); counts reset at every deployment
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem.gdStacks = []; }, { owner: unit });
        } },
        { install(battle, unit) { // 精准导流: 无视敌人 N 点法术抗性 (her drones' damage is hers)
          statBuff(battle, unit, 'talent:gdglow:pen', { resIgnoreFlat: num(t1.magic_resist_penetrate_fixed) });
        } },
      ],
    };
  },
};

