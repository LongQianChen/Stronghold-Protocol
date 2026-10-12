// server/sim/content/kits/ops/chess_char_3_20-kjera.js — 耶拉 (char_4013_kjera) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { num, defOf, talentBb, altSkills, statSkill, funnelMap, installFunnelPrune } from '../shared/tier3.js';

export const DRONE_TAG = 'kjera:drone';

// One step of the per-target ramp. Two drones that hit the same enemy in the same tick share the step (funnelMap).
function stepMap(ramp, id, time, f) {
  const prev = ramp.get(id);
  if (prev && prev.t === time) return prev.s;
  const s = prev == null ? f.init : Math.min(f.max, prev.s + f.delta);
  ramp.set(id, { s, t: time });
  return s;
}

function acquire(battle, unit, rel) {
  const prof = unit.profile;
  const ok = (e) => !!e && e.alive && canTargetEnemy(unit, e, prof);
  const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
  for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
  sortEnemyTargets(battle, unit, cands, prof.priority);
  const usable = cands.filter(ok);
  const held = new Set();
  for (const d of rel.drones) {
    if (d.lock && ok(d.lock)) held.add(d.lock);
    else { d.lock = null; d.scale = null; }
  }
  for (const d of rel.drones) {
    if (d.lock) continue;
    const e = usable.find((x) => !held.has(x)) ?? usable[0] ?? rel.drones.find((x) => x.lock)?.lock ?? null;
    if (!e) continue;
    held.add(e);
    d.lock = e;
    d.scale = null;
  }
}

/**
 * 心随意动 (skchr_kjera_2, docs/research/03-operators.md): release `1 + attack@cnt` drones that stay locked until the
 * enemy dies or the skill ends, ATK +, and a cold roll on her own attack and on each drone hit. The body keeps its
 * ordinary attack inside her range; the unreleased addition is off while the drones are out.
 * `restart` (hidden form): each drone begins at the trait's initial scale and is not written back.
 * Otherwise the drones continue the per-target ramp and that map is restored when the skill ends.
 * [ASSUMED] The released drones use the trait ramp (init / +delta / cap). Her blackboard has no drone scale.
 * [ASSUMED] No flight delay. A lock that can no longer be targeted is dropped and the drone retargets. Stun and
 * disarm do not pause the released drones (the skill tick still runs).
 */
export function kjeraRelease(bb, { restart = false, announce = false } = {}) {
  const n = 1 + Math.max(0, Math.floor(num(bb['attack@cnt'], 0)));
  const prob = num(bb['attack@prob'], 0), cold = num(bb['attack@cold'], 0);
  return {
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit }) {
        const key = typeof unit.profile.funnelMul === 'function' ? 'funnelMul' : 'dmgMul';
        const mul = unit.profile[key];
        unit.profile = { ...unit.profile, [key]: null };
        const ramp = restart ? null : new Map();
        if (ramp && unit.trait.funnelMap) {
          for (const [id, v] of unit.trait.funnelMap) ramp.set(id, { s: v.s, t: v.t });
        }
        unit.mem.kjeraRel = {
          key, mul, restart, ramp, cd: 0,
          target: unit.trait.funnelTarget ?? null,
          scale: unit.trait.funnelScale,
          drones: Array.from({ length: n }, () => ({ lock: null, scale: null })),
        };
        if (announce) battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n });
      },
      onTick({ battle, unit, dt }) {
        const rel = unit.mem.kjeraRel;
        if (!rel || !unit.alive || !unit.skill?.active) return;
        rel.cd = Math.max(0, rel.cd - dt);
        acquire(battle, unit, rel);
        if (!rel.drones.some((d) => d.lock) || rel.cd > 1e-9) return;
        rel.cd = unit.s.interval;
        const f = unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
        for (const d of rel.drones) {
          if (!d.lock || !d.lock.alive) continue;
          const scale = rel.restart
            ? (d.scale = d.scale == null ? f.init : Math.min(f.max, d.scale + f.delta))
            : stepMap(rel.ramp, d.lock.id, battle.time, f);
          battle.fx('drone', { x: d.lock.x, y: d.lock.y, id: unit.id });
          battle.dealDamage(unit, d.lock, {
            amount: unit.s.atk * unit.s.atkScaleMul * scale, type: 'arts',
            isSkill: true, isAttack: false, tags: ['skill', 'drone', DRONE_TAG],
          });
          if (d.lock.alive && cold > 0 && battle.rng.chance(prob)) {
            battle.applyStatus(d.lock, 'cold', { duration: cold, source: unit });
          }
        }
      },
      onEnd({ unit }) {
        const rel = unit.mem.kjeraRel;
        unit.mem.kjeraRel = null;
        if (!rel) return;
        unit.trait.funnelTarget = rel.target;
        unit.trait.funnelScale = rel.scale;
        if (rel.ramp) unit.trait.funnelMap = rel.ramp;
        if (unit.profile && rel.key) unit.profile = { ...unit.profile, [rel.key]: rel.mul };
      },
    },
    install(battle, unit) {
      // 自身攻击: one cold roll on the ordinary body hit. Drone hits roll in onTick, so they are not rolled again.
      battle.on('damaged', (ctx) => {
        if (!unit.mem.kjeraRel || ctx.source !== unit || !ctx.target?.alive || !ctx.dmg) return;
        if (!ctx.dmg.isAttack || ctx.dmg.isSkill) return;
        const tags = ctx.dmg.tags || [];
        if (tags.includes('addition') || tags.includes('funnel') || tags.includes(DRONE_TAG)) return;
        if (!(cold > 0) || !battle.rng.chance(prob)) return;
        battle.applyStatus(ctx.target, 'cold', { duration: cold, source: unit });
      }, { owner: unit });
    },
  };
}

export default {
  // ---- 3_20 耶拉 · 驭械术师 — S2 心随意动: +1 drone (2 locks; a lone enemy gets both), ATK +, cold procs; 低眉: ATK +
  //      (more with ≥cnt ground tiles in range). S1 攻击力强化·γ型: ATK + only (one unreleased drone, the trait ramp).
  chess_char_3_20_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const rel = kjeraRelease(bb, { restart: false });
    return {
      trait: { funnelMul: funnelMap },
      skill: rel.skill,
      skills: altSkills(chess, d, bb, { 'skcom_atk_up[3]': statSkill }),
      install(battle, unit) {
        installFunnelPrune(battle, unit);
        rel.install(battle, unit);
      },
      talents: [{ install(battle, unit) {
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit) return;
          let low = 0;
          for (const k of unit.baseRangeKeys || []) {
            const r = (k / COLS) | 0, c = k % COLS;
            if (battle.grid.inRect(r, c) && battle.grid.isLow(r, c)) low++;
          }
          const atk = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'talent:kjera_brow', mods: { atkPct: atk } });
        }, { owner: unit });
      } }],
    };
  },
};
