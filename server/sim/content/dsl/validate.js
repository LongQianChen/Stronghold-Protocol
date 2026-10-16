// server/sim/content/dsl/validate.js — structural check of a P2 DSL spec (DESIGN §32.7).
//
// Returns problems; it does not throw. compileDsl / compileDslMeta throw an Error whose message contains the
// PLUGIN_DSL_* code. The shared catalogue in shared/plugins/errors.js explains every code.
// Explanations are Chinese because the author-facing reference (docs/PLUGIN-DSL.md) is Chinese. They are not
// player-interface strings.

import { TICK } from '../../constants.js';
import { dslLiteralProblem } from './bounds.js';
import {
  TRIGGERS, CONDITIONS, ACTIONS, TARGETS, META_TRIGGERS, META_ACTIONS, VALUE_OPS, SKILL_KINDS, STAT_NAMES,
  PLUGIN_ID_RE,
} from './vocab.js';

export const DSL_CODES = Object.freeze([
  'PLUGIN_DSL_SHAPE',
  'PLUGIN_DSL_VERSION',
  'PLUGIN_DSL_PLUGIN_ID',
  'PLUGIN_DSL_BUDGET',
  'PLUGIN_DSL_LOOP',
  'PLUGIN_DSL_TRIGGER',
  'PLUGIN_DSL_CONDITION',
  'PLUGIN_DSL_ACTION',
  'PLUGIN_DSL_TARGET',
  'PLUGIN_DSL_EVERY',
  'PLUGIN_DSL_NUMBER',
  'PLUGIN_DSL_DIV0',
  'PLUGIN_DSL_VALUE',
  'PLUGIN_DSL_SKILL',
  'PLUGIN_DSL_META',
  'PLUGIN_DSL_TALENT',
]);

