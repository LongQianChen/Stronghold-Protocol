// server/sim/content/kits/ops/chess_char_2_10-rockr.js — 洛洛 (char_4040_rockr) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { num, talentBb, up } from '../shared/tier1.js';

export const DRONE_TAG = 'rockr:drone';

const firstTarget = (battle, unit) => {
  const prof = unit.profile;
  const candidates = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
  for (const e of battle.blockedTargets(unit, prof)) if (!candidates.includes(e)) candidates.push(e);
  sortEnemyTargets(battle, unit, candidates, prof.priority);
  return candidates[0] ?? null;
};

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_10 洛洛 自负此轭: ASPD +attack_speed. The skill releases its drone, which keeps the lock after the target leaves
  // her range and returns only when that enemy dies or the skill ends (docs/research/03-operators.md, skchr_rockr_2).
  // While it is out, the unreleased drone's additional damage is off and the drone's own hits are skill damage.
  // 过载 (term ba.overdrive "技能进行到一半时触发额外效果"): the second half of the duration — ATK +atk and the funnel cap
  // ×scale; when the skill ends she is stunned as long as the overload lasted. 立于磐石: ATK +atk per `interval` s on the
  // field, up to max_stack_cnt stacks.
  // S1 战术咏唱·γ型 (alt): ASPD +attack_speed; the target lock belongs to 自负此轭 only.
  chess_char_2_10_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const endOverload = (battle, unit) => {
      if (unit.mem.rockFunnel) { unit.profile.funnel = unit.mem.rockFunnel; unit.mem.rockFunnel = null; }
      battle.removeBuff(unit, 'rockr:overload');
    };
    return {
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        onStart({ battle, unit, skill }) {
          unit.mem.rockOverAt = battle.time + skill.duration / 2;
          unit.mem.rockOver = false;
          // The released drone inherits the trait's ramp; the body still attacks only inside its own range.
          // `funnelMul` separates the addition; older profiles fold it into `dmgMul`. Keep launched shots unchanged.
          const key = typeof unit.profile.funnelMul === 'function' ? 'funnelMul' : 'dmgMul';
          const mul = unit.profile[key];
          unit.profile = { ...unit.profile, [key]: null };
          const lock = firstTarget(battle, unit);
          unit.mem.rockDrone = { lock, cd: 0, key, mul,
            target: unit.trait.funnelTarget, scale: unit.trait.funnelScale };
          unit.mem.rockLock = lock;
        },
        onTick({ battle, unit, dt }) {
          if (!unit.mem.rockOver && battle.time + 1e-9 >= unit.mem.rockOverAt) {
            unit.mem.rockOver = true;
            const f = unit.profile.funnel;
            if (f) { unit.mem.rockFunnel = f; unit.profile.funnel = { ...f, max: f.max * num(bb.scale, 1) }; }
            battle.addBuff(unit, { key: 'rockr:overload', mods: { atkPct: num(bb.atk) }, visible: true, tags: ['skill'] });
            battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
          }
          const d = unit.mem.rockDrone;
          if (!d || !unit.alive || !unit.skill.active) return;
          d.cd = Math.max(0, d.cd - dt);
          // [ASSUMED] A newly unselectable lock is dropped and the drone retargets. No flight delay, and body control
          // (stun and the like) does not pause the released drone — same as the other independent skill drones.
          if (d.lock && !canTargetEnemy(unit, d.lock, unit.profile)) d.lock = null;
          if (!d.lock) d.lock = firstTarget(battle, unit);
          unit.mem.rockLock = d.lock;
          if (!d.lock || d.cd > 1e-9) return;
          d.cd = unit.s.interval;
          // Official S2 releases one drone (1 + attack@cnt = 1 at both ranks). The ramp lives on the drone, so a
          // pre-skill projectile that lands later cannot change it.
          const f = unit.profile.funnel;
          d.scale = d.target === d.lock.id ? Math.min(f.max, (d.scale ?? f.init) + f.delta) : f.init;
          d.target = d.lock.id;
          battle.fx('drone', { x: d.lock.x, y: d.lock.y, id: unit.id });
          battle.dealDamage(unit, d.lock, { amount: unit.s.atk * unit.s.atkScaleMul * d.scale,
            type: 'arts', isSkill: true, isAttack: false, tags: ['skill', 'drone', DRONE_TAG] });
        },
        onEnd({ battle, unit, reason }) {
          const over = unit.mem.rockOver ? battle.time - unit.mem.rockOverAt : 0;
          const d = unit.mem.rockDrone;
          unit.mem.rockDrone = null;
          endOverload(battle, unit);
          if (d) {
            unit.trait.funnelTarget = d.target;
            unit.trait.funnelScale = d.scale;
            unit.profile = { ...unit.profile, [d.key]: d.mul };
          }
          unit.mem.rockOver = false;
          unit.mem.rockLock = null;
          if (over > 0 && reason !== 'death' && unit.alive) battle.applyStatus(unit, 'stun', { duration: over, source: unit });
        },
      },
      skills: { 'skcom_magic_rage[3]': { kind: 'duration', mods: { aspd: num(bb.attack_speed) } } },
      talents: [{ install(battle, unit) {
        const iv = num(t.interval), max = Math.floor(num(t.max_stack_cnt)), v = num(t.atk);
        if (!(iv > 0) || !(max > 0) || !v) return;
        battle.on('tick', () => {
          if (!up(unit)) return;
          const n = Math.min(max, Math.floor((battle.time - unit.deployedAt + 1e-9) / iv));
          const cur = unit.findBuff('rockr:rock');
          if ((cur ? cur.stacks : 0) === n) return;
          if (n > 0) battle.addBuff(unit, { key: 'rockr:rock', mods: { atkPct: v }, stacks: n, maxStacks: max, tags: ['talent'] });
          else battle.removeBuff(unit, 'rockr:rock');
        }, { owner: unit });
      } }],
    };
  },
};
