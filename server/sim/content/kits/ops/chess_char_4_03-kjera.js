// server/sim/content/kits/ops/chess_char_4_03-kjera.js — 耶拉 (char_4013_kjera) kit, tier 4 (hidden).
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { num, tbb, withDefaults } from '../shared/tier4.js';
import { kjeraRelease } from './chess_char_3_20-kjera.js';

export default withDefaults({
  // ===== 耶拉 (funnel, hidden) S2 心随意动 — +1 drone locking targets, ATK up, chance to chill; talent 低眉.
  // Each released drone restarts at the trait's initial scale (it does not continue the pre-skill ramp) and those
  // scales are not written back onto the single trait ramp. The body stays an ordinary in-range attack.
  chess_char_4_03_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const rel = kjeraRelease(bb, { restart: true, announce: true });
    return {
      skill: rel.skill,
      talents: [{ install(battle, unit) { // 低眉: ATK +10 %, +16 % with ≥ 2 ground tiles in range
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          let low = 0;
          for (const k of unit.rangeKeys || []) if (battle.grid.isLow((k / COLS) | 0, k % COLS)) low++;
          const v = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'kjera:t1', mods: { atkPct: v } });
        }, { owner: unit });
      } }],
      install(battle, unit) { rel.install(battle, unit); },
    };
  },
});
