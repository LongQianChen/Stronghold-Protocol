// server/sim/content/kits/ops/chess_char_3_17-shotst.js — 流星 (char_126_shotst) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, altSkills, instantKindOf, fx, textCount, enemiesOn } from '../shared/tier3.js';

export default {
  // ---- 3_17 流星 · 速射手 — S2 碎甲击·扩散: instant ATK% phys on ≤5 enemies in range + DEF shred for `duration` s;
  //      空射专精: ×atk_scale vs flying (stacks with the module fly bonus)
  chess_char_3_17_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const n = textCount(d.skill?.description, /至多(\d+)个/, 5, 'at-most');
    const flyMul = (unit, t) => (t.isFlying ? (unit.profile.flyScale ?? 1) * num(t0.atk_scale, 1) : 1);
    return {
      trait: { dmgMul: (battle, unit, target) => flyMul(unit, target) },
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const list = enemiesOn(battle, unit, unit.rangeKeys, n, unit.profile);
          for (const e of list) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1) * flyMul(unit, e), type: 'phys', isSkill: true, tags: ['skill', 'burst'] });
            if (e.alive) battle.addBuff(e, { key: 'skill:shotst_shred', duration: num(bb.duration, 5), refresh: 'extend', mods: { defPct: num(bb.def) }, source: unit, visible: true });
          }
          if (list.length) fx(battle, 'volley', unit, { targets: list.map((e) => e.id), skill: 'shotst_2' });
        },
      },
      // S1 碎甲击: next attack ×atk_scale (fly × of the trait kept) and the target's DEF − for `duration` s
      skills: altSkills(chess, d, bb, {
        skchr_shotst_1: (s) => ({
          kind: instantKindOf(s),
          attack: {
            atkScale: num(s.bb.atk_scale, 1),
            onHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy') battle.addBuff(target, { key: 'skill:shotst_shred', duration: num(s.bb.duration, 5), refresh: 'extend', mods: { defPct: num(s.bb.def) }, source: unit, visible: true });
            },
          },
        }),
      }),
    };
  },
};
