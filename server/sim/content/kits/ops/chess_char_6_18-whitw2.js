// server/sim/content/kits/ops/chess_char_6_18-whitw2.js — 荒芜拉普兰德 (char_1038_whitw2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { sortEnemyTargets, canTargetEnemy } from '../../../targeting.js';
import { rotateOffset } from '../../../dir.js';
import { bodyDist } from '../../../body.js';
import { num, tbb, hasBond, ANY, selectedSkill, skillGridOf, WHOLE_FIELD, bstate, aura } from '../shared/tier6.js';
import { boundedCount } from '../../../../../shared/plugins/limits.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';
import { hypot, sin, cos, atan2 } from '../../../detmath.js';

// ------------------------------------------------------------------------------------------------------------------
// 荒芜拉普兰德 chess_char_6_18 (驭械术师) — S3 终幕·浩劫; 头狼; 叙拉古的荣幸

/**
 * S3 终幕·浩劫's drone flight — PRTS 荒芜拉普兰德 S3 备注 "技能流程": ① for `attack@times` (1.3) s after the cast, or after
 * a drone is added ("补充浮游单元"), the drones spread evenly outward from her, one along her facing ("散开的方向始终包括
 * 自身的朝向"): 初速度 0.1, 加速度 1.9, 最大速度 2.0 — [ASSUMED] after an addition (头狼 stage 3 mid-skill) only the added
 * drone spreads, along her facing, while the others carry on; ② then each picks the target nearest to itself, ties
 * nearest to her ("距离自身最近>距离本体最近"), anywhere on the field, and flies at it: 初速度 2.0, 加速度 1.0, 最大速度
 * 4.0, restarting at 2.0 whenever its target leaves or turns unselectable on the way; ③ once there it stays on the target
 * and attacks it like a normal drone ("此状态下的攻击行为同正常浮游单元"); when that target leaves / turns unselectable it
 * reappears at a random point of the 1.5-side square around it and picks again (②). With no selectable target it circles
 * (radius 0.9, 1.0 tiles/s, counter-clockwise) with its heading as the tangent, the circle on its left. Speeds in tiles/s.
 */
const WHITW2_SPREAD = Object.freeze({ v0: 0.1, acc: 1.9, max: 2 });
const WHITW2_CHASE = Object.freeze({ v0: 2, acc: 1, max: 4 });
const WHITW2_REAPPEAR_SIDE = 1.5;
const WHITW2_ORBIT = Object.freeze({ r: 0.9, v: 1 });

