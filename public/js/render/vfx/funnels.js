// render/vfx/funnels.js — the 驭械术士's floating units (浮游单元, DESIGN §33.18) of a battle unit, read from index.json:
// what floats beside the operator in which attack mode and where, how each unit attacks (a shot flown from its mount, or
// AttachToTarget at the target with its hit groups), what plays as it leaves and comes back, and 荒芜拉普兰德 S3's dispersed
// wolves. Pure logic over index.json: no GL, no DOM, Node-importable; render/vfx/funnelfx.js plays the plan.
//
//   funnelPlan(idx, unitKey)   → FunnelPlan (below), or null for a unit with no floating unit in the index
//   projectileHits(proj)       → the hit groups a funnel projectile plays ({ groups, overload, delay, attach, main })
//   planKeys(plan)             → every effect key of a plan (preloading)
//   initialCount(srec, n)      → how many of a mode's n units float at home before an attack shows it (the skill text)
//
// The official client (charpack/<id>.ab, `[uc]projectiles.ab`, the effect bundles — round 46's dumps): the floating
// units are no model of their own. They are effect prefabs that the attack abilities show at Special points of the
// operator's skeleton (the BoneFollower points of the skin: 荒芜拉普兰德's F_Funnel_Muzzle_1–3, 洛洛's F_UVA_01, 至简's F_Fly,
// 耶拉's F_Rock_1 / F_Rock_2, 澄闪's F_DroneA): the prefab's own FollowMountPoint names the point.
//   * A mode attack of class MultiFunnelsNormalAttack / MultiFunnelRemoteAttack (`attack.abilities`: its `_funnelActions`
//     — index v2) holds the units: each a sub-ability with its projectile and, on its node, a FunnelEffectEmitter (index
//     v3: `_idleEffect` — the loop while it is home —, `_idleBackEffect` for a unit facing back, `_overloadIdleEffect`
//     during an overload, `_appearEffect` / `_disappearEffect` as it comes back / leaves). Its projectile is the attack:
//     AttachToTarget at the target's HitPoint (`_delayTime` after reaching it: 荒芜拉普兰德's normal attack, 0.5 s) with an
//     EffectBehaviour hit or a SequenceEffectBehaviour's groups played in turn per hit (`_overloadGroups` in an overload;
//     the hit prefabs carry the unit itself: 荒芜拉普兰德's wolf lunging through the target, 洛洛's drone beside it on the
//     left then the right, 耶拉's token on the left / right).
//   * A general ability MultiFunnelNormalAttack (`units[id].abilities`, kind general; ON_ABILITY_CAST_ON_TARGET of the
//     owner's attack) is the funnel shot of an operator whose normal attack is her own: its projectile flies from its
//     mount (洛洛 SPECIAL_1, 至简 / 耶拉 SPECIAL_0, 澄闪 SPECIAL_1) with its casts on the unit (耶拉's
//     kjera_token_attack_start_01). The floating unit's look in those modes is the PassiveBuffAbility beside it (the
//     general ability `Effect` of the same modes: malist_drone, kjera_token_default, rockr_token_01, gdglow_token_01 —
//     TalentFx leaves it to FunnelFx: `idleNodes`).
//   * A skill's own MultiFunnelNormalAttack (至简 S2's Funnel_s2 at SPECIAL_2) replaces the general one for its attacks.
//   * A general ability whose class names a funnel and whose sub-abilities fire no projectile of their own
//     (Whitw2Skill3FunnelRangedAttack): its `projectiles` are the dispersed units — flights (a GroupedMovement of
//     spread / chase / attach / hover, with the flying unit as `main` and the chase's trace mark on the target) and their
//     `_attach` projectiles (the hits while latched, and the latched mark).
//
// FunnelPlan = {
//   unitKey,
//   modes: { [mode]: { name, cls, body, funnels: [Funnel], idle } }   the mode attacks' units (idle: any has a home loop)
//   general: [{ name, node, modes, mount, projectileKey, cast: [{ key, phase, loop }], idle: [{ key, node, mount }] }]
//   skills: { [skillId]: { mount, projectileKey } }                  a skill's own funnel shot
//   dispersed: { name, node, modes, units: [{ i, flight, attach, main, hits }], start: [{ key, s }], marks: { trace,
//                latched }, move: { spread, chase, hover, offset } } | null
//   idleNodes: Set<string>                                           the passive general abilities FunnelFx draws
// }
// Funnel = { i, node, mount, projectileKey, idle, back, overload, appear, disappear, hits, overloadHits, delay, attach }
// (mounts are MountPointType numbers, skills.js mountPointType; hit groups: [[key…]…] in turn per hit).

