// server/sim/content/enemies/reflection.js — REFLECTION 折射 kits (深池 enemies, 守墓石像) and their part of KITS (split from
// content/enemies.js).

import { T, auraAllies, auraBuff } from './helpers.js';
import { refraction, statue, kitRefraction } from './archetypes.js';

// ---------------------------------------------------------------------------------------------------------------
// kits

function kitPhalanx(ab, e) {
  const def = T(ab, 'auraDefup.def') ?? 0;
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || 1.5;
  return [...kitRefraction(ab), {
    iv: 0.5,
    tick(b, e2) {
      let n = 0;
      for (const o of b.enemiesInRadius(e2.x, e2.y, r)) if (o !== e2 && o.defId === e2.defId) n++;
      if (n > 0) auraBuff(b, e2, 'ab:phalanx', 0.5, { defFlat: def * n });
    },
  }];
}

function kitHolyGuard(ab) {
  const r = T(ab, 'traitAbility.range_radius') ?? 1.1, aspd = T(ab, 'traitAbility.attack_speed') ?? 0;
  return [...kitRefraction(ab), {
    iv: 0.5,
    tick(b, e) {
      const on = b.enemiesInRadius(e.x, e.y, r).some((o) => /enemy_1175_dushdo/.test(o.defId));
      if (!on) return;
      // a buff aura (auraAllies): no 隐匿 operator, the blocker included (PRTS 作战机制 §隐匿与Buff的关系 — no 无视 note on
      // its page), but an airborne 起飞 one still [ASSUMED, as §21.22's ground-enemy auras]
      for (const u of auraAllies(b, e, e.x, e.y, r)) auraBuff(b, u, 'ab:forceField', 0.5, { aspd }, null, true);
    },
  }];
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

export const REFLECTION_KITS = Object.freeze({
  // --- REFLECTION 折射
  enemy_1165_duhond: kitRefraction,                                  // 深池侦察犬 · refraction
  enemy_1165_duhond_2: kitRefraction,                                // 深池侦察犬pro · refraction
  enemy_1166_dusbr: kitRefraction,                                   // 深池侦察兵 · refraction
  enemy_1166_dusbr_2: kitRefraction,                                 // 深池侦察队长 · refraction
  enemy_1168_dumage: kitRefraction,                                  // 深池暗影术师 · refraction
  enemy_1168_dumage_2: kitRefraction,                                // 深池暗影术师队长 · refraction
  enemy_1170_dushld: kitRefraction,                                  // 深池重甲卫士 · refraction
  enemy_1170_dushld_2: kitRefraction,                                // 深池重甲卫士队长 · refraction
  enemy_1169_duphlx: kitPhalanx,                                     // 深池方阵步兵 · refraction + DEF +200 per nearby same unit
  enemy_1169_duphlx_2: kitPhalanx,                                   // 深池方阵指挥官 · same
  enemy_1172_dugago: (ab) => [...kitRefraction(ab), statue(ab)],     // 守墓石像 · refraction; melee when blocked; 1st KO → unblockable statue 10 s → arts flyer
  enemy_1172_dugago_2: (ab) => [...kitRefraction(ab), statue(ab)],   // 愤怒的守墓石像 · same
  enemy_1174_duholy: kitHolyGuard,                                   // 深池伙友卫队 · refraction; ASPD-down field next to 影刃 (taunt from data)
  enemy_1174_duholy_2: kitHolyGuard,                                 // 深池伙友卫队精英 · same
  enemy_9011_acrefr: (ab) => [refraction(T(ab, 'Refracting.magic_resistance') ?? 0, T(ab, 'Refracting.max_hp') ?? 0)], // 假想敌：镜膜 · refraction + max HP until first silence
});
