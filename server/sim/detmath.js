// server/sim/detmath.js — engine-independent math for the sim. Every function here gives the same bits on every
// conforming JavaScript engine.
//
// ECMA-262 lets Math.hypot, sin, cos, atan2, pow (and **) return "implementation-approximated" values, and the engines
// differ in the last bits: V8's hypot is not the one of SpiderMonkey (fdlibm) or JavaScriptCore (sqrt(x*x + y*y));
// Chrome 154's sin / cos / atan2 are correctly rounded while Node 24–26's are fdlibm's; JavaScriptCore computes an
// integer power by repeated squaring. + − × ÷ and Math.sqrt are correctly rounded IEEE 754 operations, and the language
// fuses nothing (no FMA, no extended precision), so code built only from them is reproducible bit for bit. That is
// what these functions are. The sim must not call the approximated Math functions (eslint.config.js, and
// test/sim/detmath.test.js scans server/sim/).
//
//   hypot(x, y)         √(x² + y²) as Math.sqrt(x*x + y*y), rescaled by exact powers of two outside 2^±500
//   roundHalfEven(x)    nearest integer, ties to even (四舍六入五成双); Math.round and Math.floor, never −0
//   powi(x, n)          xⁿ for an integer n: square-and-multiply in double-double, one final rounding
//   sin(x), cos(x)      fdlibm 5.3 (__kernel_sin / __kernel_cos / __ieee754_rem_pio2)
//   atan2(y, x)         fdlibm (FreeBSD msun e_atan2.c / s_atan.c)
//
// sin / cos / atan2 are the algorithms V8 runs in Node, so they return what the server always computed (its golden
// digests stay); hypot and powi are at least as accurate as V8's. ±∞ / NaN arguments take the exactly specified
// results of the Math functions.

const F64 = new Float64Array(1);
const I32 = new Int32Array(F64.buffer);
const HW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0; // index of the high word
const LW = 1 - HW;
/** @param {number} x */
const hi = (x) => { F64[0] = x; return I32[HW]; };
/** @param {number} x */
const lo = (x) => { F64[0] = x; return I32[LW] >>> 0; };
/** @param {number} h @param {number} l */
const fromWords = (h, l) => { I32[HW] = h; I32[LW] = l; return F64[0]; };
/** exact 2^e for a normal e @param {number} e */
const pow2 = (e) => fromWords((e + 1023) << 20, 0);
const P500 = pow2(500), PM500 = pow2(-500), P600 = pow2(600), PM600 = pow2(-600);

/**
 * √(x² + y²).
 * @param {number} x
 * @param {number} y
 */
export function hypot(x, y) {
  // eslint-disable-next-line no-restricted-properties -- ±∞ / NaN only: those results are exact by the spec
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.hypot(x, y);
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (m > P500) { const a = x * PM600, b = y * PM600; return Math.sqrt(a * a + b * b) * P600; }
  if (m < PM500 && m !== 0) { const a = x * P600, b = y * P600; return Math.sqrt(a * a + b * b) * PM600; }
  return Math.sqrt(x * x + y * y);
}

/**
 * x rounded to an integer, ties to even (2.5 → 2, 3.5 → 4, −2.5 → −2): the rule PRTS 作战机制 gives for the tile of a
 * target — 受击方坐标经round函数取整(四舍六入五成双)得到其所属格坐标. Math.round rounds ties up (2.5 → 3). Exact; never −0.
 * @param {number} x
 */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  if (x - f !== 0.5) return Math.round(x) + 0;
  return (f % 2 === 0 ? f : f + 1) + 0;
}

// ---- integer powers ----------------------------------------------------------------------------------------------

const SPLIT = 134217729; // 2^27 + 1 (Dekker)
const ACC = [0, 0];
const BASE = [0, 0];
/** (ah + al)·(bh + bl) in double-double, into out (TwoProduct by Dekker's split: no FMA) */
function mul2(ah, al, bh, bl, out) {
  const p = ah * bh;
  let t = SPLIT * ah;
  const ahh = t - (t - ah), ahl = ah - ahh;
  t = SPLIT * bh;
  const bhh = t - (t - bh), bhl = bh - bhh;
  const e = ((ahh * bhh - p) + ahh * bhl + ahl * bhh) + ahl * bhl + (ah * bl + al * bh);
  const s = p + e;
  out[0] = s;
  out[1] = e - (s - p);
}

/**
 * xⁿ for an integer n (the sim's powers are stack counts, chain bounces …). The square-and-multiply runs in
 * double-double and rounds once, so the result is correctly rounded in practice; a non-integer exponent or a huge
 * base falls back to Math.pow. A zero base takes Math.pow's exact results: an odd power keeps the sign of −0, which
 * the double-double sum would lose ((−0)¹ = −0, (−0)⁻¹ = −∞).
 * @param {number} x
 * @param {number} n
 */
