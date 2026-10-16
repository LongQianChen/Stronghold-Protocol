// server/sim/content/kits/ops/chess_char_4_26-bldsk.js — 华法琳 (char_171_bldsk) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import { num, tbb, keySet, isSel, alt, installLowHpHealBonus, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 华法琳 (physician) S1 紧急包扎 — charges: a heal on an ally below 50 % adds 15 % of its max HP; 血液样本回收
  //       S2 不稳定血浆 (she and one random other ally in range: ATK +45 %/+60 %, lose 3 % max HP per s, 15 s)
  chess_char_4_26_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const S1 = isSel(def, 'skchr_bldsk_1');
    const plasma = (battle, unit, a) => battle.addBuff(a, {
      key: 'bldsk:plasma', duration: num(bb.duration, 15) + 1e-6, interval: Math.max(0.1, num(bb.interval, 1)), mods: { atkPct: num(bb.atk) }, visible: true, source: unit,
      onTick: ({ unit: t }) => battle.loseHp(t, t.s.maxHp * num(bb.hp_ratio, 0.03), { tags: ['skill', 'plasma'] }), // (no source: not damage dealt)
    });
    return {
      skills: alt(def, {
        skchr_bldsk_2: () => ({
          kind: 'instant', heal: true,
          onStart({ battle, unit }) {
            plasma(battle, unit, unit);
            const pick = battle.rng.pick(battle.alliesInGrid(unit).filter((a) => a !== unit));
            if (pick) plasma(battle, unit, pick);
            battle.fx('bloodBattle', { x: unit.x, y: unit.y, id: unit.id, target: pick ? pick.id : null });
          },
        }),
      }),
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        heal: true,
        trigger: { rule: 'CUSTOM_RANGE', grid: [] }, // never auto-cast by the engine: fired by the kit on a < 50 % heal target
      },
      talents: [{ install(battle, unit) { // 血液样本回收: an enemy falls in range ⇒ +2 SP to her and a random ally in range
        battle.on('death', (c) => {
          const e = c.unit;
          if (c.reason !== 'killed' || e.side !== 'enemy' || !unit.alive || !unit.deployed || !bodyInRange(e, keySet(unit))) return;
          unit.skill?.gainSp(num(t0['bldsk_t_1[self].sp'], 2), 'talent');
          // SP cannot be gained while a timed skill runs (engine gainSp ignores it): such allies are not picked
          const pick = battle.rng.pick(battle.alliesInGrid(unit).filter((a) => a !== unit && a.skill && !a.skill.noSkill && a.skill.kind !== 'passive' && !(a.skill.active && a.skill.isTimed)));
          if (pick) { pick.skill.gainSp(num(t0['bldsk_t_1[rand].sp'], 2), 'talent'); battle.fx('spGift', { x: pick.x, y: pick.y, id: pick.id }); }
        }, { owner: unit });
      } }],
      install(battle, unit) {
        installLowHpHealBonus(battle, unit, tb, { atOrBelow: true });   // PHY-X: heal_scale_up[hpratio][LE] (≤)
        if (!S1) return;
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit) return;
          const t = c.targets[0];
          const sk = unit.skill;
          if (!t || t.side !== 'ally' || t.hpRatio >= 0.5 || !sk || !sk.ready || unit.s.flags.silence) return;
          if (sk.activate('DEFAULT')) unit.mem.bandage = t;
        }, { owner: unit, priority: 5 });
        battle.on('attack', (c) => {
          if (c.attacker !== unit || !unit.mem.bandage) return;
          const t = unit.mem.bandage;
          unit.mem.bandage = null;
          unit.mem.skipSp = true; // the skill heal recovers no attack SP (AK)
          if (t.alive) { battle.heal(unit, t, t.s.maxHp * num(bb.hp_ratio, 0.15)); battle.fx('bandage', { x: t.x, y: t.y, id: t.id }); }
        }, { owner: unit });
        battle.on('spGain', (c) => { if (c.unit === unit && c.reason === 'attack' && unit.mem.skipSp) { unit.mem.skipSp = false; c.amount = 0; } }, { owner: unit });
      },
    };
  },
});
