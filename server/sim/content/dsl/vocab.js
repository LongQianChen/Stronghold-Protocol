// server/sim/content/dsl/vocab.js — closed vocabulary of the P2 DSL (DESIGN §32.7, docs/PLUGIN-DSL.md).
//
// Triggers, conditions, actions, targets and value expressions. No loops and no state outside the battle:
// cooldown and the hpBelow latch live in the handler closure installed on that unit. Every action goes through
// a SIM.md §6 helper. Damage dealt here carries a `dsl` tag; a DSL `hitDealt` handler ignores that tag so a
// plugin cannot re-enter on its own output (SIM.md §5).

import { TICK } from '../../constants.js';
import {
  num, talentBb, traitBb, batMod, enemiesInGrid, byEnemyAttack, giveSp, freeTileAround,
  summonTileFree, cheb,
} from '../kits/shared/tier1.js';
import { enemyStealthed } from '../../targeting.js';
import { charge, trackTimer, DEFAULT_BUDGET } from './budget.js';
import { clampDsl } from './bounds.js';

export { TICK, DEFAULT_BUDGET };

export const TRIGGERS = Object.freeze([
  'always', 'deploy', 'battleStart', 'attack', 'hitDealt', 'hitTaken', 'kill', 'allyDeath',
  'skillStart', 'skillEnd', 'every', 'hpBelow',
]);

export const CONDITIONS = Object.freeze([
  'chance', 'targetHas', 'selfHpBelow', 'enemiesInRange', 'bondActive', 'skillActive',
]);

export const ACTIONS = Object.freeze([
  'buff', 'status', 'damage', 'heal', 'sp', 'dp', 'push', 'pull', 'spawnToken', 'layers', 'shield', 'fx',
]);

export const TARGETS = Object.freeze([
  'self', 'target', 'source', 'alliesInRange', 'enemiesInRange', 'enemiesInRadius', 'lowestHpAlly', 'allAllies',
]);

export const META_TRIGGERS = Object.freeze([
  'roundStart', 'income', 'buy', 'sell', 'refresh', 'merge', 'levelUp', 'battleResult',
]);

export const META_ACTIONS = Object.freeze(['funds', 'layers', 'gainItem']);

export const VALUE_OPS = Object.freeze([
  'bb', 'talent', 'trait', 'stat', 'batMod', 'mul', 'add', 'sub', 'div', 'min', 'max',
]);

export const SKILL_KINDS = Object.freeze(['instant', 'duration', 'ammo', 'charges', 'toggle', 'passive']);

export const STAT_NAMES = Object.freeze(['atk', 'maxHp', 'hp', 'def', 'res']);

const THEN_MAX_DEPTH = 4;
// [ASSUMED] `times` on a damage action is a fixed repeat of that one node (1..8), not a DSL loop.
const TIMES_MAX = 8;

export const PLUGIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function list(v) {
  return Array.isArray(v) ? v : (v == null ? [] : [v]);
}

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Resolve a value expression.
 * Numbers pass through. `{bb}`, `{talent:[i,key]}` and `{trait}` read the chess at kit-build time (the same
 * blackboards a kit function sees). `{stat}` reads the live unit. `{mul|add|sub|div|min|max}` nest; only + − × ÷.
 * [ASSUMED] `{sub}` and `{div}` are the minus and divide forms (the design names add/mul/min/max and also − and ÷).
 * [ASSUMED] a non-finite number becomes 0. Division by 0 becomes 0 at runtime (the validator rejects a literal 0).
 * [ASSUMED] `{batMod}` applies kits/shared/tier1.js batMod, using the selected skill's description, because a raw
 * `base_attack_time` is a flat seconds change and not an engine batPct.
 * [ASSUMED] `{stat, of}` reads `self` (default), `target`, `source` or `lastSpawn`.
 */
