// simcheck — whether a deterministic simulation gives the same bits in every JavaScript engine: the server's Node and
// the players' browsers (Chrome / Edge, Firefox, Safari, on desktops and phones). A run of one scenario is traced:
//   state   the simulation's observable numbers after every tick (the adapter's state(): positions, HP, timers …),
//           hashed to their exact IEEE-754 bits; each block of `every` ticks keeps one hash of its ticks' hashes
//   view    what a viewer is shown (the adapter's view(): a wire snapshot), hashed at the end of every block and at the
//           end of the run
//   deep    the hidden state (the adapter's deep(): every value reachable from the units), hashed every `deepEvery`
//           ticks (a multiple of `every`; the walk is costly) and at the end of the run
//   result  the outcome's digest (the adapter's result())
// A run elsewhere is compared with a reference run (Node) block by block: the first block that differs, at any level,
// says when the two parted; a dump of that block's state vectors from both sides then names the first field that
// differs (diffDumps).
//
// Integer operations only (Math.imul, shifts) over the numbers' bits: the hashes are the same in every engine. NaN is
// hashed as one value (engines may keep different NaN payloads).
//
// Written for Stronghold Protocol (GPL-3.0-or-later) and Duel Channel (AGPL-3.0-or-later) by the same author, and kept
// the same in both. No dependencies; Node and browsers.

const DV = new DataView(new ArrayBuffer(8));
const rotl = (x, r) => (x << r) | (x >>> (32 - r));
// murmur3's block mix and finaliser
function mix(h, k) {
  k = Math.imul(k, 0xcc9e2d51); k = rotl(k, 15); k = Math.imul(k, 0x1b873593);
  h ^= k; h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}
function fmix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
// the kind of an object by its tag, not instanceof: a simulation may run in another realm (a Node VM context) than the
// hashing code, with its own Map / Set constructors
const tag = (v) => Object.prototype.toString.call(v);
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && tag(v) !== '[object DataView]');
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A 32-bit hash fed with words, numbers (their bits), strings and plain values. */
class Hash {
  constructor(seed = 0x9747b28c) { this.h = seed | 0; this.n = 0; }
  word(w) { this.h = mix(this.h, w | 0); this.n++; return this; }
  num(x) {
    if (x !== x) return this.word(0x7ff80000).word(0);
    DV.setFloat64(0, x, true);
    return this.word(DV.getUint32(0, true)).word(DV.getUint32(4, true));
  }
  str(s) { this.word(0x5354 ^ s.length); for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i)); return this; }
  // null / undefined / booleans / numbers / strings / arrays / plain objects (keys in their own order, which is the
  // order the same code created them in, in any engine)
  value(v, depth = 0) {
    if (v === null || v === undefined) return this.word(v === null ? 0x6e756c6c : 0x756e6466);
    switch (typeof v) {
      case 'number': return this.num(v);
      case 'string': return this.str(v);
      case 'boolean': return this.word(v ? 0x74727565 : 0x66616c73);
      case 'bigint': return this.str(v.toString());
      case 'object': break;
      default: return this.word(0x66756e63);
    }
    if (depth > 32) return this.word(0x64656570);
    if (isList(v)) { this.word(0x41525259 ^ v.length); for (const x of v) this.value(x, depth + 1); return this; }
    const keys = Object.keys(v);
    this.word(0x4f424a54 ^ keys.length);
    for (const k of keys) { this.str(k); this.value(v[k], depth + 1); }
    return this;
  }
  done() { return fmix(this.h ^ this.n); }
}

const hex = (u) => (u >>> 0).toString(16).padStart(8, '0');
/** The hash of a list of numbers (a state vector). */
function hashNumbers(v) { const h = new Hash(); for (let i = 0; i < v.length; i++) h.num(v[i]); return h.done(); }
/** The hash of any plain value. */
function hashValue(v) { return new Hash().value(v).done(); }
/** Portable content identity for local diagnostic inputs (not a security signature). */
function textFingerprint(s) { return hex(new Hash().str(s).done()) + hex(new Hash(0x53a9d61f).str(s).done()); }
function selectScenarios(scenarios, subsets, id, only = null) {
  const subset = subsets.find(s => s.id === id);
  if (!subset) throw new Error(`unknown subset: ${id}`);
  const names = only == null ? null : new Set(String(only).split(',').map(s => s.trim()).filter(Boolean));
  if (names) for (const name of names) if (!scenarios.some(s => s.id === name)) throw new Error(`unknown scenario: ${name}`);
  const list = scenarios.filter(s => subset.pick(s) && (!names || names.has(s.id)));
  if (!list.length) throw new Error('no scenarios selected');
  return { subset, list };
}