const FORBIDDEN = new Set(['loop', 'while', 'for', 'code', 'js', 'eval', 'external', 'script', 'import']);
const VALUE_EXTRA = new Set(['default', 'of']);
// [ASSUMED] a declared budget is a positive integer and at most 1e7.
const BUDGET_MAX = 1e7;
const TIMES_MAX = 8;
// [ASSUMED] The design study caps plugin JSON nesting at 64. Each top-level value expression gets its own
// budget of 64 nodes and 64 levels. Past that, validateDsl returns PLUGIN_DSL_LOOP / PLUGIN_DSL_VALUE instead
// of walking until the stack overflows. The schema does not count this (a workbench that trusts only the schema
// can still accept a deeper expression). A PLUGIN_DSL_* throw at kit setup is a content fault, not a generic kit.
const VALUE_CAP = 64;
const PREP_CONDITIONS = new Set(['round', 'chance', 'bondActive']);
const RADIUS_AT = new Set(['self', 'target', 'source', 'lastSpawn']);
const META_KEY_RE = /^effect:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_\-.:#]+$/;
const LOCAL_KEY_RE = /^[A-Za-z0-9_\-.:#]+$/;
// Closed like schemas/dsl.schema.json. The runtime validator is the data-plugin admission gate.
const TOP_KEYS = new Set(['dsl', 'pluginId', 'budget', 'skill', 'skills', 'talents', 'trait', 'meta']);
const SKILL_KEYS = new Set(['kind', 'id', 'duration', 'ammo', 'spCost', 'initSp', 'charges', 'maxCharges', 'spType', 'trigger', 'heal', 'activateOnDeploy', 'mods', 'flags', 'targeting', 'attack', 'on']);
const TARGET_KEYS = new Set(['rangeGrid', 'priority', 'maxTargets', 'rangeExtend', 'noRangeExtend', 'showOwnRange', 'allInRange']);
const ATTACK_KEYS = new Set(['atkScale', 'splashRadius', 'maxTargets', 'dmgType', 'onHitStatus']);
const TRAIT_KEYS = new Set(['onHitStatus', 'mods']);
const TALENT_KEYS = new Set(['when', 'seconds', 'below', 'cooldown', 'if', 'do']);
const ON_KEYS = new Set(['start', 'end', 'hit', 'attack', 'tick']);
const META_KEYS = new Set(['key', 'on']);
const PREP_ENTRY_KEYS = new Set(['when', 'if', 'do']);
const PREP_BODY_KEYS = Object.freeze({
  funds: new Set(['amount', 'setIncome']),
  layers: new Set(['amount', 'bond']),
  gainItem: new Set(['item']),
});
const ACTION_BODY_KEYS = Object.freeze({
  damage: new Set(['target', 'amount', 'times', 'type', 'isSkill', 'isAttack', 'canDodge', 'tags', 'lose', 'minRemain', 'from', 'then']),
  heal: new Set(['target', 'amount', 'then']),
  sp: new Set(['target', 'amount', 'then']),
  dp: new Set(['target', 'amount', 'fx', 'then']),
  push: new Set(['target', 'force', 'effect', 'then']),
  pull: new Set(['target', 'force', 'then']),
  status: new Set(['target', 'key', 'duration', 'value', 'then']),
  buff: new Set(['target', 'key', 'mods', 'duration', 'persist', 'tags', 'then']),
  fx: new Set(['target', 'kind', 'at', 'radius', 'skill', 'token', 'n', 'dur', 'id', 'then']),
  spawnToken: new Set(['target', 'token', 'tile', 'mem', 'fx', 'stop', 'duration', 'then']),
  layers: new Set(['target', 'amount', 'bond', 'then']),
  shield: new Set(['target', 'key', 'amount', 'hits', 'duration', 'visible', 'then']),
});
// Direct literals are checked against the official snapshot only when the caller asks (the builder and the
// compiler). A scan that has not installed the snapshot stays shape-only, so the floor of 64 is not an admission cap.
let admitBounds = false;

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function rejectUnknown(obj, allowed, path, code, fail, label) {
  const extra = Object.keys(obj).filter((k) => !allowed.has(k) && !FORBIDDEN.has(k));
  if (!extra.length) return;
  const at = path ? `${path}.${extra[0]}` : extra[0];
  fail(code, at, `${label} ${extra.join(', ')}`);
}

/**
 * @param {object} spec
 * @param {{ bounds?: boolean }} [opts] `bounds: true` admits direct literals against the installed official snapshot.
 * @returns {{ ok: boolean, problems: { code: string, path: string, zh: string }[] }}
 */
export function validateDsl(spec, opts = {}) {
  const problems = [];
  const fail = (code, path, zh) => {
    if (problems.length < 40) problems.push({ code, path, zh });
  };
  const prevBounds = admitBounds;
  admitBounds = opts.bounds === true;
  try {
    if (!isObj(spec)) {
      fail('PLUGIN_DSL_SHAPE', '', 'DSL 规格必须是对象');
      return { ok: false, problems };
    }
    if (spec.dsl !== 1) fail('PLUGIN_DSL_VERSION', 'dsl', '只接受 dsl 版本 1');
    if (spec.pluginId != null && (typeof spec.pluginId !== 'string' || !PLUGIN_ID_RE.test(spec.pluginId))) {
      fail('PLUGIN_DSL_PLUGIN_ID', 'pluginId', '插件 id 只能是 1–64 位字母、数字、下划线或连字符');
    }
    if (spec.budget != null && !(Number.isInteger(spec.budget) && spec.budget > 0 && spec.budget <= BUDGET_MAX)) {
      fail('PLUGIN_DSL_BUDGET', 'budget', '动作预算必须是 1 到 10000000 的整数');
    }
    for (const k of Object.keys(spec)) if (FORBIDDEN.has(k)) fail('PLUGIN_DSL_LOOP', k, 'DSL 不接受循环或外部代码');
    rejectUnknown(spec, TOP_KEYS, '', 'PLUGIN_DSL_SHAPE', fail, '未知字段');
    if (spec.skill != null) walkSkill(spec.skill, 'skill', fail);
    if (spec.skills != null) {
      if (!isObj(spec.skills)) fail('PLUGIN_DSL_SKILL', 'skills', 'skills 必须是技能 id 到规格的对象');
      else for (const [id, sk] of Object.entries(spec.skills)) walkSkill(sk, `skills.${id}`, fail);
    }
    if (spec.talents != null) {
      if (!Array.isArray(spec.talents)) fail('PLUGIN_DSL_TALENT', 'talents', 'talents 必须是数组');
      else spec.talents.forEach((t, i) => walkTalent(t, `talents[${i}]`, fail));
    }
    if (spec.trait != null) walkTrait(spec.trait, 'trait', fail);
    if (spec.meta != null) walkMeta(spec.meta, 'meta', fail);
    return { ok: problems.length === 0, problems };
  } finally {
    admitBounds = prevBounds;
  }
}

/**
 * Prep spec for one host plugin. Shape comes from validateDsl; the key must be `effect:<pluginId>:<local>`
 * and meta.on must be a non-empty array. The host repeats this check when it registers the spec.
 * @param {object} spec
 * @param {string} pluginId
 */
export function validatePrepSpec(spec, pluginId) {
  const checked = validateDsl(spec, { bounds: true });
  if (!checked.ok) return checked;
  const problems = [];
  const fail = (code, path, zh) => problems.push({ code, path, zh });
  if (spec.pluginId != null && spec.pluginId !== pluginId) {
    fail('PLUGIN_DSL_PLUGIN_ID', 'pluginId', '规格里的 pluginId 与宿主不一致');
  }
  const key = spec.meta && spec.meta.key;
  const prefix = `effect:${pluginId}:`;
  const local = typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : '';
  if (typeof key !== 'string' || !local || !LOCAL_KEY_RE.test(local) || !META_KEY_RE.test(key)) {
    fail('PLUGIN_DSL_META', 'meta.key', `插件键必须是 effect:${pluginId}:<本地名>`);
  }
  if (!Array.isArray(spec.meta?.on) || spec.meta.on.length < 1) {
    fail('PLUGIN_DSL_META', 'meta.on', '备战 DSL 需要至少一条 meta.on');
  }
  return { ok: problems.length === 0, problems };
}

function walkSkill(sk, path, fail) {
  if (!isObj(sk)) { fail('PLUGIN_DSL_SKILL', path, '技能规格必须是对象'); return; }
  rejectForbidden(sk, path, fail);
  rejectUnknown(sk, SKILL_KEYS, path, 'PLUGIN_DSL_SKILL', fail, '未知技能字段');
  if (sk.kind != null && !SKILL_KINDS.includes(sk.kind)) fail('PLUGIN_DSL_SKILL', `${path}.kind`, `未知技能类型 ${sk.kind}`);
  for (const k of ['duration', 'ammo', 'spCost', 'initSp', 'charges', 'maxCharges']) {
    if (sk[k] != null) walkValue(sk[k], `${path}.${k}`, fail);
  }
  if (sk.mods != null) walkMods(sk.mods, `${path}.mods`, fail);
  if (sk.flags != null) walkMods(sk.flags, `${path}.flags`, fail);
  if (sk.targeting != null) walkTargeting(sk.targeting, `${path}.targeting`, fail);
  if (sk.attack != null) walkAttack(sk.attack, `${path}.attack`, fail);
  if (sk.on != null) {
    if (!isObj(sk.on)) fail('PLUGIN_DSL_SKILL', `${path}.on`, 'on 必须是对象');
    else {
      rejectUnknown(sk.on, ON_KEYS, `${path}.on`, 'PLUGIN_DSL_SKILL', fail, '未知 on 槽');
      for (const slot of ['start', 'end', 'hit', 'attack', 'tick']) {
        if (sk.on[slot] != null) walkActions(sk.on[slot], `${path}.on.${slot}`, fail, 0);
      }
    }
  }
}

function walkTargeting(tg, path, fail) {
  if (!isObj(tg)) { fail('PLUGIN_DSL_SKILL', path, 'targeting 必须是对象'); return; }
  rejectUnknown(tg, TARGET_KEYS, path, 'PLUGIN_DSL_SKILL', fail, '未知 targeting 字段');
  if (tg.rangeGrid != null && tg.rangeGrid !== 'skill' && tg.rangeGrid !== 'own' && !Array.isArray(tg.rangeGrid)) {
    fail('PLUGIN_DSL_SKILL', `${path}.rangeGrid`, 'rangeGrid 只能是 "skill"、"own" 或偏移数组');
  }
  if (tg.maxTargets != null) walkValue(tg.maxTargets, `${path}.maxTargets`, fail);
  if (tg.rangeExtend != null) walkValue(tg.rangeExtend, `${path}.rangeExtend`, fail);
}

function walkAttack(atk, path, fail) {
  if (!isObj(atk)) { fail('PLUGIN_DSL_SKILL', path, 'attack 必须是对象'); return; }
  rejectUnknown(atk, ATTACK_KEYS, path, 'PLUGIN_DSL_SKILL', fail, '未知 attack 字段');
  for (const k of ['atkScale', 'splashRadius', 'maxTargets']) if (atk[k] != null) walkValue(atk[k], `${path}.${k}`, fail);
  if (atk.onHitStatus != null) {
    if (!isObj(atk.onHitStatus) || typeof atk.onHitStatus.key !== 'string') fail('PLUGIN_DSL_SKILL', `${path}.onHitStatus`, 'onHitStatus 需要 key');
    else if (atk.onHitStatus.duration != null) walkValue(atk.onHitStatus.duration, `${path}.onHitStatus.duration`, fail);
  }
}

function walkTrait(tr, path, fail) {
  if (!isObj(tr)) { fail('PLUGIN_DSL_SKILL', path, 'trait 必须是对象'); return; }
  rejectUnknown(tr, TRAIT_KEYS, path, 'PLUGIN_DSL_SKILL', fail, '未知 trait 字段');
  if (tr.onHitStatus != null) {
    if (!isObj(tr.onHitStatus) || typeof tr.onHitStatus.key !== 'string') fail('PLUGIN_DSL_SKILL', `${path}.onHitStatus`, '特性 onHitStatus 需要 key');
    else if (tr.onHitStatus.duration != null) walkValue(tr.onHitStatus.duration, `${path}.onHitStatus.duration`, fail);
  }
  if (tr.mods != null) walkMods(tr.mods, `${path}.mods`, fail);
}

function walkTalent(t, path, fail) {
  if (!isObj(t)) { fail('PLUGIN_DSL_TALENT', path, '天赋必须是对象'); return; }
  rejectForbidden(t, path, fail);
  rejectUnknown(t, TALENT_KEYS, path, 'PLUGIN_DSL_TALENT', fail, '未知天赋字段');
  if (!TRIGGERS.includes(t.when)) fail('PLUGIN_DSL_TRIGGER', `${path}.when`, `未知触发器 ${String(t.when)}`);
  if (t.when === 'every') {
    if (typeof t.seconds !== 'number' || !Number.isFinite(t.seconds) || t.seconds < TICK - 1e-12) {
      fail('PLUGIN_DSL_EVERY', `${path}.seconds`, `every 的秒数必须 ≥ ${TICK}（1/30）`);
    }
  }
  if (t.when === 'hpBelow') {
    if (typeof t.below !== 'number' || !Number.isFinite(t.below) || t.below <= 0 || t.below > 1) {
      fail('PLUGIN_DSL_NUMBER', `${path}.below`, 'hpBelow 的阈值必须是 (0, 1] 里的数');
    }
  }
  if (t.cooldown != null) walkValue(t.cooldown, `${path}.cooldown`, fail);
  if (t.if != null) walkCond(t.if, `${path}.if`, fail);
  if (t.do != null) walkActions(t.do, `${path}.do`, fail, 0);
}

function walkCond(cond, path, fail) {
  if (!isObj(cond)) { fail('PLUGIN_DSL_CONDITION', path, '条件必须是对象'); return; }
  for (const [k, v] of Object.entries(cond)) {
    if (!CONDITIONS.includes(k)) { fail('PLUGIN_DSL_CONDITION', `${path}.${k}`, `未知条件 ${k}`); continue; }
    if (k === 'chance' || k === 'selfHpBelow' || k === 'enemiesInRange') walkValue(v, `${path}.${k}`, fail);
    if (k === 'bondActive' && isObj(v)) {
      const extra = Object.keys(v).filter((x) => x !== 'id' && x !== 'tier');
      if (extra.length) fail('PLUGIN_DSL_CONDITION', `${path}.bondActive.${extra[0]}`, `未知条件字段 ${extra.join(', ')}`);
      if (v.tier != null) walkValue(v.tier, `${path}.bondActive.tier`, fail);
      if (typeof v.id !== 'string' || !v.id) fail('PLUGIN_DSL_CONDITION', `${path}.bondActive.id`, 'bondActive 需要盟约 id');
    }
    if (k === 'targetHas') {
      if (typeof v === 'string') {
        if (!v) fail('PLUGIN_DSL_CONDITION', `${path}.targetHas`, 'targetHas 需要状态名');
      } else if (isObj(v)) {
        const extra = Object.keys(v).filter((x) => x !== 'key');
        if (extra.length || typeof v.key !== 'string' || !v.key) fail('PLUGIN_DSL_CONDITION', `${path}.targetHas`, 'targetHas 只能是状态名或 {key}');
      } else fail('PLUGIN_DSL_CONDITION', `${path}.targetHas`, 'targetHas 只能是状态名或 {key}');
    }
    if (k === 'skillActive' && v != null && typeof v !== 'boolean' && typeof v !== 'string') {
      fail('PLUGIN_DSL_CONDITION', `${path}.skillActive`, 'skillActive 必须是布尔值或技能 id');
    }
  }
}

function walkActions(list, path, fail, depth) {
  if (!Array.isArray(list)) { fail('PLUGIN_DSL_ACTION', path, '动作必须是数组'); return; }
  if (depth > 4) { fail('PLUGIN_DSL_LOOP', path, 'then 嵌套超过 4 层'); return; }
  list.forEach((node, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(node)) { fail('PLUGIN_DSL_ACTION', at, '动作必须是对象'); return; }
    rejectForbidden(node, at, fail);
    const verbs = ACTIONS.filter((k) => Object.prototype.hasOwnProperty.call(node, k));
    const extra = Object.keys(node).filter((k) => k !== 'then' && !ACTIONS.includes(k));
    if (extra.length) fail('PLUGIN_DSL_ACTION', at, `未知动作字段 ${extra.join(', ')}`);
    if (verbs.length !== 1) fail('PLUGIN_DSL_ACTION', at, '每个动作恰好有一个动作名');
    const verb = verbs[0];
    const body = verb ? node[verb] : null;
    if (verb) walkActionBody(verb, body, at + '.' + verb, fail);
    // [ASSUMED] `then` may sit beside the action or inside its body. Both at once is ambiguous.
    if (node.then != null && body && typeof body === 'object' && body.then != null) {
      fail('PLUGIN_DSL_ACTION', at, 'then 只能写在动作旁边或动作参数里的一处');
    } else if (node.then != null) walkActions(node.then, `${at}.then`, fail, depth + 1);
    else if (body && typeof body === 'object' && body.then != null) walkActions(body.then, `${at}.${verb}.then`, fail, depth + 1);
  });
}

