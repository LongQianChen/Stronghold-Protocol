// server/sim/content/kits/ops/chess_char_1_07-prove.js — 普罗旺斯 (char_145_prove) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { sortEnemyTargets } from '../../../targeting.js';
import { frontOf } from '../../../dir.js';
import { bodyInRangeTile } from '../../../body.js';
import { num, talentBb, isMainHit, onHitBy, skillBbOf } from '../shared/tier1.js';

/** 普罗旺斯 杀戮嗅觉 "普通攻击不再以生命值高于80%的敌人作为目标" — the 80 % exists only in the skill text. */
const PROVE_S2_MAX_HP = 0.8;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_07 普罗旺斯 狼眼 (passive): per hp_ratio_drop of HP the target has lost, ATK +atk_scale_up against it — CONTINUOUS,
  // not in 20 % steps (PRTS note: "并非以每20%为固定节点 … 攻击力倍率提升至[100%+(100%-目标生命比例)×加成量×5]", i.e.
  // ×(1 + lost / hp_ratio_drop × atk_scale_up)).
  // 狩猎箭头: each attack prob (prob2 when the enemy is on the tile right in front) for ATK ×atk_scale.
  // 狼眼 is an ATK increase ⇒ it scales her (ATK-based) attacks only, never fixed-value damage she sources
  // (叙拉古 5000+50·L true proc, fixed item/DoT ticks…).
  // Alternate S2 杀戮嗅觉: ATK +atk, but normal attacks never target an enemy above 80 % HP (with only such enemies in
  // range she holds her fire). Her attacks stay normal attacks. (狼眼 is S1 only: absent when S2 is carried.)
  // Elite module ARC-X only changes stats (ATK/DEF, faster redeploy).
  chess_char_1_07_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const drop = num(bb.hp_ratio_drop), upPer = num(bb.atk_scale_up);
    const S2 = 'skchr_prove_2';
    const huntable = (e) => e.hpRatio <= PROVE_S2_MAX_HP + 1e-9;
    const s2On = (u) => !!(u.skill && u.skill.active && u.skill.id === S2);
    return {
      skill: { kind: 'passive' },
      // [ASSUMED] S2 never shoots 白铁's 铁钳号 (its damage is cancelled, so it never drops below 80 %): the device alone does
      // not open it (skills.js allyTargetsOk)
      skills: { [S2]: { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, S2).atk) }, allyTargets: false } },
      trait: {
        canAttack: (battle, u) => !s2On(u) || battle.enemiesInKeys(u.rangeKeys, u, u.profile).some(huntable),
      },
      install(battle, unit) {
        if (unit.skill?.id !== S2) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !s2On(unit) || ctx.targets.every(huntable)) return;
          const prof = ctx.profile || unit.profile;
          const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof).filter(huntable);
          sortEnemyTargets(battle, unit, cands, prof.priority);
          ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
        }, { owner: unit });
      },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          if (drop > 0 && upPer > 0) {
            const lost = Math.max(0, Math.min(1, 1 - target.hpRatio));
            if (lost > 0) dmg.amount *= 1 + (lost / drop) * upPer;
          }
          if (!isMainHit(dmg)) return;
          const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
          const front = bodyInRangeTile(target, fr, fc);
          const p = front ? num(t.prob2) : num(t.prob);
          if (p > 0 && battle.rng.chance(p)) {
            dmg.amount *= num(t.atk_scale, 1);
            battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
          }
        });
      } }],
    };
  },
};
