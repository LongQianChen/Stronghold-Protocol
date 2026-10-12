// Stronghold Protocol's battles for simcheck (core.js): the golden battle corpus — tools/golden.mjs's families roster,
// bonds, fields, standins and diy (its matches are not single battles) — as BattleSpecs (written by
// tools/sim-check.mjs), each built with /sim/spec.js createBattleFromSpec as the browser runner does
// (public/js/battle/runner.js) and stepped tick by tick; a field battle stops at its golden cap like the corpus.
//   state  after every tick: the battle time, the RNG state and per unit FIELDS (exact bits)
//   view   b.snapshot(): what viewers are sent
//   deep   every value reachable from the units, the definitions and the process-wide sequence numbers left out
//   result resultDigest(b.result()).hash: what the server's SP_VERIFY compares
// The page (sim-check.js) and the tool (tools/sim-check.mjs) both use it, with the sim and its data loaded their way.
import { deepHash } from './core.js';

/** The data files the sim reads: public/js/battle/runner.js SIM_DATA_FILES (test/sim/simcheck.test.js keeps them equal). */
export const SIM_DATA_FILES = Object.freeze(['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups']);
/** Per unit in the state vector. */
export const FIELDS = Object.freeze(['alive', 'removed', 'deployed', 'x', 'y', 'hp', 'atkCd', 'sp', 'burn', 'neural', 'necrosis', 'apoptosis', 'erosion',
  'dmg', 'taken', 'heal', 'blocking']);
// left out of the deep state: references back to definitions and the battle, and buffs.js's process-wide `seq` (it
// depends on what ran before in the same page or process)
const DEEP_SKIP = Object.freeze(['def', 'profile', 'kit', 'battle', 'b', 'seq']);
const QUIET = Object.freeze({ error() {}, warn() {}, info() {}, debug() {} });

/** The scenario list of a specs document: id, golden family, in the fast subset. */
export const scenariosOf = (doc) => doc.specs.map((s) => ({ id: s.id, family: s.fam, fast: s.fast }));

/**
 * @param {{ spec: { createBattleFromSpec: Function, resultDigest: Function }, ds: object, doc: { specs: object[] }, logger?: object }} o
 *   spec: the /sim/spec.js module; ds: a simdata DataSource over SIM_DATA_FILES; doc: the specs document
 */
export function strongholdAdapter({ spec, ds, doc, logger = QUIET }) {
  const byId = new Map(doc.specs.map((s) => [s.id, s]));
  return {
    maxTicks: 200000,
    start(sc) {
      const s = byId.get(sc.id);
      return { b: spec.createBattleFromSpec(s.spec, ds, { logger }), cap: s.cap ?? null };
    },
    step(r) {
      const b = r.b;
      if (b.finished) return false;
      if (r.cap != null && b.time >= r.cap - 1e-9) { b.forceEnd('forced'); return false; }
      b.step();
      return true;
    },
    state(r) {
      const b = r.b, v = [b.time, b.rng.state() >>> 0];
      for (const u of b.units) {
        const e = u.elem || {}, s = u.stats || {};
        v.push(u.alive ? 1 : 0, u.removed ? 1 : 0, u.deployed ? 1 : 0, u.x, u.y, u.hp, u.atkCd, u.skill && u.skill.sp != null ? u.skill.sp : -1,
          e.burn ?? 0, e.neural ?? 0, e.necrosis ?? 0, e.apoptosis ?? 0, e.erosion ?? 0, s.dmg ?? 0, s.taken ?? 0, s.heal ?? 0, (u.blocking || []).length);
      }
      return v;
    },
    labels(r) {
      const out = ['time', 'rng'];
      for (const u of r.b.units) { const name = `${u.side === 'enemy' ? 'enemy' : 'ally'} ${u.defId}#${u.id}`; for (const f of FIELDS) out.push(`${name}.${f}`); }
      return out;
    },
    view(r) { return r.b.snapshot(); },
    deep(r) { return deepHash(r.b.units, { skip: DEEP_SKIP }); },
    result(r) { return spec.resultDigest(r.b.result()).hash; },
  };
}