function walkActionBody(verb, body, path, fail) {
  if (!isObj(body)) { fail('PLUGIN_DSL_ACTION', path, '动作参数必须是对象'); return; }
  const allowed = ACTION_BODY_KEYS[verb];
  if (allowed) rejectUnknown(body, allowed, path, 'PLUGIN_DSL_ACTION', fail, '未知动作参数');
  if (body.target != null) walkTarget(body.target, `${path}.target`, fail);
  if (verb === 'damage') {
    if (body.amount != null) walkValue(body.amount, `${path}.amount`, fail);
    if (body.times != null && !(Number.isInteger(body.times) && body.times >= 1 && body.times <= TIMES_MAX)) {
      fail('PLUGIN_DSL_NUMBER', `${path}.times`, `times 必须是 1 到 ${TIMES_MAX} 的整数`);
    }
    if (body.minRemain != null) walkValue(body.minRemain, `${path}.minRemain`, fail);
  }
  if (verb === 'heal' || verb === 'sp' || verb === 'dp' || verb === 'shield' || verb === 'layers') {
    if (body.amount != null) walkValue(body.amount, `${path}.amount`, fail);
  }
  if (verb === 'push' || verb === 'pull') {
    if (body.force != null) walkValue(body.force, `${path}.force`, fail);
  }
  if (verb === 'status') {
    if (typeof body.key !== 'string' || !body.key) fail('PLUGIN_DSL_ACTION', `${path}.key`, 'status 需要状态名');
    if (body.duration != null) walkValue(body.duration, `${path}.duration`, fail);
    if (body.value != null) walkValue(body.value, `${path}.value`, fail);
  }
  if (verb === 'buff') {
    if (body.mods != null) walkMods(body.mods, `${path}.mods`, fail);
    if (body.duration != null) walkValue(body.duration, `${path}.duration`, fail);
  }
  if (verb === 'fx') {
    if (typeof body.kind !== 'string' || !body.kind) fail('PLUGIN_DSL_ACTION', `${path}.kind`, 'fx 需要 kind');
    for (const k of ['radius', 'n', 'dur']) if (body[k] != null && typeof body[k] === 'object') walkValue(body[k], `${path}.${k}`, fail);
  }
  if (verb === 'spawnToken') {
    if (body.duration != null) walkValue(body.duration, `${path}.duration`, fail);
    if (body.tile != null && body.tile !== 'around' && !(isObj(body.tile) && Number.isInteger(body.tile.r) && Number.isInteger(body.tile.c))) {
      fail('PLUGIN_DSL_TARGET', `${path}.tile`, 'spawnToken 的 tile 只能是 "around" 或 {r, c}');
    }
  }
  if (verb === 'layers' && body.bond != null && typeof body.bond !== 'string') {
    fail('PLUGIN_DSL_ACTION', `${path}.bond`, 'layers 的 bond 必须是盟约 id');
  }
}

