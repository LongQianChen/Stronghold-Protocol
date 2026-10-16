// render/vfx/curves.js — Unity value encodings of the official battle effects (DESIGN §33.3): AnimationCurve,
// MinMaxCurve, Gradient and MinMaxGradient, evaluated the way Unity does. Pure math (Node tests use it as is).
//
//   evalCurve(keys, t)               an AnimationCurve: cubic Hermite between keys (tangents outSlope·Δ / inSlope·Δ),
//                                    a null slope on either side of a segment = stepped, weighted keys as Unity's Bézier
//                                    form; outside the keys the first / last value
//   bakeCurve(keys, n)               the curve sampled on 0…1 (n samples) for the per-particle lookups
//   new MinMax(v)                    a MinMaxCurve: a number (Constant), { min, max } (TwoConstants), { scalar, curve }
//                                    (Curve), { scalar, minCurve, maxCurve } (TwoCurves); `.at(t, r)` — t the normalised
//                                    time of the field, r the particle's random number for this field (0…1, kept)
//   evalGradient(g, t, out)          a Gradient { mode: 'blend'|'fixed', color: [[t,r,g,b]], alpha: [[t,a]] }
//   new MinMaxColor(v)               a MinMaxGradient: [r,g,b,a] (Color), { min, max } (TwoColors), { gradient },
//                                    { minGradient, maxGradient } (TwoGradients), { random } (RandomColor);
//                                    `.at(t, r, out)` writes r, g, b, a into out[0..3]
//
// Over-lifetime curves are baked to LUT_N samples and read with linear interpolation (the Hermite segments of particle
// curves are smooth: 64 samples keep the error far below a pixel); clip curves (render/vfx/clips.js) use evalCurve.

export const LUT_N = 64;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Bézier y at parameter u for weighted segments (Unity's weighted tangents). */
function bezierAt(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
}

/**
 * Evaluate a weighted segment as Unity does: a cubic Bézier in (time, value) whose inner control points sit at
 * `weight × Δt` along the tangents (an unweighted side uses 1/3); the Bézier parameter of `t` is found by bisection.
 */
function weightedSegment(k0, k1, t) {
  const t0 = k0[0], t1 = k1[0], dt = t1 - t0;
  const m0 = k0[3], m1 = k1[2];
  const outW = (k0[4] === 2 || k0[4] === 3) && finite(k0[6]) ? k0[6] : 1 / 3;
  const inW = (k1[4] === 1 || k1[4] === 3) && finite(k1[5]) ? k1[5] : 1 / 3;
  const x1 = t0 + outW * dt, y1 = k0[1] + outW * dt * m0;
  const x2 = t1 - inW * dt, y2 = k1[1] - inW * dt * m1;
  let lo = 0, hi = 1, u = (t - t0) / dt;
  for (let i = 0; i < 24; i++) {
    const x = bezierAt(t0, x1, x2, t1, u);
    if (Math.abs(x - t) < 1e-6 * (Math.abs(dt) + 1e-6)) break;
    if (x < t) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return bezierAt(k0[1], y1, y2, k1[1], u);
}

/** Value of an AnimationCurve (`[[time, value, inSlope, outSlope, (weightedMode, inWeight, outWeight)]…]`) at t. */
export function evalCurve(keys, t) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const n = keys.length;
  if (n === 1 || !(t > keys[0][0])) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  // binary search the segment
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid; else hi = mid;
  }
  const k0 = keys[lo], k1 = keys[hi];
  const dt = k1[0] - k0[0];
  if (!(dt > 0)) return k1[1];
  const out0 = k0[3], in1 = k1[2];
  if (!finite(out0) || !finite(in1)) return k0[1]; // stepped
  if ((k0.length > 4 && (k0[4] === 2 || k0[4] === 3)) || (k1.length > 4 && (k1[4] === 1 || k1[4] === 3))) return weightedSegment(k0, k1, t);
  const s = (t - k0[0]) / dt, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * k0[1] + (s3 - 2 * s2 + s) * out0 * dt + (-2 * s3 + 3 * s2) * k1[1] + (s3 - s2) * in1 * dt;
}

/** The curve sampled at n points over 0…1 (inclusive). */
export function bakeCurve(keys, n = LUT_N) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = evalCurve(keys, i / (n - 1));
  return out;
}

