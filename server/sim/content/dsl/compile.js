// server/sim/content/dsl/compile.js — compile a P2 DSL spec into a Kit (DESIGN §32.7).
//
// C2: compileDsl(spec, { bb, chess, def }) → Kit, the same shape a kit function returns. kitOf dispatches
// def.raw.dsl to this compiler. Tests call
// compileDsl directly and inject the kit with makeBattle({ kits }). This file does not edit kitOf.
//
// Values inside SkillSpec fields (mods, ammo, attack, targeting) are resolved when the kit is built, because the
// engine stores those numbers on the spec. Action lists resolve again when they fire, so {stat} sees the live unit.
// Omitting duration / spCost / initSp keeps the chess record's values. Omitting ammo does not: the engine reads
// `+spec.ammo || 0`, so an ammo skill must set ammo.

import { num } from '../kits/shared/tier1.js';
import { validateDsl, formatProblems } from './validate.js';
import { clampDsl } from './bounds.js';
import {
  resolveValue, resolveMods, skillCallback, installTrigger, DEFAULT_BUDGET, PLUGIN_ID_RE,
} from './vocab.js';

export { DEFAULT_BUDGET };

/**
 * The host's plugin id wins. [ASSUMED] `opts.pluginId` and `opts.def.raw.pluginId` are the trusted sources
 * (the content set writes the second). The author's `spec.pluginId` cannot override either. If both trusted
 * sources are set and differ, or the author id differs from the host, or no host id was given, compilation
 * stops with PLUGIN_DSL_PLUGIN_ID. There is no shared `"dsl"` bucket: omitting the id must not put every
 * spec on one budget slot.
 * @param {object} spec
 * @param {{ pluginId?: string, def?: { raw?: { pluginId?: string } } }} [opts]
 * @returns {{ ok: true, pluginId: string } | { ok: false, zh: string }}
 */
export function hostPluginId(spec, opts) {
  const optId = opts && typeof opts.pluginId === 'string' ? opts.pluginId : '';
  const raw = opts && opts.def && opts.def.raw;
  const defId = raw && typeof raw.pluginId === 'string' ? raw.pluginId : '';
  if (optId && defId && optId !== defId) return { ok: false, zh: '宿主 pluginId 与内容组合写入的 pluginId 不一致' };
  const host = optId || defId;
  if (!host || !PLUGIN_ID_RE.test(host)) {
    return { ok: false, zh: '编译需要宿主给出的插件 id，不能省略，也不能默认合成共用的 dsl' };
  }
  if (spec && spec.pluginId != null && spec.pluginId !== host) {
    return { ok: false, zh: '规格里的 pluginId 与宿主不一致，不能用来占用别的插件的预算' };
  }
  return { ok: true, pluginId: host };
}

function throwHost(host) {
  const err = new Error('PLUGIN_DSL_PLUGIN_ID pluginId: ' + host.zh);
  err.code = 'PLUGIN_DSL_PLUGIN_ID';
  throw err;
}

function rangeGridOf(v, env) {
  if (v === 'skill') return env.def && env.def.skill ? env.def.skill.rangeGrid ?? null : null;
  if (v === 'own') return env.def ? env.def.rangeGrid ?? null : null;
  if (Array.isArray(v)) return v;
  return null;
}

function baked(path, value, env) {
  const n = typeof value === 'number' ? value : resolveValue(value, env, null);
  return clampDsl(path, n);
}

function compileTargeting(tg, env) {
  if (!tg || typeof tg !== 'object') return null;
  const out = {};
  if (tg.rangeGrid != null) {
    const g = rangeGridOf(tg.rangeGrid, env);
    if (g) out.rangeGrid = g;
  }
  if (typeof tg.priority === 'string') out.priority = tg.priority;
  if (tg.maxTargets != null) out.maxTargets = baked('skill.targeting.maxTargets', tg.maxTargets, env);
  if (tg.rangeExtend != null) out.rangeExtend = resolveValue(tg.rangeExtend, env, null);
  if (tg.noRangeExtend) out.noRangeExtend = true;
  if (tg.showOwnRange) out.showOwnRange = true;
  if (tg.allInRange) out.allInRange = true;
  return Object.keys(out).length ? out : null;
}

function compileAttack(atk, env) {
  if (!atk || typeof atk !== 'object') return null;
  const out = {};
  for (const k of ['atkScale', 'splashRadius', 'maxTargets']) {
    if (atk[k] != null) out[k] = baked(`skill.attack.${k}`, atk[k], env);
  }
  if (typeof atk.dmgType === 'string') out.dmgType = atk.dmgType;
  if (atk.onHitStatus && typeof atk.onHitStatus === 'object') {
    out.onHitStatus = {
      key: atk.onHitStatus.key,
      duration: atk.onHitStatus.duration != null ? resolveValue(atk.onHitStatus.duration, env, null) : undefined,
    };
  }
  return Object.keys(out).length ? out : null;
}