function walkTarget(spec, path, fail) {
  if (typeof spec === 'string') {
    if (!TARGETS.includes(spec)) fail('PLUGIN_DSL_TARGET', path, `未知目标 ${spec}`);
    return;
  }
  if (isObj(spec) && Object.prototype.hasOwnProperty.call(spec, 'enemiesInRadius')) {
    const allowed = new Set(['enemiesInRadius', 'at', 'shape', 'includeStealth']);
    const extra = Object.keys(spec).filter((k) => !allowed.has(k));
    if (extra.length) fail('PLUGIN_DSL_TARGET', path, `未知目标字段 ${extra.join(', ')}`);
    walkValue(spec.enemiesInRadius, path, fail);
    if (spec.at != null && !RADIUS_AT.has(spec.at)) {
      fail('PLUGIN_DSL_TARGET', `${path}.at`, 'enemiesInRadius.at 只能是 self / target / source / lastSpawn');
    }
    if (spec.shape != null && spec.shape !== 'radius' && spec.shape !== 'chebyshev') {
      fail('PLUGIN_DSL_TARGET', `${path}.shape`, 'enemiesInRadius.shape 只能是 radius 或 chebyshev');
    }
    if (spec.includeStealth != null && typeof spec.includeStealth !== 'boolean') {
      fail('PLUGIN_DSL_TARGET', `${path}.includeStealth`, 'includeStealth 必须是布尔值');
    }
    return;
  }
  fail('PLUGIN_DSL_TARGET', path, '目标必须是目标名或 {enemiesInRadius}');
}