export function resolveValue(expr, env, rt = null) {
  if (typeof expr === 'number') return finite(expr) ? expr : 0;
  if (typeof expr === 'boolean') return expr ? 1 : 0;
  if (expr == null) return 0;
  if (typeof expr === 'string') return num(expr, 0);
  if (typeof expr !== 'object' || Array.isArray(expr)) return 0;
  const bb = env && env.bb;
  const chess = env && env.chess;
  if (Object.prototype.hasOwnProperty.call(expr, 'bb')) return num(bb && bb[expr.bb], num(expr.default, 0));
  if (Object.prototype.hasOwnProperty.call(expr, 'talent')) {
    const pair = expr.talent;
    const i = Array.isArray(pair) ? pair[0] : 0;
    const key = Array.isArray(pair) ? pair[1] : null;
    return num(key != null ? talentBb(chess, i)[key] : undefined, num(expr.default, 0));
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'trait')) return num(traitBb(chess)[expr.trait], num(expr.default, 0));
  if (Object.prototype.hasOwnProperty.call(expr, 'stat')) return readStat(expr, rt);
  if (Object.prototype.hasOwnProperty.call(expr, 'batMod')) {
    const desc = (env && env.def && env.def.skill && env.def.skill.description) ?? (chess && chess.skill && chess.skill.desc) ?? '';
    return batMod(resolveValue(expr.batMod, env, rt), chess, desc);
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'mul')) {
    let a = 1;
    for (const x of list(expr.mul)) a *= resolveValue(x, env, rt);
    return finite(a) ? a : 0;
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'add')) {
    let a = 0;
    for (const x of list(expr.add)) a += resolveValue(x, env, rt);
    return finite(a) ? a : 0;
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'sub')) {
    const xs = list(expr.sub).map((x) => resolveValue(x, env, rt));
    let a = xs.length ? xs[0] : 0;
    for (let i = 1; i < xs.length; i++) a -= xs[i];
    return finite(a) ? a : 0;
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'div')) {
    const xs = list(expr.div).map((x) => resolveValue(x, env, rt));
    let a = xs.length ? xs[0] : 0;
    for (let i = 1; i < xs.length; i++) {
      const d = xs[i];
      if (!finite(d) || d === 0) return 0;
      a /= d;
    }
    return finite(a) ? a : 0;
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'min')) {
    const xs = list(expr.min).map((x) => resolveValue(x, env, rt)).filter(finite);
    return xs.length ? Math.min(...xs) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(expr, 'max')) {
    const xs = list(expr.max).map((x) => resolveValue(x, env, rt)).filter(finite);
    return xs.length ? Math.max(...xs) : 0;
  }
  return 0;
}

function unitOf(of, rt) {
  if (!rt) return null;
  if (of === 'lastSpawn') return rt.lastSpawn || null;
  if (of === 'target') return rt.target || null;
  if (of === 'source') return rt.source || null;
  return rt.unit || null;
}

function readStat(expr, rt) {
  const u = unitOf(expr.of, rt);
  if (!u) return 0;
  const s = u.s || {};
  switch (expr.stat) {
    case 'atk': return num(s.atk, 0);
    case 'maxHp': return num(s.maxHp, 0);
    case 'hp': return num(u.hp, 0);
    case 'def': return num(s.def, 0);
    case 'res': return num(s.res, 0);
    default: return 0;
  }
}

/** Resolve a plain mod / flag map. Objects are value expressions; numbers pass through, then the DSL cap. */
export function resolveMods(mods, env, rt = null) {
  const out = {};
  if (!mods || typeof mods !== 'object') return out;
  for (const [k, v] of Object.entries(mods)) {
    const n = typeof v === 'number' ? v : resolveValue(v, env, rt);
    // Action-time buffs resolve here, after compile. The same clamp as compile.js (DESIGN §32.7).
    if (finite(n)) out[k] = clampDsl(`mods.${k}`, n);
  }
  return out;
}

/**
 * Conditions are AND. [ASSUMED] structural checks run before `chance`, so a failed check does not draw rng.
 * A failed chance draws and does not spend action budget (budget counts actions only).
 */