import { mountPointType } from './skills.js';
import { castPhase } from './skillfx.js';

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const first = (list) => (Array.isArray(list) ? list.map(lc).find(Boolean) || null : null);

/** Attack classes holding floating units (MultiFunnelsNormalAttack, MultiFunnelRemoteAttack, …). */
export const FUNNEL_CLASS = /Funnel/;
/** The general ability that fires a funnel shot with the owner's attack. */
const FUNNEL_SHOT = /MultiFunnelNormalAttack/;

/** The keys of a SequenceEffectBehaviour group list ([{ effectsWhenHit: [...] }, …]) — empty groups dropped. */
function groupsOf(list) {
  return (Array.isArray(list) ? list : []).map((g) => (Array.isArray(g?.effectsWhenHit) ? g.effectsWhenHit.map(lc).filter(Boolean) : [])).filter((g) => g.length);
}

/**
 * What a funnel projectile plays (index.json `projectiles[key]`): `groups` — its SequenceEffectBehaviour groups (one per
 * hit, in turn), else its EffectBehaviour hit as one group; `overload` — the overload groups when `_enableOverloadEffect`;
 * `delay` — AttachToTarget's `_delayTime` with `_delayAfterReached` (the hit comes that long after it reaches the
 * target); `attach` — it attaches to the target (no flight); `main` — its flying effect.
 * @returns {{ groups: string[][], overload: string[][]|null, delay: number, attach: boolean, main: string|null }}
 */
export function projectileHits(proj) {
  const out = { groups: [], overload: null, delay: 0, attach: false, main: lc(proj?.main) };
  if (!isObj(proj)) return out;
  const onHit = (Array.isArray(proj.onHit) ? proj.onHit : []).map(lc).filter(Boolean);
  let seq = null;
  for (const b of Array.isArray(proj.behaviours) ? proj.behaviours : []) {
    const f = isObj(b?.fields) ? b.fields : {};
    if (b?.class === 'SequenceEffectBehaviour') {
      const g = groupsOf(f._effectGroups);
      if (g.length) seq = g;
      if (f._enableOverloadEffect) { const o = groupsOf(f._overloadGroups); if (o.length) out.overload = o; }
    } else if (b?.class === 'AttachToTarget') {
      out.attach = true;
      if (f._delayAfterReached) out.delay = Math.max(0, Math.min(3, Number(f._delayTime) || 0));
    }
  }
  out.groups = seq ? seq.map((g) => [...new Set([...g, ...onHit])]) : onHit.length ? [onHit] : [];
  return out;
}

/** One unit of a mode attack (a sub-ability of a funnel attack). */
function funnelOf(ab, i, projs) {
  if (!isObj(ab)) return null;
  const em = (Array.isArray(ab.emitters) ? ab.emitters : []).find((e) => e?.class === 'FunnelEffectEmitter') || null;
  const pk = lc(ab.projectileKey);
  const proj = pk && isObj(projs[pk]) ? projs[pk] : null;
  const h = projectileHits(proj);
  return {
    i, node: typeof ab.node === 'string' ? ab.node : null, mount: mountPointType(ab.mount), projectileKey: proj ? pk : null,
    idle: first(em?.idleEffect), back: em?.useIdleBackEffect ? first(em?.idleBackEffect) : null,
    overload: em?.useOverloadEffect ? first(em?.overloadIdleEffect) : null,
    appear: first(em?.appearEffect), disappear: first(em?.disappearEffect),
    hits: h.groups, overloadHits: h.overload, delay: h.delay, attach: h.attach,
  };
}

/** A general ability's cast rows (its uses from an emitter's `_castEffects`) as { key, phase, loop }. */
function castRows(ab) {
  const out = [];
  for (const u of Array.isArray(ab?.uses) ? ab.uses : []) {
    if (!isObj(u) || u.list !== 'cast') continue;
    for (const k of Array.isArray(u.keys) ? u.keys : []) if (lc(k)) out.push({ key: lc(k), phase: castPhase(u), loop: u.oneshot === false });
  }
  return out;
}

