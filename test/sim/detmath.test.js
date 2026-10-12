// server/sim/detmath.js — the sim's engine-independent math (hypot, powi, sin, cos, atan2). The functions use only
// + − × ÷ and Math.sqrt, so their results are the same bits on every engine; the digests below pin them (the same
// digests hold in Chrome, Firefox and Safari). Also: the special values of ECMA-262, powi correctly rounded and hypot
// within 1 ulp against exact BigInt references, and no sim file calls an implementation-approximated Math function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hypot, powi, sin, cos, atan2 } from '../../server/sim/detmath.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const WORDS = new Uint32Array(2), F = new Float64Array(WORDS.buffer);
/** FNV-1a over the IEEE 754 bits of the values */
const digest = (values) => {
  let h = 0x811c9dc5;
  for (const v of values) { F[0] = v; for (const w of WORDS) for (let k = 0; k < 4; k++) { h ^= (w >>> (8 * k)) & 0xff; h = Math.imul(h, 16777619); } }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const N = 20000;

test('the results are pinned bit for bit (engine-independent digests)', () => {
  const runs = {
    hypot: () => { const r = lcg(1); return Array.from({ length: N }, () => hypot((r() * 2 - 1) * 20, (r() < 0.3 ? 0 : (r() * 2 - 1) * 20))); },
    powi: () => { const r = lcg(2); return Array.from({ length: N }, () => powi(r() * 3, Math.floor(r() * 41))); },
    sin: () => { const r = lcg(3); return Array.from({ length: N }, () => sin((r() * 2 - 1) * 4 * Math.PI)); },
    cos: () => { const r = lcg(4); return Array.from({ length: N }, () => cos((r() * 2 - 1) * 4 * Math.PI)); },
    atan2: () => { const r = lcg(5); return Array.from({ length: N }, () => atan2((r() * 2 - 1) * 20, (r() * 2 - 1) * 20)); },
  };
  const want = { hypot: '6e3e3a7d', powi: 'f80a3234', sin: '73aedcb1', cos: '51b52432', atan2: 'a0ab93f0' };
  for (const [name, run] of Object.entries(runs)) assert.equal(digest(run()), want[name], name);
});

test('values that tell the engines apart', () => {
  // V8's Math.hypot(3, 2) is 3.6055512754639896; correctly rounded √13 is 3.605551275463989 (also Firefox, Safari)
  assert.equal(hypot(3, 2), 3.605551275463989);
  // fdlibm (Node 24–26); Chrome 154's correctly rounded Math.sin / Math.atan2 give 0.7931254945086103 / 0.6023179867387402
  assert.equal(sin(2.22566898269194), 0.7931254945086104);
  assert.equal(cos(0.74090688893123), 0.7378567508940902);
  assert.equal(atan2(0.5098986645868919, 0.74162210852462), 0.6023179867387403);
  // correctly rounded; Safari's Math.pow squares and multiplies in double and gives 2.593742460100002
  assert.equal(powi(1.1, 10), 2.5937424601000023);
  assert.equal(powi(0.85, 3), 0.6141249999999999);
});

test('special values follow ECMA-262', () => {
  const same = (a, b, msg) => assert.ok(Object.is(a, b), `${msg}: ${a} vs ${b}`);
  for (const [x, y, want] of [[Infinity, NaN, Infinity], [NaN, -Infinity, Infinity], [NaN, 1, NaN], [0, 0, 0], [-0, -0, 0], [0, -2, 2], [-3, 0, 3]]) same(hypot(x, y), want, `hypot(${x}, ${y})`);
  for (const x of [0, -0]) { same(sin(x), x, 'sin ±0'); same(cos(x), 1, 'cos ±0'); }
  for (const x of [Infinity, -Infinity, NaN]) { same(sin(x), NaN, `sin(${x})`); same(cos(x), NaN, `cos(${x})`); }
  const P = Math.PI, H = Math.PI / 2, Q = Math.PI / 4;
  const table = [
    [0, 1, 0], [-0, 1, -0], [0, -1, P], [-0, -1, -P], [0, 0, 0], [-0, 0, -0], [0, -0, P], [-0, -0, -P],
    [1, 0, H], [-1, 0, -H], [1, -0, H], [-1, -0, -H],
    [1, Infinity, 0], [-1, Infinity, -0], [1, -Infinity, P], [-1, -Infinity, -P],
    [Infinity, 1, H], [-Infinity, 1, -H], [Infinity, Infinity, Q], [-Infinity, Infinity, -Q], [Infinity, -Infinity, 3 * Q], [-Infinity, -Infinity, -3 * Q],
    [NaN, 1, NaN], [1, NaN, NaN], [1, 1, Q], [-1, -1, -3 * Q],
  ];
  for (const [y, x, want] of table) same(atan2(y, x), want, `atan2(${y}, ${x})`);
  same(powi(2, 0), 1, 'x^0'); same(powi(0, 0), 1, '0^0'); same(powi(0, 3), 0, '0^3'); same(powi(-2, 3), -8, '(-2)^3');
  same(powi(2, -2), 0.25, 'x^-n'); same(powi(Infinity, 2), Infinity, '∞²'); same(powi(NaN, 0), 1, 'NaN^0');
  // a zero base: Math.pow's exact results, the sign of −0 kept by odd powers
  for (const z of [0, -0]) for (let n = -3; n <= 3; n++) same(powi(z, n), Math.pow(z, n), `(${Object.is(z, -0) ? '-0' : '0'})^${n}`);
});

// exact references: x = M·2^E with M an integer
const DV = new DataView(new ArrayBuffer(8));
const decompose = (x) => {
  DV.setFloat64(0, Math.abs(x));
  const hiw = DV.getUint32(0), low = DV.getUint32(4), be = (hiw >>> 20) & 0x7ff;
  const M = (BigInt(hiw & 0xfffff) << 32n) | BigInt(low);
  return be === 0 ? [M, -1074] : [M | (1n << 52n), be - 1075];
};
const bitlen = (n) => n.toString(2).length;
/** round M·2^e (M > 0) to the nearest double, ties to even; `sticky` = the true value is a little above M·2^e */
const roundBig = (M, e, sticky = false) => {
  const L = bitlen(M);
  if (L <= 53 && !sticky) return Number(M) * 2 ** e;
  const sh = BigInt(Math.max(0, L - 53));
  let q = M >> sh;
  const rem = M & ((1n << sh) - 1n), half = sh > 0n ? 1n << (sh - 1n) : 0n;
  if (rem > half || (rem === half && (sticky || (q & 1n)))) q++;
  return Number(q) * 2 ** (e + Number(sh));
};
const isqrt = (n) => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); for (;;) { const y = (x + n / x) >> 1n; if (y >= x) { while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; } x = y; } };
const exactHypot = (x, y) => {
  if (x === 0 || y === 0) return Math.abs(x || y);
  const [mx, ex] = decompose(x), [my, ey] = decompose(y), E = Math.min(ex, ey);
  const S = (mx * mx << BigInt(2 * (ex - E))) + (my * my << BigInt(2 * (ey - E)));
  const k = Math.max(0, Math.ceil((130 - bitlen(S)) / 2));
  const q = isqrt(S << BigInt(2 * k));
  return roundBig(q, E - k, q * q !== S << BigInt(2 * k));
};
const exactPowi = (x, n) => { if (n === 0) return 1; const [M, E] = decompose(x); return roundBig(M ** BigInt(n), E * n); };
const ORD = new BigInt64Array(F.buffer);
const ulps = (a, b) => { F[0] = a; const ia = ORD[0]; F[0] = b; return Number(ia - ORD[0]); };