export function powi(x, n) {
  // eslint-disable-next-line no-restricted-properties -- outside the integer domain only (never in the sim)
  if (!Number.isInteger(n) || !Number.isFinite(x) || Math.abs(x) > P500) return Math.pow(x, n);
  if (x === 0) { const odd = n % 2 !== 0; return n === 0 ? 1 : n > 0 ? (odd ? x : 0) : (odd ? 1 / x : Infinity); }
  if (n < 0) return 1 / powi(x, -n);
  ACC[0] = 1; ACC[1] = 0; BASE[0] = x; BASE[1] = 0;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) mul2(ACC[0], ACC[1], BASE[0], BASE[1], ACC);
    k = Math.floor(k / 2);
    if (k > 0) mul2(BASE[0], BASE[1], BASE[0], BASE[1], BASE);
  }
  return ACC[0] + ACC[1];
}

// ---- sin / cos (fdlibm 5.3) --------------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
/** sin on [-π/4, π/4]; y is the tail of x, iy = 0 when y is 0 */
function kSin(x, y, iy) {
  if ((hi(x) & 0x7fffffff) < 0x3e400000 && Math.trunc(x) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
/** cos on [-π/4, π/4]; y is the tail of x */
function kCos(x, y) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  return (1 - qx) - ((0.5 * z - qx) - (z * r - x * y));
}

const NPIO2_HW = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
  0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A,
  0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
  0x404858EB, 0x404921FB,
];
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const TWO_PI = 6.283185307179586;
const Y = [0, 0];

/** x − n·π/2 into Y (head, tail); returns n. |x| ≤ 2^19·π/2: fdlibm's medium path; beyond that (never in the sim)
 * x is first taken modulo the double nearest 2π (exact %), which stays deterministic though not accurate. */
function remPio2(x0) {
  let x = x0;
  if ((hi(x) & 0x7fffffff) > 0x413921fb) x = x % TWO_PI;
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { Y[0] = x; Y[1] = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3π/4: n = ±1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { Y[0] = z - PIO2_1T; Y[1] = (z - Y[0]) - PIO2_1T; } else { z -= PIO2_2; Y[0] = z - PIO2_2T; Y[1] = (z - Y[0]) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { Y[0] = z + PIO2_1T; Y[1] = (z - Y[0]) + PIO2_1T; } else { z += PIO2_2; Y[0] = z + PIO2_2T; Y[1] = (z - Y[0]) + PIO2_2T; }
    return -1;
  }
  let t = Math.abs(x);
  const n = Math.trunc(t * INV_PIO2 + 0.5);
  let r = t - n * PIO2_1, w = n * PIO2_1T;
  Y[0] = r - w;
  if (!(n < 32 && ix !== NPIO2_HW[n - 1])) {
    const j = ix >> 20;
    if (j - ((hi(Y[0]) >> 20) & 0x7ff) > 16) { // a 2nd step, good to 118 bits
      t = r; w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); Y[0] = r - w;
      if (j - ((hi(Y[0]) >> 20) & 0x7ff) > 49) { // a 3rd, 151 bits
        t = r; w = n * PIO2_3; r = t - w; w = n * PIO2_3T - ((t - r) - w); Y[0] = r - w;
      }
    }
  }
  Y[1] = (r - Y[0]) - w;
  if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
  return n;
}

/** @param {number} x radians */
export function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return kSin(x, 0, 0);
  switch (remPio2(x) & 3) {
    case 0: return kSin(Y[0], Y[1], 1);
    case 1: return kCos(Y[0], Y[1]);
    case 2: return -kSin(Y[0], Y[1], 1);
    default: return -kCos(Y[0], Y[1]);
  }
}

/** @param {number} x radians */
export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return kCos(x, 0);
  switch (remPio2(x) & 3) {
    case 0: return kCos(Y[0], Y[1]);
    case 1: return -kSin(Y[0], Y[1], 1);
    case 2: return -kCos(Y[0], Y[1]);
    default: return kSin(Y[0], Y[1], 1);
  }
}

// ---- atan2 (fdlibm, FreeBSD msun) --------------------------------------------------------------------------------

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];
/** @param {number} x0 */
function atan(x0) {
  let x = x0;
  const hx = hi(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) { // |x| ≥ 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x;
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - ((x * (s1 + s2) - ATAN_LO[id]) - x);
  return hx < 0 ? -r : r;
}

const PI_O_4 = 7.8539816339744827900E-01, PI_O_2 = 1.5707963267948965580E+00, PI = 3.1415926535897931160E+00;
const PI_LO = 1.2246467991473532e-16;
/**
 * The angle of (x, y), in (−π, π].
 * @param {number} y
 * @param {number} x
 */
export function atan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const hx = hi(x), ix = hx & 0x7fffffff, lx = lo(x);
  const hy = hi(y), iy = hy & 0x7fffffff, ly = lo(y);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x = 1
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2·sign(x) + sign(y)
  if ((iy | ly) === 0) return m === 2 ? PI : m === 3 ? -PI : y; // y = ±0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2; // x = ±0
  if (ix === 0x7ff00000) { // x = ±∞
    if (iy === 0x7ff00000) return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m];
    return [0, -0, PI, -PI][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2; // y = ±∞
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { z = PI_O_2 + 0.5 * PI_LO; m &= 1; } // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0; // |y|/x < −2^60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}