function whitw2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1);
  const sid = selectedSkill(chess, def);
  const spreadTime = Math.max(0, num(bb['attack@times'], 1.3)), R = num(bb['attack@range_radius'], 0.9);
  const dmgScale = num(bb['attack@magic_atk_scale'], 1), fear = num(bb['attack@fear']), slow = num(bb['attack@move_speed']);
  // "非移动敌人": blocked, or not walking (stunned, bound, asleep, waiting, speed 0 …)
  const still = (e) => !!e.blockedBy || e.moving === false || !(e.s.moveSpeed > 0) || !!(e.s.flags.stun || e.s.flags.freeze || e.s.flags.bind || e.s.flags.sleep || e.s.flags.noMove);
  const skillGridW = skillGridOf(def);

  // ---- S3 drones (virtual: positions in unit.mem.drones, fx events for the client) --------------------------------
  const droneCount = (unit) => 1 + Math.floor(num(bb['attack@cnt'])) + ((unit.mem.wolfStage || 0) >= 3 ? 1 : 0);
  // ① `k` drones leave her evenly spread, the first along her facing (row 0 is the bottom row: angles in the (col, row)
  // plane, counter-clockwise)
  const releaseDrones = (unit, k) => {
    const a0 = atan2(unit.fwd[0], unit.fwd[1]);
    for (let i = 0; i < k; i++) {
      const a = a0 + (2 * Math.PI * i) / k;
      unit.mem.drones.push({ x: unit.x, y: unit.y, hx: cos(a), hy: sin(a), v: WHITW2_SPREAD.v0, age: 0, phase: 'spread', t: null, cd: 0, rampId: null, ramp: 0, orbit: null });
    }
  };
  // speed v → v + acc·dt (capped); the distance covered at the mean of the two (exact under constant acceleration)
  const accelerate = (d, lim, dt) => { const v1 = Math.min(lim.max, d.v + lim.acc * dt), s = ((d.v + v1) / 2) * dt; d.v = v1; return s; };
  // ② the selectable enemy nearest to the drone, ties broken by the one nearest to her. [ASSUMED] distances are measured
  // to every enemy's position (a huge enemy's centre, its 判定中心) — the owner's decision of 2026-10-04: the centre, so
  // leader rounds stay close to 0.1.1; the sim's general convention for operator-side distance picks, the hit rectangle
  // (body.js bodyDist: targeting.js sortEnemyTargets 'nearest', 空弦's enemiesAround, 异客 / 溯光星源's chains), was
  // considered — it made a huge leader (胄, 管) the nearest enemy of every drone around it (DESIGN §22.9)
  const pickTarget = (battle, unit, d, ok) => {
    let best = null, bd = Infinity, bh = Infinity;
    for (const e of battle.enemies) {
      if (!ok(e)) continue;
      const de = hypot(e.x - d.x, e.y - d.y), dh = hypot(e.x - unit.x, e.y - unit.y);
      if (de < bd - 1e-9 || (de <= bd + 1e-9 && dh < bh - 1e-9)) { best = e; bd = de; bh = dh; }
    }
    return best;
  };
  // nothing selectable: circle counter-clockwise on its left, its heading the tangent
  const circle = (d, dt) => {
    const { r, v } = WHITW2_ORBIT;
    if (!d.orbit) d.orbit = { cx: d.x - d.hy * r, cy: d.y + d.hx * r };
    const a = atan2(d.y - d.orbit.cy, d.x - d.orbit.cx) + (v / r) * dt;
    d.x = d.orbit.cx + r * cos(a); d.y = d.orbit.cy + r * sin(a);
    d.hx = -sin(a); d.hy = cos(a);
  };
  // one tick of one drone: spread → (pick) → chase → on the target, attacking like a normal drone. [ASSUMED] its attack
  // clock runs all the time (one attack per interval of hers at most, whatever it chased in between) and its first hit
  // lands as it arrives when the clock is ready; [ASSUMED] a drone on a target sits at its position (a huge enemy's
  // centre, its 判定中心), and it reaches a huge enemy when it touches the hit rectangle. [ASSUMED] the turn rate (PRTS
  // 转向速度 1/6 per frame = attack@projectile_turn_speed × 1/30 s) is not modelled: a chasing drone heads straight at
  // its target. [ASSUMED] the fear's source is her (the enemy flees from her, not from the drone).
  const flyDrone = (battle, unit, d, dt, ok) => {
    d.cd = Math.max(0, d.cd - dt);
    if (d.phase === 'spread') {
      const s = accelerate(d, WHITW2_SPREAD, dt);
      d.x += d.hx * s; d.y += d.hy * s;
      d.age += dt;
      if (d.age + 1e-9 < spreadTime) return;
      d.phase = 'seek';
    }
    if (d.phase === 'lock' && !ok(d.t)) {
      // ③ its target left / is no longer selectable: it reappears at a random point of the square around that spot (the
      // draw taken in her facing-RIGHT frame, so a battle turned with her direction plays the same)
      const h = WHITW2_REAPPEAR_SIDE / 2;
      const [ar, ac] = rotateOffset(battle.rng.range(-h, h), battle.rng.range(-h, h), unit.dir);
      d.x = d.t.x + ac;
      d.y = d.t.y + ar;
      d.t = null; d.phase = 'seek';
    } else if (d.phase === 'chase' && !ok(d.t)) { d.t = null; d.phase = 'seek'; }
    if (d.phase === 'seek') {
      const t = pickTarget(battle, unit, d, ok);
      if (!t) { circle(d, dt); return; }
      d.t = t; d.phase = 'chase'; d.v = WHITW2_CHASE.v0; d.orbit = null;
      battle.fx('droneLock', { x: t.x, y: t.y, id: t.id, src: unit.id }); // PRTS: the red wolf-eye mark over the target
    }
    const t = d.t;
    if (d.phase === 'chase') {
      const s = accelerate(d, WHITW2_CHASE, dt);
      if (bodyDist(t, d.x, d.y) > s + 1e-9) {
        const dx = t.x - d.x, dy = t.y - d.y, L = hypot(dx, dy);
        if (L > 1e-9) { d.hx = dx / L; d.hy = dy / L; }
        d.x += d.hx * s; d.y += d.hy * s;
        return;
      }
      d.phase = 'lock'; // reached: "追上时使目标恐惧…并锁定其攻击"
      if (fear > 0) battle.applyStatus(t, 'fear', { duration: fear, source: unit });
    }
    d.x = t.x; d.y = t.y;
    if (d.cd > 1e-9 || !ok(t) || !unit.alive) return; // (the fear's hooks could have knocked her out)
    d.cd = unit.s.interval;
    const f = unit.profile?.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
    d.ramp = d.rampId === t.id ? Math.min(f.max, d.ramp + f.delta) : f.init;
    d.rampId = t.id;
    battle.fx('drone', { x: d.x, y: d.y, id: unit.id });
    battle.dealDamage(unit, t, { amount: unit.s.atk * unit.s.atkScaleMul * d.ramp, type: 'arts', tags: ['droneAttack'] });
  };

  const skills = {
    // S1 慵怠者悲鸣: passive 浮游单元+1 (trait: one more hit per attack); toggled on: ATK +atk and the drones lock a random
    // non-moving enemy anywhere on the field (re-locking when it moves or falls; install), else her range. The toggle
    // retargets her attack; the text does not say she stops attacking, so the body and both unreleased additions stay.
    // The whole-field grid only selects those targets — no rangeId, no 攻击范围 in the text — so the card keeps her 3-1
    // (showOwnRange)
    skchr_whitw2_1: {
      kind: 'toggle',
      // [ASSUMED] her drones lock enemies only (install): 白铁's 铁钳号 alone does not open S1 / S2 (skills.js allyTargetsOk)
      allyTargets: false,
      mods: { atkPct: num(bb.atk) },
      targeting: { rangeGrid: WHOLE_FIELD, showOwnRange: true },
      onStart({ unit }) { unit.mem.lazyLock = null; },
    },
    // S2 逐猎狂飙: 浮游单元+attack@cnt, skill range, ATK +atk: every drone locks a random enemy of the range until it falls
    // (install); each drone hit ramps on its own target (trait init → max) and fears it attack@fear s with attack@prob
    skchr_whitw2_2: {
      kind: 'duration',
      allyTargets: false,
      mods: { atkPct: num(bb.atk) },
      ...(skillGridW ? { targeting: { rangeGrid: skillGridW } } : {}),
      attack: {
        hits: 1,
        // The skill names the released drones, not a second hit from her. 0 keeps the ramp inside these hits.
        funnelBodyHits: 0,
        funnelMul(battle, unit, target) {
          const f = unit.profile?.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
          const m = unit.mem.hunt;
          if (!m) return f.init;
          const v = m.ramp.has(target.id) ? Math.min(f.max, m.ramp.get(target.id) + f.delta) : f.init;
          m.ramp.set(target.id, v);
          return v;
        },
        onEachHit({ battle, unit, target, kind }) {
          if (kind !== 'main' || !target || !target.alive || !(num(bb['attack@fear']) > 0)) return;
          if (battle.rng() < num(bb['attack@prob'])) battle.applyStatus(target, 'fear', { duration: num(bb['attack@fear']), source: unit });
        },
      },
      onStart({ unit }) { unit.mem.hunt = { locks: [], ramp: new Map() }; },
      onEnd({ unit }) { unit.mem.hunt = null; },
    },
  };
  return {
    skills,
    // S1 "被动效果：浮游单元+1": one more drone hit with every normal attack
    trait: sid === 'skchr_whitw2_1' ? { hits: 2 } : null,
    install(battle, unit) {
      if (sid === 'skchr_whitw2_1') {
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const ok = (e) => e && e.alive && !e.hidden && canTargetEnemy(unit, e, ANY);
          let L = unit.mem.lazyLock;
          if (!ok(L) || !still(L)) {
            const c = battle.enemies.filter((e) => ok(e) && still(e));
            L = unit.mem.lazyLock = c.length ? battle.rng.pick(c) : null;
          }
          if (L) { ctx.targets = [L]; return; }
          // nothing stands still: her own (initial) range
          const own = battle.enemiesInKeys(unit.baseRangeKeys || [], unit, ctx.profile);
          sortEnemyTargets(battle, unit, own, ctx.profile?.priority ?? null);
          ctx.targets = own.slice(0, 1);
        }, { owner: unit });
      }
      if (sid === 'skchr_whitw2_2') {
        battle.on('beforeAttack', (ctx) => {
          const m = unit.mem.hunt;
          if (ctx.attacker !== unit || !unit.skill?.active || !m) return;
          // the skill range, plus the enemies she blocks (always her targets, Battle.blockedTargets — DESIGN §20.3)
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
          for (const e of battle.blockedTargets(unit, ctx.profile)) if (!c.includes(e)) c.push(e);
          if (!c.length) { ctx.targets = []; return; }
          const n = 1 + Math.floor(boundedCount(num(bb['attack@cnt']), bbCap('attack@cnt'), 0)) + ((unit.mem.wolfStage || 0) >= 3 ? 1 : 0);
          m.locks = m.locks.filter((e) => e.alive && c.includes(e)).slice(0, n);
          while (m.locks.length < n) { // loop-cap: bbCap attack@cnt; picks only from enemies already in range
            const free = c.filter((e) => !m.locks.includes(e));
            m.locks.push(battle.rng.pick(free.length ? free : c));
          }
          ctx.targets = m.locks.slice();
        }, { owner: unit });
      }
    },
    // S3 终幕·浩劫: ATK +atk; 1 + attack@cnt drones (+1 from 头狼 stage 3) fly the PRTS 技能流程 (WHITW2_* above). Every
    // drone is out, so she makes no normal attack of her own (`noAttack`); a drone on its target attacks it every attack
    // interval of hers (her live ASPD; [ASSUMED] the first hit as it arrives) for ATK × its OWN funnel ramp — the trait's
    // init, +delta per hit on the same target, the cap (头狼 stage 1 raises it), back to init on a new target (PRTS 分支特性
    // 信息 驭械术师 "浮游单元攻击不同目标…时，上述的伤害立刻恢复至初始值"). That damage is arts and neither a normal attack
    // nor skill damage (PRTS S3 备注 "该技能释放的浮游单元造成的伤害不属于普通攻击/技能直接伤害", which for this skill
    // overrides the branch note "通过技能释放的浮游单元造成技能直接伤害": no 'attack' hook, isAttack / isSkill false — the
    // on-attack items skip it; it is still 普通伤害, so the 叙拉古 6 proc rolls on it, bonds/core.js siracusaRolls), and
    // 缴械 does not stop it (PRTS 驭械术师 "…不受缴械类效果
    // 制约"); [ASSUMED] nor do her stun, freeze or silence (PRTS names only 缴械) — the skill ticks on and so do the drones.
    // Around every drone (attack@range_radius): move speed attack@move_speed and, once per second, attack@magic_atk_scale
    // × ATK arts (不叠加: one hit per enemy whatever the number of drones); [ASSUMED] that area hit keeps `isSkill` (a skill
    // DoT — the 备注 speaks of 直接伤害) and is 持续伤害 (tag dot: PRTS 备注 "持续法术伤害" — no 叙拉古 6 roll, 锡人's
    // 凋敝魂灵 raises it). A knocked-out / withdrawn wolf (onEnd cleared the drones mid-tick, e.g. from a
    // kill hook) deals nothing more in that tick.
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: { noAttack: true },
      onStart({ battle, unit }) {
        unit.mem.drones = [];
        unit.mem.droneAcc = 0;
        releaseDrones(unit, droneCount(unit));
        battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.drones.length });
      },
      onTick({ battle, unit, dt }) {
        const D = unit.mem.drones;
        if (!D) return;
        const gone = () => !unit.alive || unit.mem.drones !== D;
        // 头狼 stage 3 reached while the skill runs: the extra drone is released (PRTS ① "补充浮游单元"; [ASSUMED] only it spreads)
        const add = droneCount(unit) - D.length;
        if (add > 0) { releaseDrones(unit, add); battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n: add }); }
        const ok = (e) => e && e.alive && !e.hidden && canTargetEnemy(unit, e, ANY);
        for (const d of D) {
          if (gone()) return;
          flyDrone(battle, unit, d, dt, ok);
        }
        if (gone()) return;
        const near = new Set();
        for (const d of D) for (const e of battle.foesInRadius(d.x, d.y, R)) if (ok(e)) near.add(e);
        if (slow) for (const e of near) battle.addBuff(e, { key: 'whitw2:slow', duration: 0.2, refresh: 'replace', mods: { moveMul: Math.max(0, 1 + slow) }, source: unit });
        unit.mem.droneAcc += dt;
        if (unit.mem.droneAcc + 1e-9 >= 1) {
          unit.mem.droneAcc -= 1;
          for (const e of near) {
            if (gone()) return;
            if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dmgScale, type: 'arts', isSkill: true, tags: ['skill', 'drone', 'dot'] });
          }
          // (a drone on its target already pulses with each of its attacks)
          for (const d of D) if (d.phase !== 'lock') battle.fx('drone', { x: d.x, y: d.y, id: unit.id });
        }
      },
      onEnd({ unit }) { unit.mem.drones = null; },
    },
    talents: [
      { install(battle, unit) { // 头狼
        const iv = Math.max(1, num(t0.interval, 20)), cap = num(t0.scale, 1), sil = num(t0['attack@silence_duration']);
        const baseFunnel = unit.profile?.funnel ? { ...unit.profile.funnel } : null;
        const baseHits = Math.max(1, Math.floor(num(unit.profile?.hits, 1)));
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          unit.mem.wolfStage = 0;
          if (unit.profile) { unit.profile.hits = baseHits; if (baseFunnel) unit.profile.funnel = { ...baseFunnel }; }
        }, { owner: unit });
        aura(battle, unit, 1, () => {
          const st = Math.min(3, Math.floor((battle.time - unit.deployedAt + 1e-6) / iv));
          if (st <= (unit.mem.wolfStage || 0)) return;
          unit.mem.wolfStage = st;
          // stage 1: 伤害上限提高10% (funnel cap × scale)
          if (st >= 1 && baseFunnel && unit.profile) unit.profile.funnel = { ...baseFunnel, max: baseFunnel.max * cap };
          // stage 3: 数量+1 — one more drone hits her target with every normal attack (and S3 releases one more)
          if (st >= 3 && unit.profile) unit.profile.hits = baseHits + 1;
          battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'alpha', stage: st });
        });
        // stage 2: 造成伤害时使目标特殊能力失效2秒 (= silence)
        if (sil > 0) battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || (unit.mem.wolfStage || 0) < 2 || !ctx.target.alive || ctx.target.side !== 'enemy' || ctx.type === 'element') return;
          battle.applyStatus(ctx.target, 'silence', { duration: sil, source: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 叙拉古的荣幸: one team effect per player, the strongest copy's numbers
        const S = bstate(battle);
        S.siracusa ??= new Map();
        const cur = S.siracusa.get(unit.ownerId);
        const sp = num(t1.sp), as = num(t1.attack_speed);
        if (cur) { cur.sp = Math.max(cur.sp, sp); cur.as = Math.max(cur.as, as); return; }
        const cfg = { sp, as };
        S.siracusa.set(unit.ownerId, cfg);
        const sira = (u) => u && u.kind === 'op' && u.ownerId === unit.ownerId && hasBond(u, 'siracusaShip');
        // 初始技力+5: every (re)deployment starts with +5 SP (not on top of the SP a unite helper carries over)
        battle.on('deploy', ({ unit: u, initial }) => {
          if (!(cfg.sp > 0) || !sira(u) || !u.skill) return;
          if (initial && u.carry && Number.isFinite(u.carry.sp)) return;
          u.skill.gainSp(cfg.sp, 'talent');
        });
        // elite: 首次触发技能后攻击速度+10
        battle.on('skillStart', ({ unit: u }) => {
          if (!cfg.as || !sira(u) || u.mem.siracusaHonor === u.deploySeq) return;
          u.mem.siracusaHonor = u.deploySeq;
          battle.addBuff(u, { key: 'whitw2:honor', mods: { aspd: cfg.as } });
        });
      } },
    ],
  };
}

export default {
  chess_char_6_18_a: whitw2,
};