export function evalCond(cond, rt) {
  if (cond == null) return true;
  if (typeof cond !== 'object') return !!cond;
  for (const key of Object.keys(cond)) {
    if (key === 'chance') continue;
    if (!evalOne(key, cond[key], rt)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(cond, 'chance')) {
    const p = resolveValue(cond.chance, rt.env, rt);
    const rng = rt.battle && rt.battle.rng;
    if (!rng || typeof rng.chance !== 'function') return false;
    return !!rng.chance(p);
  }
  return true;
}

function evalOne(key, value, rt) {
  const unit = rt.unit;
  if (key === 'targetHas') {
    const name = typeof value === 'string' ? value : value && value.key;
    return hasMark(rt.target, name);
  }
  if (key === 'selfHpBelow') {
    const n = resolveValue(value, rt.env, rt);
    return !!unit && unit.hpRatio < n;
  }
  if (key === 'enemiesInRange') {
    const n = resolveValue(value, rt.env, rt);
    return enemiesInGrid(rt.battle, unit, null).length >= n;
  }
  if (key === 'bondActive') {
    const id = typeof value === 'string' ? value : value && value.id;
    const tier = value && typeof value === 'object' && value.tier != null ? resolveValue(value.tier, rt.env, rt) : null;
    const b = bondOf(rt, id);
    if (!b || !b.active) return false;
    return tier == null || num(b.tier, 0) >= tier;
  }
  if (key === 'skillActive') {
    const sk = unit && unit.skill;
    if (!sk || !sk.active) return false;
    if (value === true) return true;
    if (typeof value === 'string') return sk.id === value;
    return false;
  }
  return false;
}

function hasMark(u, key) {
  if (!u || typeof key !== 'string' || !key) return false;
  if (u.s && u.s.flags && u.s.flags[key]) return true;
  if (typeof u.findBuff === 'function' && u.findBuff(key)) return true;
  return false;
}

function bondOf(rt, id) {
  if (!id || !rt.battle || !rt.unit) return null;
  const ps = rt.battle.getPlayer(rt.unit.ownerId);
  return ps && ps.bonds ? ps.bonds[id] || null : null;
}

/**
 * [ASSUMED] `enemiesInRange` is enemiesInGrid on the unit's current range (the engine has already switched a skill
 * range in before onStart when the spec sets targeting.rangeGrid). `enemiesInRadius` defaults to foesInRadius from
 * the operator (skill-selectable: no untargetable, no unrevealed stealth), so a circle that omits `at` / `shape` /
 * `includeStealth` stays the old hit. `at` moves the centre (`self` / `target` / `source` / `lastSpawn`); a missing
 * `lastSpawn` selects nobody, it does not fall back to the operator. `shape: "chebyshev"` or `includeStealth: true`
 * scans `battle.enemies` in that order and skips `!alive`, `hidden` and `untargetable`. Stealth is skipped via
 * enemyStealthed unless `includeStealth`. Chebyshev uses `cheb` (≤ r). The other shape is euclidean on the centre.
 * [ASSUMED] `allAllies` is alliesFor(unit, unit.ownerId): the same owner only, including on a unite field.
 * `lowestHpAlly` is lowestHpAllyInRange (injured allies only). `target` is the hook target, or the victim of a kill.
 * `source` is the hook source, the killer, or the attacker.
 */
export function resolveTargets(spec, rt) {
  const unit = rt.unit;
  const battle = rt.battle;
  if (spec == null || spec === 'self') return unit ? [unit] : [];
  if (spec === 'target') return rt.target ? [rt.target] : [];
  if (spec === 'source') return rt.source ? [rt.source] : [];
  if (spec === 'alliesInRange') return battle.alliesInGrid(unit);
  if (spec === 'enemiesInRange') return enemiesInGrid(battle, unit, null);
  if (spec === 'lowestHpAlly') {
    const a = battle.lowestHpAllyInRange(unit);
    return a ? [a] : [];
  }
  if (spec === 'allAllies') return battle.alliesFor(unit, unit && unit.ownerId);
  if (spec && typeof spec === 'object' && Object.prototype.hasOwnProperty.call(spec, 'enemiesInRadius')) {
    const r = resolveValue(spec.enemiesInRadius, rt.env, rt);
    const at = spec.at || 'self';
    const anchor = at === 'self' ? unit : anchorOf(at, rt);
    if (!anchor || !finite(anchor.x) || !finite(anchor.y)) return [];
    const chebyshev = spec.shape === 'chebyshev';
    const stealth = spec.includeStealth === true;
    if (!chebyshev && !stealth) return battle.foesInRadius(anchor.x, anchor.y, r);
    const out = [];
    const r2 = r * r + 1e-9;
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden) continue;
      const f = (e.s && e.s.flags) || {};
      if (f.untargetable) continue;
      if (!stealth && f.stealth && enemyStealthed(e)) continue;
      if (chebyshev) {
        if (cheb(anchor, e) > r) continue;
      } else {
        const dx = e.x - anchor.x;
        const dy = e.y - anchor.y;
        if (dx * dx + dy * dy > r2) continue;
      }
      out.push(e);
    }
    return out;
  }
  return [];
}

