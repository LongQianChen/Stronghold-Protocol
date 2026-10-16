// DSL numbers use the same official-bounds snapshot as data plugins (DESIGN §32.7).
// [ASSUMED] A DSL field is not an official blackboard key. The table below is the correspondence:
//   mods atkPct / atkFlat → bb atk; defPct / defFlat → bb def; maxHpPct / maxHpFlat / hpFlat → bb max_hp;
//   resPct / resFlat → bb magic_resistance; aspd / attackSpeed → bb attack_speed;
//   any other mod key → bb atk, so a typo cannot carry 1e9;
//   skill.ammo → bb ammo; skill.spCost → field skill.spCost; skill.initSp → field skill.initSp
//   (its own official maximum, not skill.spCost); skill.charges / maxCharges → those fields
//   (vanilla skills do not carry them, so the floor applies);
//   attack.atkScale → bb atk_scale; attack.splashRadius → bb radius; attack.maxTargets and
//   targeting.maxTargets → bb max_target.
// duration, rangeExtend, and action amounts (damage / heal / shield / dp) are not in this table.
// Literal admission runs only after the snapshot is installed. Clamping reads the snapshot at call time
// and uses the floor when it is not installed, so host and page stay on the same numbers.

import { bbCap, fieldCap, officialBbMax, officialFieldMax, officialBoundsReady } from '../../../../shared/plugins/officialBounds.js';

/** @type {Record<string, string>} mod key → blackboard key */
const MOD_BB = Object.freeze({
  atkPct: 'atk',
  atkFlat: 'atk',
  defPct: 'def',
  defFlat: 'def',
  maxHpPct: 'max_hp',
  maxHpFlat: 'max_hp',
  hpFlat: 'max_hp',
  resPct: 'magic_resistance',
  resFlat: 'magic_resistance',
  aspd: 'attack_speed',
  attackSpeed: 'attack_speed',
});

/** Skill scalars that are not mods. duration is intentionally absent. */
/** @type {Readonly<Record<string, { kind: 'bb'|'field', key: string }>>} */
const SKILL_FIELD = Object.freeze({
  ammo: { kind: 'bb', key: 'ammo' },
  spCost: { kind: 'field', key: 'skill.spCost' },
  initSp: { kind: 'field', key: 'skill.initSp' },
  charges: { kind: 'field', key: 'skill.charges' },
  maxCharges: { kind: 'field', key: 'skill.maxCharges' },
});

/** @type {Readonly<Record<string, { kind: 'bb'|'field', key: string }>>} */
const ATTACK_FIELD = Object.freeze({
  atkScale: { kind: 'bb', key: 'atk_scale' },
  splashRadius: { kind: 'bb', key: 'radius' },
  maxTargets: { kind: 'bb', key: 'max_target' },
});

const SKILL_TAIL = /(?:^|\.)(ammo|spCost|initSp|charges|maxCharges)$/;
const MOD_TAIL = /(?:^|\.)mods\.([A-Za-z_][A-Za-z0-9_]*)$/;
const FLAG_TAIL = /(?:^|\.)flags\.([A-Za-z_][A-Za-z0-9_]*)$/;
const ATTACK_TAIL = /(?:^|\.)attack\.(atkScale|splashRadius|maxTargets)$/;
const TARGET_MAX = /(?:^|\.)targeting\.maxTargets$/;

/**
 * The official key a DSL path is admitted and clamped against, or null when the path is not bounded.
 * @param {string} path
 * @returns {{ kind: 'bb'|'field', key: string }|null}
 */
export function dslBoundForPath(path) {
  if (typeof path !== 'string' || !path) return null;
  const mod = MOD_TAIL.exec(path) || FLAG_TAIL.exec(path);
  if (mod) return { kind: 'bb', key: MOD_BB[mod[1]] || 'atk' };
  const attack = ATTACK_TAIL.exec(path);
  if (attack) return ATTACK_FIELD[attack[1]];
  if (TARGET_MAX.test(path)) return ATTACK_FIELD.maxTargets;
  if (path.includes('.mods.') || path.includes('.flags.') || path.includes('.attack.') || path.includes('.onHitStatus.')) return null;
  const skill = SKILL_TAIL.exec(path);
  if (skill) return SKILL_FIELD[skill[1]];
  return null;
}

function capOf(spec) {
  return spec.kind === 'bb' ? bbCap(spec.key) : fieldCap(spec.key);
}

function officialOf(spec) {
  return spec.kind === 'bb' ? officialBbMax(spec.key) : officialFieldMax(spec.key);
}

/**
 * Author-facing PLUGIN_DATA_BOUND text for a direct literal, or null when the snapshot is absent,
 * the path is unbounded, or the value is inside the cap. Nested expression factors are not literals
 * of the field; the compiled result is clamped instead.
 * @param {string} path
 * @param {number} value
 * @returns {string|null}
 */
export function dslLiteralProblem(path, value) {
  if (!officialBoundsReady() || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const spec = dslBoundForPath(path);
  if (!spec) return null;
  const cap = capOf(spec);
  if (Math.abs(value) <= cap) return null;
  const official = officialOf(spec);
  const tail = official != null ? `原版最大 ${official}` : '原版没有这个键';
  const label = spec.kind === 'bb' ? '黑板' : '字段';
  return `DSL 数值 ${path} 对应官方${label} ${spec.key} 的值 ${value} 超过上限 ${cap}（${tail}）`;
}

/**
 * Clamp a resolved DSL number to the path's cap. Unmapped paths and non-finite values pass through.
 * @param {string} path
 * @param {number} n
 */
export function clampDsl(path, n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const spec = dslBoundForPath(path);
  if (!spec) return n;
  const cap = capOf(spec);
  if (Math.abs(n) <= cap) return n;
  return Math.sign(n) * cap;
}
