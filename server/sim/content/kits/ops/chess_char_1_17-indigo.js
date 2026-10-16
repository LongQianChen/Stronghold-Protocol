// server/sim/content/kits/ops/chess_char_1_17-indigo.js — 深靛 (char_469_indigo) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { sortEnemyTargets } from '../../../targeting.js';
import { num, talentBb, skillRec, batMod } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_17 深靛 光影迷宫: attack interval ×base_attack_time, talent chance ×talent_scale, bound enemies in range take
  // indigo_s_2[damage].atk_scale × ATK arts every indigo_s_2[damage].interval s.
  // 柔光缚目: attacks bind the target `duration` s with `prob`; bound enemies are never chosen as targets.
  // Alternate S1 灯塔守卫者: for `duration` s the skill range (4-1), attack interval ×(1 + base_attack_time) (PRTS:
  // "大幅度缩短(-80%)" ⇒ ×0.2 — a flat −0.8 s on 3 s would be less than S2's "略微缩短 ×0.7"), every attack hits for
  // attack@atk_scale × ATK arts — its stored energies too (PRTS S1 备注 "该技能的"每次攻击的攻击倍率"会实时应用在特性积攒的"攻击
  // 能量"抛射物上"; the client's ChargeAttackS1 reads the same atk_scale), not the branch's general 100 %. Elite module MSC-X (store 4) is the mystic profile of the module trait (TUNE.mystic);
  // the store itself is the shared 秘术师 profile (professions.js installMystic: at the attack check, PRTS 分支特性信息).
  chess_char_1_17_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const dScale = num(bb['indigo_s_2[damage].atk_scale']);
    const dIv = stepOf('indigo_s_2[damage].interval', num(bb['indigo_s_2[damage].interval'], 0.5), 0.5);
    const bound = (e) => !!e.s.flags.bind;
    const r1 = skillRec(chess, 'skchr_indigo_1');
    const b1 = r1?.bb ?? {};
    return {
      skills: {
        skchr_indigo_1: {
          kind: 'duration', mods: { batPct: Math.max(-0.95, Math.min(0, num(b1.base_attack_time))) },
          targeting: { rangeGrid: r1?.rangeGrid ?? null },
          attack: { atkScale: num(b1['attack@atk_scale'], 1) },
        },
      },
      trait: {
        // with only bound enemies in range (or blocked by her — always her targets, Battle.blockedTargets) she has no valid
        // target: she holds her fire and the mystic trait stores an energy at the attack check (professions.js
        // installMystic; a bind on her only target included)
        canAttack(battle, u) {
          return battle.enemiesInKeys(u.rangeKeys, u, u.profile).some((e) => !bound(e)) || battle.blockedTargets(u, u.profile).some((e) => !bound(e));
        },
        afterHit(battle, u, target) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const p = num(t.prob) * (u.skill?.active ? num(bb.talent_scale, 1) : 1);
          if (p > 0 && battle.rng.chance(Math.min(1, p))) battle.applyStatus(target, 'bind', { duration: num(t.duration), source: u });
        },
      },
      skill: {
        kind: 'duration', mods: { batPct: batMod(bb.base_attack_time, chess, def?.skill?.description ?? chess?.skill?.desc) },
        onStart({ unit }) { unit.mem.indigoAcc = 0; },
        onTick({ battle, unit, dt }) {
          if (!(dScale > 0) || !(dIv > 0)) return;
          unit.mem.indigoAcc = (unit.mem.indigoAcc ?? 0) + dt;
          let guard = 0;
          while (unit.mem.indigoAcc >= dIv - 1e-9 && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval
            unit.mem.indigoAcc -= dIv;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
              if (bound(e)) battle.dealDamage(unit, e, { amount: unit.s.atk * dScale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot'] });
            }
          }
        },
      },
      talents: [{ install(battle, unit) {
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !ctx.targets.some(bound)) return;
          const prof = ctx.profile || unit.profile;
          const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
          for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
          for (let i = cands.length - 1; i >= 0; i--) if (bound(cands[i])) cands.splice(i, 1);
          sortEnemyTargets(battle, unit, cands, prof.priority);
          ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
        }, { owner: unit });
      } }],
    };
  },
};