function anchorOf(at, rt) {
  if (at === 'lastSpawn') return rt.lastSpawn || null;
  if (at === 'target') return rt.target || null;
  if (at === 'source') return rt.source || null;
  return rt.unit || null;
}

function doFx(body, rt) {
  const anchor = anchorOf(body.at, rt);
  if (!anchor || !finite(anchor.x) || !finite(anchor.y)) return;
  const extra = {};
  if (body.id !== false) extra.id = anchor.id;
  for (const k of ['radius', 'skill', 'token', 'n', 'dur']) {
    if (body[k] == null) continue;
    extra[k] = typeof body[k] === 'object' ? resolveValue(body[k], rt.env, rt) : body[k];
  }
  rt.battle.fx(body.kind, { x: anchor.x, y: anchor.y, ...extra });
}

function tokenIdOf(body, env) {
  const t = body.token;
  if (typeof t === 'string') return t;
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id === 'string') return t.id;
  if (t.override) {
    const ov = env.chess && env.chess.skill && env.chess.skill.overrideTokenKey;
    if (typeof ov === 'string' && ov) return ov;
    const needles = Array.isArray(t.match) ? t.match : [];
    const found = (env.chess && env.chess.tokens || []).find((x) => needles.some((n) => String(x).includes(String(n))));
    if (found) return found;
    return typeof t.fallback === 'string' ? t.fallback : null;
  }
  return typeof t.fallback === 'string' ? t.fallback : null;
}

function tileOf(body, rt) {
  const battle = rt.battle;
  const unit = rt.unit;
  const tile = body.tile;
  if (tile === 'around') return freeTileAround(battle, unit, (r, c) => battle.grid.canStand(r, c));
  // [ASSUMED] An absolute {r,c} must be inside the rect, not reserved, and standable (summonTileFree + canStand).
  // A failure returns null; spawnToken then halts the rest of the list only when stop is true. The coordinate is
  // not limited to the owner's half: a standable road on the other half of a unite field is still accepted.
  if (tile && typeof tile === 'object' && Number.isInteger(tile.r) && Number.isInteger(tile.c)) {
    if (!summonTileFree(battle, tile.r, tile.c) || !battle.grid.canStand(tile.r, tile.c)) return null;
    return [tile.r, tile.c];
  }
  return null;
}

function damageSource(body, rt) {
  if (body.from === 'lastSpawn') return rt.lastSpawn || null;
  if (body.from === 'source') return rt.source || rt.unit;
  return rt.unit;
}

function doDamage(body, target, rt) {
  const src = damageSource(body, rt);
  if (!src || !target) return;
  const env = rt.env;
  const amount = resolveValue(body.amount, env, rt);
  if (!(amount > 0) || !finite(amount)) return;
  const tags = Array.isArray(body.tags) ? body.tags.slice() : [];
  if (!tags.includes('dsl')) tags.push('dsl');
  if (body.lose) {
    // [ASSUMED] `lose: true` calls battle.loseHp (流失). `minRemain` skips the loss when it would leave HP below
    // that remainder (风丸 pays half her current HP only while at least 1 remains). The dsl tag is still applied.
    const remain = body.minRemain != null ? resolveValue(body.minRemain, env, rt) : null;
    if (remain != null && target.hp - amount < remain) return;
    rt.battle.loseHp(target, amount, { source: src, tags: tags.slice() });
    return;
  }
  const times = Math.max(1, Math.min(TIMES_MAX, Math.floor(body.times ?? 1)));
  for (let i = 0; i < times && target.alive; i++) {
    const dmg = {
      amount: resolveValue(body.amount, env, rt),
      type: body.type || 'phys',
      isSkill: !!body.isSkill,
      tags: tags.slice(),
    };
    if (body.canDodge != null) dmg.canDodge = !!body.canDodge;
    if (body.isAttack != null) dmg.isAttack = !!body.isAttack;
    rt.battle.dealDamage(src, target, dmg);
  }
}

