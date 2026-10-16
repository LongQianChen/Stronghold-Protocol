// server/match/dslMeta.js — prep-phase minimum of a P2 DSL spec (DESIGN §32.7).
//
// roundStart / income / buy / sell / refresh / merge / levelUp / battleResult map onto MetaRegistry hooks.
// Actions are funds / layers / gainItem, through the ctx helpers (addFunds / addLayers / grantItem).
// This module is not imported by the sim, and it does not register itself on the default registry: a test or a
// later content-set builder calls registerDslMeta on a registry it owns.
//
// [ASSUMED] The battle action budget does not apply here. Prep work is one dispatch per hook, already capped by
// EffectDispatcher. [ASSUMED] `funds.setIncome: true` writes `ev.income` (Math.trunc, never below 0), including 0,
// and leaves a pre-set income alone when the condition does not match — the shape of 老鲤's give_coin_in_round,
// which does not call addFunds. [ASSUMED] `if.round` is an integer compared with `ctx.round`.

import { validateDsl, formatProblems } from '../sim/content/dsl/validate.js';
import { evalCond, resolveValue } from '../sim/content/dsl/vocab.js';
import { hostPluginId } from '../sim/content/dsl/compile.js';

const EFFECT_KEY_RE = /^effect:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_\-.:#]+$/;

const HOOK = Object.freeze({
  roundStart: 'onRoundStart',
  income: 'onIncome',
  buy: 'onBuy',
  sell: 'onSold',
  refresh: 'onRefresh',
  merge: 'onMerge',
  levelUp: 'onLevelUp',
  battleResult: 'onBattleResult',
});

function fail(code, path, zh) {
  const err = new Error(`${code} ${path}: ${zh}`);
  err.code = code;
  return err;
}