function walkMods(mods, path, fail) {
  if (!isObj(mods)) { fail('PLUGIN_DSL_VALUE', path, '数值表必须是对象'); return; }
  for (const [k, v] of Object.entries(mods)) walkValue(v, `${path}.${k}`, fail);
}

function walkValue(expr, path, fail, depth = 1, budget = null) {
  const b = budget || { n: 0 };
  b.n += 1;
  if (depth > VALUE_CAP) { fail('PLUGIN_DSL_LOOP', path, '取值嵌套超过 64 层'); return; }
  if (b.n > VALUE_CAP) { fail('PLUGIN_DSL_VALUE', path, '取值节点超过 64 个'); return; }
  if (typeof expr === 'number') {
    if (!Number.isFinite(expr)) fail('PLUGIN_DSL_NUMBER', path, '数值必须是有限数');
    else if (admitBounds) {
      const zh = dslLiteralProblem(path, expr);
      if (zh) fail('PLUGIN_DATA_BOUND', path, zh);
    }
    return;
  }
  if (typeof expr === 'string' || typeof expr === 'boolean' || expr == null) return;
  if (Array.isArray(expr)) { fail('PLUGIN_DSL_VALUE', path, '数值不能是数组（除非写在 mul/add/min/max/sub/div 里）'); return; }
  if (!isObj(expr)) { fail('PLUGIN_DSL_VALUE', path, '无法识别的数值'); return; }
  const keys = Object.keys(expr).filter((k) => !VALUE_EXTRA.has(k));
  if (!keys.length) { fail('PLUGIN_DSL_VALUE', path, '数值表达式是空的'); return; }
  for (const k of keys) {
    if (FORBIDDEN.has(k)) fail('PLUGIN_DSL_LOOP', `${path}.${k}`, 'DSL 不接受循环或外部代码');
  }
  const ops = keys.filter((k) => VALUE_OPS.includes(k));
  const unknown = keys.filter((k) => !VALUE_OPS.includes(k) && !FORBIDDEN.has(k));
  for (const k of unknown) fail('PLUGIN_DSL_VALUE', `${path}.${k}`, `未知取值运算 ${k}`);
  // [ASSUMED] One value object is exactly one operation. Runtime still reads the first key; validate rejects
  // `{ bb, mul }` so that reading is not a silent choice. Do not walk both sides.
  if (ops.length !== 1 || unknown.length || keys.length !== 1) {
    if (ops.length !== 1) fail('PLUGIN_DSL_VALUE', path, '取值对象恰好一个运算');
    return;
  }
  const k = ops[0];
  if (k === 'bb' && typeof expr.bb !== 'string') fail('PLUGIN_DSL_VALUE', `${path}.bb`, 'bb 必须是黑板键名');
  if (k === 'talent') {
    const p = expr.talent;
    if (!Array.isArray(p) || p.length < 2 || !Number.isInteger(p[0]) || p[0] < 0 || typeof p[1] !== 'string') {
      fail('PLUGIN_DSL_VALUE', `${path}.talent`, 'talent 必须是 [序号, 键名]');
    }
  }
  if (k === 'trait' && typeof expr.trait !== 'string') fail('PLUGIN_DSL_VALUE', `${path}.trait`, 'trait 必须是键名');
  if (k === 'stat') {
    if (!STAT_NAMES.includes(expr.stat)) fail('PLUGIN_DSL_VALUE', `${path}.stat`, `未知属性 ${String(expr.stat)}`);
    if (expr.of != null && !RADIUS_AT.has(expr.of)) {
      fail('PLUGIN_DSL_VALUE', `${path}.of`, 'stat.of 只能是 self / target / source / lastSpawn');
    }
  }
  if (k === 'batMod') {
    walkValue(expr.batMod, `${path}.batMod`, fail, depth + 1, b);
    return;
  }
  if (k === 'mul' || k === 'add' || k === 'sub' || k === 'div' || k === 'min' || k === 'max') {
    const xs = expr[k];
    if (!Array.isArray(xs) || !xs.length) fail('PLUGIN_DSL_VALUE', `${path}.${k}`, `${k} 必须是非空数组`);
    else {
      for (let i = 0; i < xs.length; i++) {
        walkValue(xs[i], `${path}.${k}[${i}]`, fail, depth + 1, b);
        if (b.n > VALUE_CAP || depth + 1 > VALUE_CAP) return;
      }
      if (k === 'div') literalDiv0(xs, `${path}.div`, fail);
    }
  }
}