function applyBody(verb, body, rt, thenList) {
  const battle = rt.battle;
  const unit = rt.unit;
  const env = rt.env;
  const pluginId = rt.pluginId;
  if (verb === 'fx') { doFx(body, rt); return; }
  if (verb === 'dp') {
    const n = resolveValue(body.amount, env, rt);
    if (!finite(n)) return;
    // [ASSUMED] fx:true always emits fx('dp') with {n, id}, even when n is 0 (德克萨斯剑雨). Without fx, n ≤ 0 is a no-op.
    if (n !== 0 || body.fx) battle.addDp(unit.ownerId, n);
    if (body.fx) battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
    return;
  }
  if (verb === 'layers') {
    const n = resolveValue(body.amount, env, rt);
    if (!(n > 0) || typeof body.bond !== 'string') return;
    battle.addLayers(unit.ownerId, body.bond, n, 'plugin:' + pluginId, { source: unit });
    return;
  }
  if (verb === 'spawnToken') {
    const tokenId = tokenIdOf(body, env);
    const tile = tileOf(body, rt);
    if (!tokenId || !tile) { if (body.stop) rt.halt = true; return; }
    const opts = {};
    if (body.duration != null) opts.duration = resolveValue(body.duration, env, rt);
    const tok = battle.spawnToken(unit, tokenId, tile[0], tile[1], opts);
    if (!tok) { if (body.stop) rt.halt = true; return; }
    rt.lastSpawn = tok;
    if (typeof body.mem === 'string' && body.mem) unit.mem[body.mem] = tok;
    if (body.fx) {
      battle.fx('summon', { x: tok.x, y: tok.y, id: tok.id, token: tokenId });
    }
    return;
  }
  const targets = resolveTargets(body.target, rt);
  const saved = rt.target;
  for (const t of targets) {
    if (rt.halt) break;
    rt.target = t;
    if (verb === 'buff') {
      const mods = body.mods ? resolveMods(body.mods, env, rt) : null;
      const buff = {
        key: typeof body.key === 'string' && body.key ? body.key : `dsl:${pluginId}:buff`,
        mods,
        source: unit,
        tags: ['plugin:' + pluginId].concat(Array.isArray(body.tags) ? body.tags : []),
      };
      if (body.duration != null) buff.duration = resolveValue(body.duration, env, rt);
      if (body.persist) buff.persist = true;
      battle.addBuff(t, buff);
    } else if (verb === 'status') {
      const dur = resolveValue(body.duration, env, rt);
      const opts = { duration: dur, source: unit };
      if (body.value != null) opts.value = resolveValue(body.value, env, rt);
      battle.applyStatus(t, body.key, opts);
    } else if (verb === 'damage') {
      doDamage(body, t, rt);
    } else if (verb === 'heal') {
      battle.heal(unit, t, resolveValue(body.amount, env, rt));
    } else if (verb === 'sp') {
      giveSp(t, resolveValue(body.amount, env, rt), 'talent');
    } else if (verb === 'push') {
      battle.push(t, resolveValue(body.force, env, rt), { from: unit, effect: !!body.effect });
    } else if (verb === 'pull') {
      battle.pull(t, resolveValue(body.force, env, rt), { to: { x: unit.x, y: unit.y }, center: unit });
    } else if (verb === 'shield') {
      battle.addBuff(t, {
        key: typeof body.key === 'string' && body.key ? body.key : `dsl:${pluginId}:shield`,
        shield: resolveValue(body.amount, env, rt),
        shieldHits: body.hits != null ? resolveValue(body.hits, env, rt) : 0,
        duration: body.duration != null ? resolveValue(body.duration, env, rt) : undefined,
        source: unit,
        tags: ['plugin:' + pluginId],
        visible: body.visible !== false,
      });
    }
    if (Array.isArray(thenList) && thenList.length) runActions(thenList, rt, (rt._depth || 0) + 1);
  }
  rt.target = saved;
}

