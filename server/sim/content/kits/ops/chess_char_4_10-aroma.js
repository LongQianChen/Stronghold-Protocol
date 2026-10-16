// server/sim/content/kits/ops/chess_char_4_10-aroma.js — 阿罗玛 (char_446_aroma) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import { num, tbb, keySet, skillActive, isSel, alt, instantKind, withDefaults } from '../shared/tier4.js';
import { hypot } from '../../../detmath.js';

/** 阿罗玛's 非首次标记 (talent 起泡性能测试): one per enemy, shared by every 阿罗玛 (PRTS 备注). */
const AROMA_MARK = 'aroma:bubbled';

export default withDefaults({
  // ===== 阿罗玛 (blastcaster) S2 小心地滑 — +ATK, levitated enemies take 65 % ATK arts on landing; talent 起泡性能测试
  //       S1 强效清洁 (charges: next attack 150 %/180 % arts, flying victims +55 %/70 % ATK arts)
  chess_char_4_10_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const land = num(bb['attack@atk_scale_when_fly_finish'], 0.65);
    const S2 = isSel(def, 'skchr_aroma_2');
    return {
      skills: alt(def, {
        skchr_aroma_1: () => ({
          kind: instantKind(def),
          attack: {
            atkScale: num(bb.atk_scale, 1.5),
            onEachHit({ battle, unit, target }) { // every enemy of her line the blast strikes that flies
              if (target && target.alive && target.isFlying) battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb.atk_scale_to_fly, 0.55), type: 'arts', isSkill: true, tags: ['skill', 'antiAir'] });
            },
          },
        }),
      }),
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, onStart({ battle, unit }) { battle.fx('slippery', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { // first attack on each enemy: ×1.1 and levitate 2.5 s
        // PRTS 阿罗玛 备注: "天赋采用施加非首次标记的方式判断是否为'首次进行攻击'，自身离场时移除自身已施加的标记，不同阿罗玛之间的
        // 非首次标记通用" — one mark per enemy (AROMA_MARK, the setter as source) for every 阿罗玛; hers go when she leaves
        // the field (until 0.1.1 each 阿罗玛 kept her own list, so two of them both triggered on one enemy)
        unit.mem.bubbled = new Set(); // the enemies she marked
        battle.on('hit', (c) => {
          const e = c.target;
          if (c.source !== unit || !c.dmg.isAttack || e.side !== 'enemy' || e.findBuff(AROMA_MARK)) return;
          battle.addBuff(e, { key: AROMA_MARK, source: unit });
          unit.mem.bubbled.add(e.id);
          c.dmg.mul *= num(t0.damage_scale, 1.1);
          if (battle.applyStatus(e, 'levitate', { duration: num(t0.levitate_duration, 2.5), source: unit })) battle.fx('levitate', { x: e.x, y: e.y, id: e.id });
        }, { owner: unit });
        battle.on('death', (c) => {
          if (c.unit !== unit) return;
          for (const id of unit.mem.bubbled) {
            const e = battle.unitById(id);
            if (e && e.findBuff(AROMA_MARK)?.source === unit) battle.removeBuff(e, AROMA_MARK);
          }
          unit.mem.bubbled.clear();
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // S2: landing damage for every levitated enemy (any source) that lands inside her range while the skill runs
        const floating = new Map();
        battle.on('statusApplied', (c) => { if (c.status === 'levitate' && c.target.side === 'enemy') floating.set(c.target.id, c.target); }, { owner: unit });
        battle.every(1 / 30, () => {
          for (const [id, e] of floating) {
            if (!e.alive) { floating.delete(id); continue; }
            if (e.findBuff('levitate')) continue;
            floating.delete(id);
            if (S2 && unit.alive && unit.deployed && skillActive(unit) && bodyInRange(e, keySet(unit))) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * land, type: 'arts', isSkill: true, tags: ['skill', 'landing'] });
              battle.fx('splash', { x: e.x, y: e.y, id: e.id });
            }
          }
        }, { owner: unit });
        // module (elite) trait: farther targets take more damage (up to ×1.1)
        const ds = num(tb.damage_scale, 0);
        if (ds > 0) {
          const lo = num(tb.min_dist, 0), hi = num(tb.max_dist, 4);
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg.isAttack) return;
            const d = hypot(c.target.x - unit.x, c.target.y - unit.y);
            c.dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo)));
          }, { owner: unit });
        }
      },
    };
  },
});