/** The movements of a dispersed unit's flight (its projectile's behaviours), with the client's numbers. */
function movementOf(proj) {
  const mv = { spread: null, chase: null, hover: null, offset: null, trace: null };
  for (const b of Array.isArray(proj?.behaviours) ? proj.behaviours : []) {
    const f = isObj(b?.fields) ? b.fields : {};
    if (b?.class === 'AdvancedMovement') {
      const dyn = !!f._useDynamicSpeed;
      const m = { v0: Number(f._speed) || 0, acc: dyn ? Number(f._deltaSpeedPerSec) || 0 : 0, max: dyn ? Number(f._finalSpeed) || 0 : Number(f._speed) || 0 };
      if (f._awayFromSourceAsDirection) mv.spread = m; else mv.chase = m;
    } else if (b?.class === 'HoveringInPlaceMovement') {
      mv.hover = { r: Number(f._radius) || 0, v: Number(f._speed) || 0 };
    } else if (/MovementSwitchController/.test(b?.class || '')) {
      const hi = Array.isArray(f._randomOffsetMax) ? Number(f._randomOffsetMax[0]) : NaN;
      if (Number.isFinite(hi)) mv.offset = Math.abs(hi);
      mv.trace = lc(f._traceTargetBuff?.overrideEffectKey);
    }
  }
  return mv;
}

/** The effect of the buffs an `_attach` projectile leaves on its target while latched (its extra buffs' override key). */
function latchedMark(proj) {
  for (const b of Array.isArray(proj?.behaviours) ? proj.behaviours : []) {
    const extra = b?.fields?._actionController?._extraBuffsInTheEnd;
    for (const x of Array.isArray(extra) ? extra : []) if (lc(x?.overrideEffectKey)) return lc(x.overrideEffectKey);
  }
  return null;
}

/** A general funnel ability whose units fly as projectiles of their own (module header): the dispersed entry, or null. */
function dispersedOf(ab, projs) {
  const pks = (Array.isArray(ab.projectiles) ? ab.projectiles : []).map(lc).filter((k) => k && isObj(projs[k]));
  const flights = pks.filter((k) => !/_attach$/.test(k) && (projs[k].main || projs[k].movement));
  if (!flights.length) return null;
  const units = flights.map((pk, i) => {
    const att = pks.includes(`${pk}_attach`) ? `${pk}_attach` : null;
    return { i, flight: pk, attach: att, main: lc(projs[pk].main), hits: att ? projectileHits(projs[att]).groups : [] };
  });
  const mv = movementOf(projs[flights[0]]);
  const latched = units.map((u) => (u.attach ? latchedMark(projs[u.attach]) : null)).find(Boolean) || null;
  const start = [];
  for (const u of Array.isArray(ab.uses) ? ab.uses : []) {
    if (!isObj(u) || u.on !== 'owner' || !(u.role === 'loop' || u.role === 'start')) continue;
    const s = u.life?.type === 'LIMITED' && Number(u.life.time) > 0 ? Number(u.life.time) : 0;
    for (const k of Array.isArray(u.keys) ? u.keys : []) if (lc(k)) start.push({ key: lc(k), s });
  }
  return {
    name: ab.name ?? null, node: ab.node ?? null, modes: Array.isArray(ab.modes) ? ab.modes : [], units, start,
    marks: { trace: mv.trace, latched }, move: { spread: mv.spread, chase: mv.chase, hover: mv.hover, offset: mv.offset },
  };
}

/**
 * The floating units of an index unit (module header), or null when it has none.
 * @param {any} idx index.json (version 3: the emitters, the general abilities)
 * @param {string|null} unitKey
 */