function actionVerb(node) {
  if (!node || typeof node !== 'object') return null;
  for (const k of ACTIONS) if (Object.prototype.hasOwnProperty.call(node, k)) return k;
  return null;
}

/**
 * Run an action list. Each node costs one budget execution (its `then` list is further nodes). Returns false when
 * the plugin was stopped. [ASSUMED] `then` is either a sibling of the action or a field inside that action's body
 * (the Texas rewrite puts it inside `damage`). Both schedule the same follow-up; writing both is rejected by the
 * validator. For damage, status, buff, heal, sp, push, pull and shield it runs per target, after that target and
 * before the next — sequencing, not a loop — so a per-enemy "two hits then stun" stays in official order.
 */
export function runActions(list, rt, depth = 0) {
  if (!Array.isArray(list) || depth > THEN_MAX_DEPTH) return !rt.halt;
  rt._depth = depth;
  const limit = rt.env && rt.env.budget > 0 ? rt.env.budget : DEFAULT_BUDGET;
  for (const node of list) {
    if (rt.halt) return false;
    const verb = actionVerb(node);
    if (!verb) continue;
    if (!charge(rt.battle, rt.unit, rt.pluginId, limit)) return false;
    const body = node[verb];
    if (!body || typeof body !== 'object') continue;
    const thenList = Array.isArray(node.then) ? node.then : (Array.isArray(body.then) ? body.then : null);
    const perTarget = verb === 'damage' || verb === 'status' || verb === 'buff' || verb === 'heal'
      || verb === 'sp' || verb === 'push' || verb === 'pull' || verb === 'shield';
    applyBody(verb, body, rt, perTarget ? thenList : null);
    if (!perTarget && thenList) runActions(thenList, rt, depth + 1);
  }
  return !rt.halt;
}

export function makeRuntime(battle, unit, env, ctx = {}) {
  const target = ctx.target ?? ctx.victim ?? null;
  const source = ctx.source ?? ctx.killer ?? ctx.attacker ?? null;
  return {
    battle,
    unit,
    skill: ctx.skill || (unit && unit.skill) || null,
    env,
    pluginId: env.pluginId,
    target,
    source,
    dmg: ctx.dmg || null,
    dealt: ctx.dealt,
    targets: ctx.targets || null,
    hook: ctx.hook || null,
    lastSpawn: null,
    halt: false,
    _depth: 0,
  };
}

function allowDown(when) {
  return when === 'battleStart' || when === 'always' || when === 'allyDeath' || when === 'deploy';
}

function tryFire(talent, battle, unit, env, ctx, state) {
  if (!unit) return;
  if (!allowDown(talent.when) && !unit.alive) return;
  if (unit.deploySeq !== state.seq) {
    state.seq = unit.deploySeq;
    state.last = -Infinity;
    state.latched = false;
  }
  const cd = state.cd;
  if (cd > 0 && battle.time - state.last < cd - 1e-9) return;
  const rt = makeRuntime(battle, unit, env, ctx);
  if (!evalCond(talent.if, rt)) return;
  const ran = runActions(talent.do, rt);
  if (ran && cd > 0) state.last = battle.time;
}

/**
 * Install one talent trigger. [ASSUMED] `always` runs once. A unit is not alive while Battle constructs it
 * (`_setupUnit` runs before deploy), and addBuff drops a buff on a dead unit while spawnToken would already take
 * a tile. If the unit is not alive yet, `always` waits for that unit's first `deploy` and does not run again on
 * a later redeploy. An install on a unit that is already alive still runs immediately.
 * [ASSUMED] `hpBelow` is an edge: it fires when hpRatio crosses below `below` and stays latched until the ratio
 * recovers. [ASSUMED] `cooldown` is seconds kept on the closure and reset when deploySeq changes.
 * [ASSUMED] `allyDeath` is another living ally of the same owner dying. `hitTaken` uses byEnemyAttack and also
 * ignores a `dsl` tag. `hitDealt` is the `hit` hook for this unit and ignores `dsl`.
 */