/**
 * The hash of everything reachable from roots: own properties (non-enumerable too, data properties only), arrays,
 * typed arrays, Maps, Sets; another root met on the way counts as its index, an object met twice counts once, the keys
 * in `skip` are left out (references back to shared definitions, process-wide counters …).
 * @param {object[]} roots @param {{ skip?: Iterable<string>, maxDepth?: number }} [o]
 */
function deepHash(roots, { skip = [], maxDepth = 8 } = {}) {
  const idx = new Map(roots.map((r, i) => [r, i])), seen = new Set(), skipped = new Set(skip), h = new Hash();
  const walk = (v, depth) => {
    if (v === null || v === undefined) { h.word(7); return; }
    const t = typeof v;
    if (t === 'number') { h.num(v); return; }
    if (t === 'string') { h.str(v); return; }
    if (t === 'boolean') { h.word(v ? 3 : 5); return; }
    if (t !== 'object' || depth > maxDepth) return;
    if (depth > 0 && idx.has(v)) { h.word(0x55550000 + idx.get(v)); return; }
    if (seen.has(v)) { h.word(11); return; }
    seen.add(v);
    if (isList(v)) { h.word(v.length); for (const x of v) walk(x, depth + 1); return; }
    const kind = tag(v);
    if (kind === '[object Map]') { h.word(v.size); for (const [k, x] of v) { walk(k, depth + 1); walk(x, depth + 1); } return; }
    if (kind === '[object Set]') { h.word(v.size); for (const x of v) walk(x, depth + 1); return; }
    for (const k of Object.getOwnPropertyNames(v)) {
      if (skipped.has(k)) continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d || !('value' in d) || typeof d.value === 'function') continue;
      h.str(k); walk(d.value, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return h.done();
}

/**
 * A run of one scenario, traced as it goes; advance() runs it for a time budget (a page stays responsive), finish()
 * gives the trace. The adapter:
 *   start(scenario) → run;  step(run) → true when a tick was simulated, false when the run is over;
 *   state(run) → number[] (after every tick);  labels?(run) → string[] (the names of state's entries, for dumps);
 *   view?(run) → plain value;  deep?(run) → uint32;  result(run) → string;  maxTicks? (a runaway guard)
 * dump: [first, last] ticks whose state vectors (and labels) are kept.
 */
function tracer(adapter, scenario, { every = 30, deepEvery = every * 5, dump = null } = {}) {
  const max = adapter.maxTicks || 1e6;
  if (!Number.isInteger(every) || every < 1 || !Number.isInteger(deepEvery) || deepEvery < every || deepEvery % every) throw new Error('invalid sample interval');
  if (dump && (!Array.isArray(dump) || dump.length !== 2 || !dump.every(Number.isInteger) || dump[0] < 1 || dump[1] < dump[0] || dump[1] > max)) throw new Error('invalid dump window');
  const run = adapter.start(scenario);
  let t = 0, block = new Hash(), over = false;
  const blocks = [], views = [], deeps = [], dumps = {};
  const sample = (end) => {
    if (adapter.view) views.push(hashValue(adapter.view(run)));
    if (adapter.deep && (end || t % deepEvery === 0)) deeps.push(adapter.deep(run) >>> 0);
  };
  return {
    get ticks() { return t; },
    get done() { return over; },
    advance(budgetMs = Infinity) {
      const until = budgetMs === Infinity ? Infinity : now() + budgetMs;
      while (!over) {
        if (!adapter.step(run)) {
          over = true;
          if (t === 0) sample(true);
          if (t % every) { blocks.push(block.done()); sample(true); } else if (adapter.deep && t % deepEvery) deeps.push(adapter.deep(run) >>> 0);
          break;
        }
        if (t >= max) throw new Error(`scenario ${scenario.id}: maxTicks ${max} reached before completion`);
        t++;
        const s = adapter.state(run);
        block.word(hashNumbers(s));
        if (dump && t >= dump[0] && t <= dump[1]) dumps[t] = { state: Array.from(s, encodeNumber), labels: adapter.labels ? adapter.labels(run) : null };
        if (t % every === 0) { blocks.push(block.done()); block = new Hash(); sample(false); }
        if ((t & 31) === 0 && now() > until) break;
      }
      return over;
    },
    finish() {
      while (!over) this.advance();
      return { ticks: t, blocks: blocks.map(hex).join(''), views: views.map(hex).join(''), deeps: deeps.map(hex).join(''), result: String(adapter.result(run)), ...(dump ? { dumps } : {}) };
    },
  };
}
/** A whole run's trace (see tracer). */
function trace(adapter, scenario, opts) { return tracer(adapter, scenario, opts).finish(); }

const firstDiff = (a = '', b = '') => {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 8) if (a.slice(i, i + 8) !== b.slice(i, i + 8)) return i / 8;
  return -1;
};
/**
 * A trace against its reference. ok, or: `at` — where they first parted (level 'state' / 'view' / 'deep', the block,
 * its ticks [from, to]); `result` — the outcomes differ; `ticks` — the runs' lengths differ. The level whose difference
 * shows first is the one reported — by the tick it is seen at (a block's or a sample's last tick; a deep sample covers
 * deepEvery ticks), the finer level on a tie; a run whose state never differs but whose view does still counts.
 */
function compare(ref, got, every = 30, deepEvery = every * 5) {
  if (!ref) return { ok: false, missing: true };
  let at = null;
  for (const level of ['state', 'view', 'deep']) {
    const key = level === 'state' ? 'blocks' : level === 'view' ? 'views' : 'deeps', span = level === 'deep' ? deepEvery : every;
    const i = firstDiff(ref[key], got[key]);
    if (i < 0) continue;
    const to = Math.min((i + 1) * span, Math.max(ref.ticks, got.ticks));
    if (!at || to < at.to) at = { level, block: i, from: i * span + 1, to };
  }
  const result = ref.result !== got.result, ticks = ref.ticks !== got.ticks;
  return { ok: !at && !result && !ticks, at, result, ticks: ticks ? [ref.ticks, got.ticks] : null };
}
/** How bad a comparison is, for sorting and summaries: 3 the outcome differs, 2 what viewers see, 1 only inside. */
function severity(c) {
  if (c.ok) return 0;
  if (c.missing || c.result || c.ticks) return 3;
  return c.at && c.at.level !== 'deep' ? 2 : 1;
}

const SPECIAL_NUMBERS = new Map([['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-0', -0]]);
const encodeNumber = (x) => Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : Object.is(x, -0) ? '-0' : x;
const bitsOf = (value) => {
  const x = typeof value === 'string' && SPECIAL_NUMBERS.has(value) ? SPECIAL_NUMBERS.get(value) : value;
  if (typeof x !== 'number') throw new Error('invalid numeric state entry');
  if (Number.isNaN(x)) return 'NaN';
  DV.setFloat64(0, x, true);
  return hex(DV.getUint32(4, true)) + hex(DV.getUint32(0, true));
};
/**
 * Two dumps of the same ticks (tracer `dump`) compared field by field: the differences in tick order, each with the
 * tick, the entry's index and label, both values and their bits. Stops after `limit`.
 */
function diffDumps(a, b, limit = 20) {
  const out = [];
  const ticks = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].map(Number).sort((x, y) => x - y);
  for (const t of ticks) {
    const x = a[t], y = b[t];
    if (!x || !y) { out.push({ tick: t, index: -1, label: x ? 'missing on the other side' : 'missing in the reference' }); if (out.length >= limit) break; continue; }
    const n = Math.max(x.state.length, y.state.length);
    for (let i = 0; i < n && out.length < limit; i++) {
      const p = x.state[i], q = y.state[i];
      if (Object.is(p, q) || (p !== undefined && q !== undefined && bitsOf(p) === bitsOf(q))) continue;
      out.push({ tick: t, index: i, label: (x.labels && x.labels[i]) || (y.labels && y.labels[i]) || `#${i}`, ref: p, got: q, refBits: p === undefined ? '' : bitsOf(p), gotBits: q === undefined ? '' : bitsOf(q) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

const VERSION = 2;
export { VERSION, Hash, hex, hashNumbers, hashValue, textFingerprint, selectScenarios, deepHash, tracer, trace, compare, severity, diffDumps };
