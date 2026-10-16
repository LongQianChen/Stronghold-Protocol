// server/sim/content/dsl/budget.js — per-battle, per-plugin action budget (DESIGN §32.7).
//
// The count is executions of action nodes, not time and not targets: one node that fans out to N units costs 1.
// Past the limit only this plugin stops for the rest of this battle (its timers are cancelled, buffs it tagged
// `plugin:<id>` are removed). Skill mods the engine already applied stay until that skill ends. One
// `plugin:<id>` error is reported through battle._handlerError, which the match copies into m.simErrorLog.
// State lives on a WeakMap keyed by the battle, so nothing survives the battle.

// [ASSUMED] 8000 executions per plugin per battle when the spec names no budget. A spec may set `budget`
// to a positive integer (validated, at most 1e7).
export const DEFAULT_BUDGET = 8000;

const STATE = new WeakMap();

function slots(battle) {
  let m = STATE.get(battle);
  if (!m) STATE.set(battle, (m = new Map()));
  return m;
}

function slot(battle, pluginId, limit) {
  const m = slots(battle);
  let s = m.get(pluginId);
  if (!s) {
    m.set(pluginId, (s = {
      used: 0,
      limit: limit > 0 ? limit : DEFAULT_BUDGET,
      disabled: false,
      reported: false,
      timers: [],
    }));
  } else if (limit > 0 && s.used === 0 && !s.disabled) {
    // trackTimer opens the slot when an `every` talent is installed, before any action has named spec.budget.
    s.limit = limit;
  }
  return s;
}

function stripBuffs(battle, pluginId) {
  const tag = 'plugin:' + pluginId;
  const units = battle.units || [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u || !u.buffs) continue;
    for (let k = u.buffs.length - 1; k >= 0; k--) {
      const b = u.buffs[k];
      if (b && Array.isArray(b.tags) && b.tags.includes(tag)) battle.removeBuff(u, b);
    }
  }
}

function cutoff(battle, unit, pluginId, s) {
  if (s.disabled) return;
  s.disabled = true;
  for (const t of s.timers) {
    try { t.cancel(); } catch { /* timer already finished */ }
  }
  s.timers.length = 0;
  try { stripBuffs(battle, pluginId); } catch { /* a unit already left the field */ }
  if (s.reported) return;
  s.reported = true;
  const err = new Error(`action budget ${s.limit} exceeded`);
  if (typeof battle._handlerError === 'function') battle._handlerError('plugin:' + pluginId, unit ?? null, err);
}

/**
 * Reserve one action execution. False when the plugin is already stopped or this execution would pass the limit
 * (the caller must not apply that action).
 */
export function charge(battle, unit, pluginId, limit) {
  if (!battle) return false;
  const s = slot(battle, pluginId, limit);
  if (s.disabled) return false;
  if (s.used >= s.limit) {
    cutoff(battle, unit, pluginId, s);
    return false;
  }
  s.used += 1;
  return true;
}

/** Remember a battle.every / battle.after handle so a cutoff cancels it. `limit` is the spec budget when known. */
export function trackTimer(battle, pluginId, sched, limit) {
  if (!battle || !sched) return;
  const s = slot(battle, pluginId, limit);
  if (s.disabled) {
    try { sched.cancel(); } catch { /* ignore */ }
    return;
  }
  s.timers.push(sched);
}

export function budgetUsed(battle, pluginId) {
  const m = STATE.get(battle);
  const s = m && m.get(pluginId);
  return s ? s.used : 0;
}

export function budgetDisabled(battle, pluginId) {
  const m = STATE.get(battle);
  const s = m && m.get(pluginId);
  return !!(s && s.disabled);
}