/** Linear lookup of a baked 0…1 table. */
export function lut(table, t) {
  const n = table.length - 1;
  if (!(t > 0)) return table[0];
  if (t >= 1) return table[n];
  const x = t * n, i = x | 0, f = x - i;
  return table[i] + (table[i + 1] - table[i]) * f;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** MinMaxCurve modes (Unity's ParticleSystemCurveMode). */
export const MM = Object.freeze({ CONST: 0, CURVE: 1, TWO_CURVES: 2, TWO_CONST: 3 });

/** A MinMaxCurve (see the header). Unknown shapes read as the constant `fallback`. */
export class MinMax {
  constructor(v, fallback = 0) {
    this.mode = MM.CONST;
    this.c = fallback; this.min = fallback; this.max = fallback; this.scalar = 1;
    this.a = null; this.b = null;
    if (finite(v)) { this.c = v; this.min = v; this.max = v; }
    else if (isObj(v)) {
      if (finite(v.min) && finite(v.max) && !v.curve && !v.minCurve) {
        this.mode = MM.TWO_CONST; this.min = v.min; this.max = v.max; this.c = v.max;
      } else if (Array.isArray(v.curve)) {
        this.mode = MM.CURVE; this.scalar = finite(v.scalar) ? v.scalar : 1; this.a = bakeCurve(v.curve);
      } else if (Array.isArray(v.minCurve) && Array.isArray(v.maxCurve)) {
        this.mode = MM.TWO_CURVES; this.scalar = finite(v.scalar) ? v.scalar : 1;
        this.a = bakeCurve(v.minCurve); this.b = bakeCurve(v.maxCurve);
      }
    }
    // the largest value the field can take (budgets, bounds)
    this.peak = this._peak();
  }

  /** Value at normalised time t with the particle's random r (0…1). */
  at(t, r) {
    switch (this.mode) {
      case MM.CONST: return this.c;
      case MM.TWO_CONST: return this.min + (this.max - this.min) * r;
      case MM.CURVE: return lut(this.a, t) * this.scalar;
      default: { const x = lut(this.a, t), y = lut(this.b, t); return (x + (y - x) * r) * this.scalar; }
    }
  }

  /** True when the value never changes with time (Constant / TwoConstants). */
  get constant() { return this.mode === MM.CONST || this.mode === MM.TWO_CONST; }

  _peak() {
    switch (this.mode) {
      case MM.CONST: return this.c;
      case MM.TWO_CONST: return Math.max(this.min, this.max);
      case MM.CURVE: { let m = -Infinity; for (const x of this.a) m = Math.max(m, x * this.scalar); return m; }
      default: { let m = -Infinity; for (let i = 0; i < this.a.length; i++) m = Math.max(m, this.a[i] * this.scalar, this.b[i] * this.scalar); return m; }
    }
  }
}

/** Evaluate a Unity Gradient at t into out = [r, g, b, a]; returns out. */
export function evalGradient(g, t, out = [1, 1, 1, 1]) {
  const fixed = g && g.mode === 'fixed';
  const ck = (g && Array.isArray(g.color) && g.color.length) ? g.color : [[0, 1, 1, 1]];
  const ak = (g && Array.isArray(g.alpha) && g.alpha.length) ? g.alpha : [[0, 1]];
  // colour track
  let i = 0;
  while (i < ck.length && ck[i][0] < t) i++;
  if (i === 0) { out[0] = ck[0][1]; out[1] = ck[0][2]; out[2] = ck[0][3]; }
  else if (i >= ck.length) { const k = ck[ck.length - 1]; out[0] = k[1]; out[1] = k[2]; out[2] = k[3]; }
  else if (fixed) { const k = ck[i]; out[0] = k[1]; out[1] = k[2]; out[2] = k[3]; }
  else {
    const a = ck[i - 1], b = ck[i], d = b[0] - a[0], f = d > 0 ? (t - a[0]) / d : 1;
    out[0] = a[1] + (b[1] - a[1]) * f; out[1] = a[2] + (b[2] - a[2]) * f; out[2] = a[3] + (b[3] - a[3]) * f;
  }
  // alpha track
  let j = 0;
  while (j < ak.length && ak[j][0] < t) j++;
  if (j === 0) out[3] = ak[0][1];
  else if (j >= ak.length) out[3] = ak[ak.length - 1][1];
  else if (fixed) out[3] = ak[j][1];
  else { const a = ak[j - 1], b = ak[j], d = b[0] - a[0], f = d > 0 ? (t - a[0]) / d : 1; out[3] = a[1] + (b[1] - a[1]) * f; }
  return out;
}

/** A gradient baked to LUT_N RGBA samples over 0…1 (blend mode; a fixed gradient is evaluated exactly). */
export class GradientLut {
  constructor(g) {
    this.g = g;
    this.fixed = !!g && g.mode === 'fixed';
    this.t = new Float32Array(LUT_N * 4);
    const c = [1, 1, 1, 1];
    for (let i = 0; i < LUT_N; i++) {
      evalGradient(g, i / (LUT_N - 1), c);
      this.t.set(c, i * 4);
    }
  }

  at(t, out) {
    if (this.fixed) return evalGradient(this.g, t, out);
    const tab = this.t, n = LUT_N - 1;
    if (!(t > 0)) { out[0] = tab[0]; out[1] = tab[1]; out[2] = tab[2]; out[3] = tab[3]; return out; }
    if (t >= 1) { const o = n * 4; out[0] = tab[o]; out[1] = tab[o + 1]; out[2] = tab[o + 2]; out[3] = tab[o + 3]; return out; }
    const x = t * n, i = x | 0, f = x - i, o = i * 4;
    out[0] = tab[o] + (tab[o + 4] - tab[o]) * f;
    out[1] = tab[o + 1] + (tab[o + 5] - tab[o + 1]) * f;
    out[2] = tab[o + 2] + (tab[o + 6] - tab[o + 2]) * f;
    out[3] = tab[o + 3] + (tab[o + 7] - tab[o + 3]) * f;
    return out;
  }
}

/** MinMaxGradient modes (Unity's ParticleSystemGradientMode). */
export const MG = Object.freeze({ COLOR: 0, GRADIENT: 1, TWO_COLORS: 2, TWO_GRADIENTS: 3, RANDOM: 4 });

const isColor = (v) => Array.isArray(v) && v.length >= 3 && v.every(finite);
const rgba = (v) => [v[0], v[1], v[2], finite(v[3]) ? v[3] : 1];
const _ca = [1, 1, 1, 1], _cb = [1, 1, 1, 1];

/** A MinMaxGradient (see the header). */
export class MinMaxColor {
  constructor(v) {
    this.mode = MG.COLOR;
    this.c = [1, 1, 1, 1];
    this.min = null; this.max = null; this.a = null; this.b = null;
    if (isColor(v)) this.c = rgba(v);
    else if (isObj(v)) {
      if (isColor(v.min) && isColor(v.max)) { this.mode = MG.TWO_COLORS; this.min = rgba(v.min); this.max = rgba(v.max); }
      else if (isObj(v.gradient)) { this.mode = MG.GRADIENT; this.a = new GradientLut(v.gradient); }
      else if (isObj(v.minGradient) && isObj(v.maxGradient)) { this.mode = MG.TWO_GRADIENTS; this.a = new GradientLut(v.minGradient); this.b = new GradientLut(v.maxGradient); }
      else if (isObj(v.random)) { this.mode = MG.RANDOM; this.a = new GradientLut(v.random); }
    }
  }

  /** Colour at normalised time t with the particle's random r into out (r, g, b, a). */
  at(t, r, out) {
    switch (this.mode) {
      case MG.COLOR: out[0] = this.c[0]; out[1] = this.c[1]; out[2] = this.c[2]; out[3] = this.c[3]; return out;
      case MG.TWO_COLORS: {
        const a = this.min, b = this.max;
        out[0] = a[0] + (b[0] - a[0]) * r; out[1] = a[1] + (b[1] - a[1]) * r;
        out[2] = a[2] + (b[2] - a[2]) * r; out[3] = a[3] + (b[3] - a[3]) * r;
        return out;
      }
      case MG.GRADIENT: return this.a.at(t, out);
      case MG.RANDOM: return this.a.at(r, out);
      default: {
        this.a.at(t, _ca); this.b.at(t, _cb);
        out[0] = _ca[0] + (_cb[0] - _ca[0]) * r; out[1] = _ca[1] + (_cb[1] - _ca[1]) * r;
        out[2] = _ca[2] + (_cb[2] - _ca[2]) * r; out[3] = _ca[3] + (_cb[3] - _ca[3]) * r;
        return out;
      }
    }
  }

  /** True when the colour is the same for every particle and time (Color mode). */
  get constant() { return this.mode === MG.COLOR; }
}