test('powi is correctly rounded (exact BigInt reference)', () => {
  for (let b = 1; b <= 300; b++) for (let n = 0; n <= 24; n++) {
    const x = b / 100;
    assert.equal(powi(x, n), exactPowi(x, n), `${x}^${n}`);
  }
});

test('hypot is within 1 ulp of √(x² + y²), and symmetric', () => {
  const r = lcg(7);
  for (let i = 0; i < 3000; i++) {
    const x = (r() * 2 - 1) * 20, y = (r() * 2 - 1) * 20;
    assert.ok(Math.abs(ulps(hypot(x, y), exactHypot(x, y))) <= 1, `hypot(${x}, ${y})`);
    assert.equal(hypot(x, y), hypot(y, x)); assert.equal(hypot(-x, y), hypot(x, y));
  }
  for (const s of [1e300, 1e-300]) assert.ok(Math.abs(ulps(hypot(3 * s, 4 * s), 5 * s)) <= 1, `rescaled ${s}`);
});

test('sin, cos and atan2 stay within 2 ulp of the engine and keep their symmetries', () => {
  const r = lcg(9);
  for (let i = 0; i < 20000; i++) {
    const x = (r() * 2 - 1) * 10;
    assert.ok(Math.abs(ulps(sin(x), Math.sin(x))) <= 2 && Math.abs(ulps(cos(x), Math.cos(x))) <= 2, `x = ${x}`);
    assert.ok(Object.is(sin(-x), -sin(x)) && Object.is(cos(-x), cos(x)), `symmetry at ${x}`);
    const y = (r() * 2 - 1) * 10;
    assert.ok(Math.abs(ulps(atan2(y, x), Math.atan2(y, x))) <= 2, `atan2(${y}, ${x})`);
    assert.ok(Object.is(atan2(-y, x), -atan2(y, x)), `atan2 odd in y at (${y}, ${x})`);
  }
});

test('the sim never calls an implementation-approximated Math function', () => {
  const APPROX = /\bMath\s*\.\s*(acos|acosh|asin|asinh|atan|atanh|atan2|cbrt|cos|cosh|exp|expm1|hypot|log|log1p|log10|log2|pow|sin|sinh|tan|tanh)\b/;
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); } };
  walk(join(ROOT, 'server/sim'));
  assert.ok(files.length > 50);
  const bad = [];
  for (const f of files) {
    const rel = relative(ROOT, f).replaceAll('\\', '/');
    if (rel === 'server/sim/detmath.js') continue;
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (APPROX.test(code)) bad.push(`${rel}: ${code.match(APPROX)[0]}`);
  }
  assert.deepEqual(bad, [], 'use server/sim/detmath.js');
});