function literalDiv0(xs, path, fail) {
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    if (typeof x === 'number' && x === 0) fail('PLUGIN_DSL_DIV0', path, '除数不能是 0');
  }
}

function walkMeta(meta, path, fail) {
  if (!isObj(meta)) { fail('PLUGIN_DSL_META', path, 'meta 必须是对象'); return; }
  rejectUnknown(meta, META_KEYS, path, 'PLUGIN_DSL_META', fail, '未知 meta 字段');
  // Shape only. Whether the id segment is this plugin's host id is validatePrepSpec / registerDslMeta.
  if (meta.key != null && (typeof meta.key !== 'string' || !META_KEY_RE.test(meta.key))) {
    fail('PLUGIN_DSL_META', `${path}.key`, '插件键只接受 effect:<插件 id>:<本地名>');
  }
  if (meta.on != null && !Array.isArray(meta.on)) { fail('PLUGIN_DSL_META', `${path}.on`, 'meta.on 必须是数组'); return; }
  (meta.on || []).forEach((e, i) => {
    const at = `${path}.on[${i}]`;
    if (!isObj(e)) { fail('PLUGIN_DSL_META', at, '备战条目必须是对象'); return; }
    rejectUnknown(e, PREP_ENTRY_KEYS, at, 'PLUGIN_DSL_META', fail, '未知备战字段');
    if (!META_TRIGGERS.includes(e.when)) fail('PLUGIN_DSL_TRIGGER', `${at}.when`, `未知备战触发器 ${String(e.when)}`);
    if (e.if != null) walkPrepCond(e.if, `${at}.if`, fail);
    if (e.do != null) {
      if (!Array.isArray(e.do)) fail('PLUGIN_DSL_ACTION', `${at}.do`, '备战动作必须是数组');
      else e.do.forEach((a, j) => walkPrepAction(a, `${at}.do[${j}]`, fail));
    }
  });
}

