// server/sim/content/kits/ops/chess_char_2_08-bubble.js — 泡泡 (char_381_bubble) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, byEnemyAttack, onDamagedOn, toggleBuff } from '../shared/tier1.js';
import { onDefaultSkill } from '../shared/tier2.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_08 泡泡 “挨打”: stops attacking; DEF +def, taunt +taunt_level, each enemy damage instance received (its attack or not:
  // the official bubble_s_2 / bubble_t_1 fire on ON_TAKE_DAMAGE — tier1 byEnemyAttack) returns atk_scale × DEF phys damage
  // to its source. 尖刺盾: that source gets ATK −atk for `duration` s. Elite module (PRO-X): DEF +def while blocking.
  // S1 防御力强化·β型 (alt, TAKE_DAMAGE from data): DEF +def for its duration; the counter belongs to “挨打” only.
  chess_char_2_08_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const s2 = onDefaultSkill(chess);
    return {
      skill: { kind: 'duration', mods: { defPct: num(bb.def), taunt: num(bb.taunt_level) }, attack: { noAttack: true } },
      skills: { 'skcom_def_up[2]': { kind: 'duration', mods: { defPct: num(bb.def) } } },
      talents: [{ install(battle, unit) {
        onDamagedOn(battle, unit, (ctx) => {
          if (!byEnemyAttack(ctx) || !unit.alive) return;
          const src = ctx.source;
          if (s2 && unit.skill?.active && src.alive) {
            battle.dealDamage(unit, src, { amount: unit.s.def * num(bb.atk_scale), type: 'phys', isSkill: true, canDodge: false, tags: ['counter'] });
            // (`target`: display only — the official bubble_skill_02_hit plays on the attacker, render/vfx/skills.js FX_BINDINGS)
            battle.fx('counter', { x: src.x, y: src.y, id: unit.id, target: src.id });
          }
          if (num(t.atk) < 0 && src.alive) battle.addBuff(src, { key: 'bubble:spike', duration: num(t.duration, 5), mods: { atkPct: num(t.atk) }, refresh: 'extend', source: unit });
        });
        if (num(tb.def)) toggleBuff(battle, unit, 'bubble:guard', () => unit.blocking.length > 0, { defPct: num(tb.def) });
      } }],
    };
  },
};