export function installTrigger(talent, battle, unit, env) {
  const when = talent.when;
  // Per unit, per battle — not on the shared spec object (two copies of one chess must not share a cooldown).
  const state = {
    seq: unit.deploySeq,
    last: -Infinity,
    latched: false,
    cd: talent.cooldown != null ? resolveValue(talent.cooldown, env, null) : 0,
  };
  const fire = (ctx) => tryFire(talent, battle, unit, env, ctx || {}, state);
  if (when === 'always') {
    if (unit.alive) { fire({ hook: 'always' }); return; }
    let done = false;
    battle.on('deploy', (ctx) => {
      if (done || !ctx || ctx.unit !== unit || !unit.alive) return;
      done = true;
      fire({ ...ctx, hook: 'always' });
    }, { owner: unit });
    return;
  }
  if (when === 'every') {
    const sec = resolveValue(talent.seconds, env, null);
    const sched = battle.every(sec, () => fire({ hook: 'every' }), { owner: unit });
    trackTimer(battle, env.pluginId, sched, env && env.budget);
    return;
  }
  if (when === 'hpBelow') {
    const below = resolveValue(talent.below, env, null);
    const check = () => {
      if (!unit.alive) return;
      const under = unit.hpRatio < below;
      if (under && !state.latched) { state.latched = true; fire({ hook: 'hpBelow' }); }
      else if (!under) state.latched = false;
    };
    battle.on('tick', check, { owner: unit });
    battle.on('damaged', (ctx) => { if (ctx.target === unit) check(); }, { owner: unit });
    return;
  }
  if (when === 'deploy') {
    battle.on('deploy', (ctx) => { if (ctx.unit === unit) fire(ctx); }, { owner: unit });
    return;
  }
  if (when === 'battleStart') {
    battle.on('battleStart', () => fire({ hook: 'battleStart' }), { owner: unit });
    return;
  }
  if (when === 'attack') {
    battle.on('attack', (ctx) => {
      if (ctx.attacker !== unit) return;
      fire({ ...ctx, source: unit, target: (ctx.targets && ctx.targets[0]) || null, hook: 'attack' });
    }, { owner: unit });
    return;
  }
  if (when === 'hitDealt') {
    battle.on('hit', (ctx) => {
      if (ctx.source !== unit) return;
      if (ctx.dmg && Array.isArray(ctx.dmg.tags) && ctx.dmg.tags.includes('dsl')) return;
      fire({ ...ctx, hook: 'hitDealt' });
    }, { owner: unit });
    return;
  }
  if (when === 'hitTaken') {
    battle.on('damaged', (ctx) => {
      if (ctx.target !== unit) return;
      if (ctx.dmg && Array.isArray(ctx.dmg.tags) && ctx.dmg.tags.includes('dsl')) return;
      if (!byEnemyAttack(ctx)) return;
      fire({ ...ctx, hook: 'hitTaken' });
    }, { owner: unit });
    return;
  }
  if (when === 'kill') {
    battle.on('kill', (ctx) => {
      if (ctx.killer !== unit) return;
      fire({ ...ctx, target: ctx.victim, source: ctx.killer, hook: 'kill' });
    }, { owner: unit });
    return;
  }
  if (when === 'allyDeath') {
    battle.on('death', (ctx) => {
      const u = ctx.unit;
      if (!u || u === unit || u.side !== 'ally') return;
      if (u.ownerId != null && unit.ownerId != null && u.ownerId !== unit.ownerId) return;
      fire({ ...ctx, target: u, source: ctx.killer ?? ctx.source ?? null, hook: 'allyDeath' });
    }, { owner: unit });
    return;
  }
  if (when === 'skillStart' || when === 'skillEnd') {
    const name = when === 'skillStart' ? 'skillStart' : 'skillEnd';
    battle.on(name, (ctx) => { if (ctx.unit === unit) fire({ ...ctx, hook: name }); }, { owner: unit });
  }
}

/** Bind a skill `on.*` list to a SkillSpec callback. */
export function skillCallback(actions, env) {
  return (ctx) => {
    const rt = makeRuntime(ctx.battle, ctx.unit, env, ctx);
    runActions(actions, rt);
  };
}