function walkPrepCond(cond, path, fail) {
  if (!isObj(cond)) { fail('PLUGIN_DSL_CONDITION', path, '备战条件必须是对象'); return; }
  for (const k of Object.keys(cond)) {
    // [ASSUMED] Prep may use round, chance and bondActive. A condition that needs a unit is an error here,
    // not a silent false (selfHpBelow / enemiesInRange / skillActive / targetHas, and anything else unknown).
    if (!PREP_CONDITIONS.has(k)) {
      const zh = CONDITIONS.includes(k)
        ? `备战条件不能用这一条（${k}）`
        : `未知备战条件 ${k}`;
      fail('PLUGIN_DSL_CONDITION', `${path}.${k}`, zh);
    }
  }
  if (cond.round != null && !(typeof cond.round === 'number' && Number.isInteger(cond.round))) {
    fail('PLUGIN_DSL_NUMBER', `${path}.round`, 'round 必须是整数');
  }
  if (cond.chance != null) walkValue(cond.chance, `${path}.chance`, fail);
  if (cond.bondActive != null) {
    const v = cond.bondActive;
    if (typeof v === 'string') {
      if (!v) fail('PLUGIN_DSL_CONDITION', `${path}.bondActive`, 'bondActive 需要盟约 id');
    } else if (isObj(v)) {
      if (v.tier != null) walkValue(v.tier, `${path}.bondActive.tier`, fail);
      if (typeof v.id !== 'string' || !v.id) fail('PLUGIN_DSL_CONDITION', `${path}.bondActive.id`, 'bondActive 需要盟约 id');
    } else fail('PLUGIN_DSL_CONDITION', `${path}.bondActive`, 'bondActive 需要盟约 id');
  }
}