export function funnelPlan(idx, unitKey) {
  const unit = unitKey && isObj(idx?.units) ? idx.units[unitKey] : null;
  if (!isObj(unit)) return null;
  const projs = isObj(idx.projectiles) ? idx.projectiles : {};
  const prefabs = isObj(idx.prefabs) ? idx.prefabs : {};
  const modes = {};
  for (const m of Array.isArray(unit.modes) ? unit.modes : []) {
    const a = m?.attack;
    if (!isObj(a) || !FUNNEL_CLASS.test(a.class || '')) continue;
    const funnels = (Array.isArray(a.abilities) ? a.abilities : []).map((ab, i) => funnelOf(ab, i, projs)).filter(Boolean);
    if (!funnels.length) continue;
    modes[m.name] = { name: m.name, cls: a.class, body: lc(a.projectileKey), funnels, idle: funnels.some((f) => !!f.idle) };
  }
  const general = [];
  let dispersed = null;
  const abilities = Array.isArray(unit.abilities) ? unit.abilities : [];
  for (const ab of abilities) {
    if (!isObj(ab) || !FUNNEL_CLASS.test(ab.class || '')) continue;
    if (FUNNEL_SHOT.test(ab.class)) {
      const sub = (Array.isArray(ab.abilities) ? ab.abilities : []).find((x) => FUNNEL_SHOT.test(x?.class || '')) || null;
      const pk = lc(sub?.projectileKey) || (Array.isArray(ab.projectiles) ? lc(ab.projectiles[0]) : null);
      general.push({
        name: ab.name ?? null, node: ab.node ?? null, modes: Array.isArray(ab.modes) && ab.modes.length ? ab.modes : ['Default'],
        mount: mountPointType(sub?.mount), projectileKey: pk && isObj(projs[pk]) ? pk : null, cast: castRows(ab), idle: [],
      });
    } else if (!dispersed) dispersed = dispersedOf(ab, projs);
  }
  // the floating unit's look in the general funnels' modes: the passive general abilities of those modes whose loops sit
  // on a mount point (a FollowMountPoint prefab: index.json prefabs[key].follow)
  const idleNodes = new Set();
  for (const g of general) {
    for (const ab of abilities) {
      if (!isObj(ab) || ab.kind !== 'general' || ab.when !== 'passive' || !/PassiveBuff/.test(ab.class || '')) continue;
      const ms = Array.isArray(ab.modes) && ab.modes.length ? ab.modes : ['Default'];
      if (!ms.every((x) => g.modes.includes(x))) continue;
      for (const u of Array.isArray(ab.uses) ? ab.uses : []) {
        if (!isObj(u) || u.on !== 'owner' || u.role !== 'loop') continue;
        for (const k of Array.isArray(u.keys) ? u.keys : []) {
          const key = lc(k);
          const follow = Number.isInteger(prefabs[key]?.follow) ? prefabs[key].follow : null;
          if (!key || follow == null || g.idle.some((x) => x.key === key)) continue;
          g.idle.push({ key, node: ab.node ?? null, mount: follow });
          if (ab.node) idleNodes.add(ab.node);
        }
      }
    }
  }
  const skills = {};
  for (const [sid, s] of Object.entries(isObj(unit.skills) ? unit.skills : {})) {
    const ab = (Array.isArray(s?.abilities) ? s.abilities : []).find((x) => FUNNEL_SHOT.test(x?.class || ''));
    const pk = lc(ab?.projectileKey);
    if (ab && pk && isObj(projs[pk])) skills[sid] = { mount: mountPointType(ab.mount), projectileKey: pk };
  }
  if (!Object.keys(modes).length && !general.length && !dispersed && !Object.keys(skills).length) return null;
  return { unitKey, modes, general, skills, dispersed, idleNodes };
}

/** Every effect key a plan can play (its units' loops and transitions, hit groups, shots, casts; preloading). */
export function planKeys(plan, projs = {}) {
  const out = new Set();
  const add = (k) => { if (lc(k)) out.add(lc(k)); };
  const proj = (pk) => { const p = pk && projs[pk]; if (p) for (const k of p.effects || []) add(k); };
  if (!plan) return [];
  for (const m of Object.values(plan.modes)) {
    for (const f of m.funnels) {
      for (const k of [f.idle, f.back, f.overload, f.appear, f.disappear]) add(k);
      for (const g of [...f.hits, ...(f.overloadHits || [])]) for (const k of g) add(k);
      proj(f.projectileKey);
    }
    proj(m.body);
  }
  for (const g of plan.general) {
    for (const e of g.cast) add(e.key);
    for (const e of g.idle) add(e.key);
    proj(g.projectileKey);
  }
  for (const s of Object.values(plan.skills)) proj(s.projectileKey);
  const d = plan.dispersed;
  if (d) {
    for (const u of d.units) { add(u.main); for (const g of u.hits) for (const k of g) add(k); proj(u.flight); proj(u.attach); }
    for (const e of d.start) add(e.key);
    add(d.marks.trace); add(d.marks.latched);
  }
  return [...out];
}

/**
 * How many of a mode's `n` units float at home before an attack shows how many attack (FunnelFx counts the hits after
 * that): one, plus a skill's passive "浮游单元+N" (荒芜拉普兰德 S1 被动效果：浮游单元+1 — the skill text, as the sim's kit reads
 * it: the client's buff template is engine code) [ASSUMED]. `srec` = the equipped skill's record.
 */
export function initialCount(srec, n) {
  const desc = typeof srec?.desc === 'string' ? srec.desc : '';
  const m = /被动效果[：:]\s*浮游单元\s*\+\s*(\d+)/.exec(desc);
  const k = 1 + (m ? Number(m[1]) : 0);
  return Math.max(1, Math.min(Math.max(1, n | 0), k));
}