function asNum(v, d = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * [ASSUMED] Prep `bondActive` reads the prep ctx, not the battle bond table (there is no unit here).
 * Prefer `ctx.bond(id)` when it returns a record; otherwise `ctx.bonds[id]`. `active` comes from that
 * record, or from `ctx.bondActive(id)` when the record has no `active` field. `tier` is the record's tier.
 * Unit conditions are rejected by validateDsl; they are not a silent false.
 */
function prepBondActive(value, ctx, env) {
  const id = typeof value === 'string' ? value : value && value.id;
  if (typeof id !== 'string' || !id || !ctx) return false;
  const tier = value && typeof value === 'object' && value.tier != null ? resolveValue(value.tier, env, null) : null;
  let rec = null;
  if (typeof ctx.bond === 'function') rec = ctx.bond(id);
  if ((!rec || typeof rec !== 'object') && ctx.bonds && typeof ctx.bonds === 'object') rec = ctx.bonds[id] || null;
  let active = false;
  if (rec && typeof rec === 'object' && Object.prototype.hasOwnProperty.call(rec, 'active')) active = !!rec.active;
  else if (typeof ctx.bondActive === 'function') active = !!ctx.bondActive(id);
  if (!active) return false;
  if (tier == null) return true;
  return asNum(rec && rec.tier, 0) >= tier;
}

function prepCond(cond, ctx, env) {
  if (cond == null) return true;
  if (typeof cond !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(cond, 'round') && ctx.round !== cond.round) return false;
  const rest = { ...cond };
  delete rest.round;
  if (Object.prototype.hasOwnProperty.call(rest, 'bondActive')) {
    if (!prepBondActive(rest.bondActive, ctx, env)) return false;
    delete rest.bondActive;
  }
  if (!Object.keys(rest).length) return true;
  // `chance` is last inside evalCond. A unit condition that slipped past validation is false and does not draw rng.
  const rt = { battle: { rng: ctx.rng || null }, unit: null, env, target: null, source: null, pluginId: env.pluginId };
  return evalCond(rest, rt);
}

function runPrep(node, ctx, ev, env) {
  if (!node || typeof node !== 'object') return;
  if (node.funds && typeof node.funds === 'object') {
    const n = Math.trunc(resolveValue(node.funds.amount, env, null));
    if (node.funds.setIncome) {
      if (ev) ev.income = Math.max(0, n);
      return;
    }
    if (typeof ctx.addFunds === 'function') ctx.addFunds(n);
    return;
  }
  if (node.layers && typeof node.layers === 'object') {
    const n = Math.trunc(resolveValue(node.layers.amount, env, null));
    if (n !== 0 && typeof node.layers.bond === 'string' && typeof ctx.addLayers === 'function') {
      ctx.addLayers(node.layers.bond, n, { reason: 'plugin:' + env.pluginId });
    }
    return;
  }
  if (node.gainItem && typeof node.gainItem === 'object') {
    const id = node.gainItem.item;
    if (typeof id === 'string' && id && typeof ctx.grantItem === 'function') {
      ctx.grantItem(id, { source: 'plugin:' + env.pluginId });
    }
  }
}

/**
 * Compile `spec.meta` into a MetaRegistry handler object. Throws when the spec is not valid; the message
 * contains the PLUGIN_DSL_* code. Does not register anything.
 * @param {object} spec
 * @param {{ pluginId?: string, def?: { raw?: { pluginId?: string } } }} [opts]
 * @returns {object}
 */
export function compileDslMeta(spec, opts = {}) {
  const checked = validateDsl(spec);
  if (!checked.ok) throw fail(checked.problems[0].code, checked.problems[0].path, formatProblems(checked.problems));
  const host = hostPluginId(spec, opts);
  if (!host.ok) throw fail('PLUGIN_DSL_PLUGIN_ID', 'pluginId', host.zh);
  const meta = spec && spec.meta;
  if (!meta || !Array.isArray(meta.on)) throw fail('PLUGIN_DSL_META', 'meta', '备战规格需要 meta.on');
  const env = {
    bb: {},
    chess: null,
    def: null,
    pluginId: host.pluginId,
    budget: spec.budget != null ? spec.budget : 0,
    spec,
  };
  const lists = {};
  for (const entry of meta.on) {
    const name = HOOK[entry.when];
    if (!name) continue;
    if (!lists[name]) lists[name] = [];
    lists[name].push(entry);
  }
  const handler = {};
  for (const [name, entries] of Object.entries(lists)) {
    handler[name] = (ctx, ev) => {
      for (const entry of entries) {
        if (!prepCond(entry.if, ctx, env)) continue;
        const actions = Array.isArray(entry.do) ? entry.do : [];
        for (const action of actions) runPrep(action, ctx, ev, env);
      }
    };
  }
  return handler;
}

/**
 * Validate, compile and register. [ASSUMED] A plugin key is only `effect:<this host plugin id>:<local>`.
 * `band:` / `global:` and any other plugin's `effect:` key are PLUGIN_DSL_META and are not registered, so a
 * later register cannot replace an official handler. The schema accepts any `effect:<id>:` shape; this
 * function is what checks the id against the host.
 * @param {{ register: Function, get?: Function }} registry
 * @param {object} spec
 * @param {{ pluginId?: string, def?: { raw?: { pluginId?: string } } }} [opts]
 */
export function registerDslMeta(registry, spec, opts = {}) {
  const checked = validateDsl(spec);
  if (!checked.ok) throw fail(checked.problems[0].code, checked.problems[0].path, formatProblems(checked.problems));
  const host = hostPluginId(spec, opts);
  if (!host.ok) throw fail('PLUGIN_DSL_PLUGIN_ID', 'pluginId', host.zh);
  const key = spec && spec.meta && spec.meta.key;
  const prefix = `effect:${host.pluginId}:`;
  if (typeof key !== 'string' || !key.startsWith(prefix) || !EFFECT_KEY_RE.test(key)) {
    throw fail('PLUGIN_DSL_META', 'meta.key', '插件键只接受 effect:<本插件 id>:');
  }
  const handler = compileDslMeta(spec, { ...opts, pluginId: host.pluginId });
  registry.register(key, handler);
  return handler;
}
