// server/sim/content/kits/ops/chess_char_2_06-papyrs.js — 莎草 (char_4139_papyrs) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import { num, talentBb, up, alliesInGridOf, instantKind, batMod } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_06 莎草 巧思乍现 (AUTO, 2 charges): the next heal is heal_scale × ATK (chain jumps included) and the talent
  // barrier is shield_scale_skill × stronger. 博览古卷: every heal gives the target a barrier of attack@scale × ATK for
  // attack@shield_duration s. (Chain falloff incl. the elite module comes from the chainhealer profile.)
  // S2 临考发挥 (alt): on start lock the ally in range (not herself, no 禁疗; any profession, summons included) with the
  // highest max HP; while it runs that ally is the only main heal target, base attack time +base_attack_time s (−1.1
  // on 2.85), ATK +atk, chain jumps +attack@chain.extra_value. PRTS: "无法可选单位时无法开启技能" — with no lockable
  // ally the skill never activates (the talent install guards the unit's skill.activate: no skillStart, no
  // 萨尔贡 / 特质 "开启技能时" gains, SP kept); the skill stops at once when the locked ally leaves the field.
  chess_char_2_06_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const sc = num(t['attack@scale']), sd = num(t['attack@shield_duration'], 8), boost = num(bb.shield_scale_skill, 1);
    const extra = Math.max(0, Math.floor(num(bb['attack@chain.extra_value'])));
    const lockOf = (battle, unit) => alliesInGridOf(battle, unit)
      .filter((a) => a !== unit && !a.s.flags.noHeal && !a.profile?.noHeal)
      .sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq)[0] ?? null;
    const release = (battle, unit) => {
      if (unit.mem.papyrsHeal) { unit.profile.heal = unit.mem.papyrsHeal; unit.mem.papyrsHeal = null; }
      if (unit.mem.papyrsHook) battle.off(unit.mem.papyrsHook);
      unit.mem.papyrsHook = null;
      unit.mem.papyrsLock = null;
      unit.mem.papyrsAbort = false;
    };
    return {
      skill: { kind: instantKind(def), heal: true, attack: { healScale: num(bb.heal_scale, 1) } },
      skills: {
        skchr_papyrs_2: {
          kind: 'duration', heal: true, mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) },
          onStart({ battle, unit, skill }) {
            release(battle, unit);
            const lock = lockOf(battle, unit);
            // (only reachable when a runtime bypasses the activate guard below, e.g. a copied skill: undo on the next tick)
            if (!lock) { unit.mem.papyrsAbort = true; return; }
            unit.mem.papyrsLock = lock;
            const h = unit.profile.heal;
            if (h && extra > 0) { unit.mem.papyrsHeal = h; unit.profile.heal = { ...h, count: Math.max(1, h.count || 3) + extra }; }
            unit.mem.papyrsHook = battle.on('beforeAttack', (ctx) => {
              if (ctx.attacker !== unit || !skill.active) return;
              const L = unit.mem.papyrsLock;
              if (L && up(L) && bodyInRange(L, unit.rangeKeySet)) ctx.targets = [L];
            }, { owner: unit, priority: 10 });
            battle.fx('buff', { x: lock.x, y: lock.y, id: lock.id, kind: 'lock' });
          },
          onTick({ unit, skill }) {
            if (unit.mem.papyrsAbort) {
              // "无法可选单位时无法开启技能": undo the cast, keep the SP
              unit.mem.papyrsAbort = false;
              skill.end('noTarget');
              skill.addCharge(1);
              return;
            }
            const L = unit.mem.papyrsLock;
            if (!L || !up(L)) skill.end('target');
          },
          onEnd({ battle, unit }) { release(battle, unit); },
        },
      },
      talents: [{ install(battle, unit) {
        const sk = unit.skill;
        if (sk && sk.id === 'skchr_papyrs_2' && !Object.prototype.hasOwnProperty.call(sk, 'activate')) {
          // "无法可选单位时无法开启技能": every activation path (DEFAULT heal trigger, carried skill, content) is refused
          // while no ally can be locked — the charge stays, nothing starts (non-enumerable: never serialised)
          const activate = sk.activate;
          Object.defineProperty(sk, 'activate', {
            configurable: true, writable: true, enumerable: false,
            value(reason, opts) { return lockOf(battle, unit) ? activate.call(this, reason, opts) : false; },
          });
        }
        if (!(sc > 0)) return;
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || ctx.target === unit && ctx.opts?.regen || !(ctx.amount > 0)) return;
          const bySkill = !!(unit.skill?.active && unit.skill.pending);
          battle.addBuff(ctx.target, { key: 'papyrs:shield', shield: unit.s.atk * sc * (bySkill ? boost : 1), duration: sd, source: unit, visible: true, tags: ['talent'] });
        }, { owner: unit, priority: -10 });
      } }],
    };
  },
};