function walkPrepAction(node, path, fail) {
  if (!isObj(node)) { fail('PLUGIN_DSL_ACTION', path, '备战动作必须是对象'); return; }
  const extra = Object.keys(node).filter((k) => !META_ACTIONS.includes(k));
  if (extra.length) fail('PLUGIN_DSL_ACTION', path, `未知备战字段 ${extra.join(', ')}`);
  const verbs = META_ACTIONS.filter((k) => Object.prototype.hasOwnProperty.call(node, k));
  if (verbs.length !== 1) fail('PLUGIN_DSL_ACTION', path, '备战动作只能是 funds、layers 或 gainItem');
  const verb = verbs[0];
  const body = verb ? node[verb] : null;
  if (!verb) return;
  if (!isObj(body)) { fail('PLUGIN_DSL_ACTION', `${path}.${verb}`, '备战动作的参数必须是对象'); return; }
  rejectUnknown(body, PREP_BODY_KEYS[verb], `${path}.${verb}`, 'PLUGIN_DSL_ACTION', fail, '未知备战参数');
  if (verb === 'funds' || verb === 'layers') {
    if (body.amount != null) walkValue(body.amount, `${path}.amount`, fail);
  }
  if (verb === 'layers' && typeof body.bond !== 'string') fail('PLUGIN_DSL_ACTION', `${path}.bond`, 'layers 需要盟约 id');
  if (verb === 'gainItem' && typeof body.item !== 'string') fail('PLUGIN_DSL_ACTION', `${path}.item`, 'gainItem 需要物品 id');
  if (verb === 'funds' && body.setIncome != null && typeof body.setIncome !== 'boolean') {
    fail('PLUGIN_DSL_ACTION', `${path}.setIncome`, 'setIncome 必须是布尔值');
  }
}

function rejectForbidden(obj, path, fail) {
  for (const k of Object.keys(obj)) if (FORBIDDEN.has(k)) fail('PLUGIN_DSL_LOOP', `${path}.${k}`, 'DSL 不接受循环或外部代码');
}

export function formatProblems(problems) {
  return (problems || []).map((p) => `${p.code} ${p.path}: ${p.zh}`).join('; ');
}