function compileSkill(sk, env) {
  const spec = {};
  if (sk.kind) spec.kind = sk.kind;
  if (typeof sk.id === 'string') spec.id = sk.id;
  for (const k of ['duration', 'ammo', 'spCost', 'initSp']) {
    if (sk[k] != null) spec[k] = baked(`skill.${k}`, sk[k], env);
  }
  if (sk.charges != null) spec.charges = baked('skill.charges', sk.charges, env);
  if (sk.maxCharges != null) spec.maxCharges = baked('skill.maxCharges', sk.maxCharges, env);
  if (typeof sk.spType === 'string') spec.spType = sk.spType;
  if (sk.trigger != null) spec.trigger = sk.trigger;
  if (sk.heal != null) spec.heal = !!sk.heal;
  if (sk.activateOnDeploy) spec.activateOnDeploy = true;
  if (sk.mods) spec.mods = resolveMods(sk.mods, env, null);
  if (sk.flags) {
    const flags = {};
    for (const [k, v] of Object.entries(sk.flags)) flags[k] = typeof v === 'boolean' ? v : !!resolveValue(v, env, null);
    spec.flags = flags;
  }
  const tg = compileTargeting(sk.targeting, env);
  if (tg) spec.targeting = tg;
  const attack = compileAttack(sk.attack, env);
  if (attack) spec.attack = attack;
  const on = sk.on || null;
  if (on && Array.isArray(on.start)) spec.onStart = skillCallback(on.start, env);
  if (on && Array.isArray(on.end)) spec.onEnd = skillCallback(on.end, env);
  if (on && Array.isArray(on.hit)) spec.onHit = skillCallback(on.hit, env);
  if (on && Array.isArray(on.attack)) spec.onAttack = skillCallback(on.attack, env);
  if (on && Array.isArray(on.tick)) spec.onTick = skillCallback(on.tick, env);
  return spec;
}

function compileTrait(tr, env) {
  const out = {};
  if (tr.onHitStatus && typeof tr.onHitStatus === 'object') {
    out.onHitStatus = {
      key: tr.onHitStatus.key,
      duration: tr.onHitStatus.duration != null ? resolveValue(tr.onHitStatus.duration, env, null) : undefined,
    };
  }
  if (tr.mods) out.mods = resolveMods(tr.mods, env, null);
  return Object.keys(out).length ? out : null;
}

/**
 * Compile `spec` into a Kit. Throws when validateDsl reports a problem; the message includes the PLUGIN_DSL_* code.
 * @param {object} spec
 * @param {{ bb?: object, chess?: object, def?: object, pluginId?: string }} [opts]
 * @returns {object} Kit
 */
export function compileDsl(spec, opts = {}) {
  const checked = validateDsl(spec, { bounds: true });
  if (!checked.ok) {
    const err = new Error(formatProblems(checked.problems));
    err.code = checked.problems[0] && checked.problems[0].code;
    throw err;
  }
  // Structural codes win over a missing host id, so compileDsl(badSpec, {}) still throws the shape error.
  const host = hostPluginId(spec, opts);
  if (!host.ok) throwHost(host);
  const env = {
    bb: opts.bb || {},
    chess: opts.chess || null,
    def: opts.def || null,
    pluginId: host.pluginId,
    // [ASSUMED] default 8000, overridable by spec.budget.
    budget: spec.budget != null ? spec.budget : DEFAULT_BUDGET,
    spec,
  };
  const kit = {};
  const skills = {};
  if (spec.skills && typeof spec.skills === 'object') {
    for (const [id, sk] of Object.entries(spec.skills)) skills[id] = compileSkill(sk, env);
  }
  if (Object.keys(skills).length) kit.skills = skills;
  if (spec.skill && typeof spec.skill === 'object') kit.skill = compileSkill(spec.skill, env);
  else if (skills.default) {
    kit.skill = skills.default;
    delete skills.default;
    if (!Object.keys(skills).length) delete kit.skills;
  }
  if (Array.isArray(spec.talents) && spec.talents.length) {
    kit.talents = spec.talents.map((talent) => ({
      install(battle, unit) { installTrigger(talent, battle, unit, env); },
    }));
  }
  if (spec.trait) {
    const trait = compileTrait(spec.trait, env);
    if (trait) kit.trait = trait;
  }
  // Touch num so a numeric blackboard string still follows the kit helper if a caller resolves ahead of us.
  void num;
  return kit;
}
