// server/sim/content/kits/ops/chess_char_3_13-malist.js — 至简 (char_4054_malist) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, altSkills, statSkill, textNum, funnelMap, installFunnelPrune } from '../shared/tier3.js';

export default {
  // ---- 3_13 至简 · 驭械术师 — S2 神工意匠: next attack ATK% arts twice (charges); 忽有所悟: prob of ATK ×atk_scale per attack
  chess_char_3_13_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const charges = Math.max(1, Math.floor(num(d.skill?.maxCharges, num(bb.ct, 1))));
    const hits = textNum(d.skill?.description, /连续攻击(\d+|[一二两三四五])次/, 2);
    const insight = (battle) => (battle.rng.chance(num(t0.prob, 0)) ? num(t0.atk_scale, 1) : 1);
    return {
      trait: { funnelMul: funnelMap, dmgMul: insight },
      skill: {
        kind: charges > 1 ? 'charges' : 'instant',
        attack: { atkScale: num(bb.atk_scale, 1), hits, funnelBodyHits: hits, dmgType: 'arts', dmgMul: insight },
      },
      // S1 迅捷打击·γ型: ATK / ASPD + (the drones' ramp and 忽有所悟 stay on every attack through the trait)
      skills: altSkills(chess, d, bb, { 'skcom_quickattack[3]': statSkill }),
      install: installFunnelPrune,
    };
  },
};
