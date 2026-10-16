// test/render/vfx-curves.test.js — the official effects' value encodings (render/vfx/curves.js, DESIGN §33.3):
// AnimationCurve (Hermite, stepped, weighted, clamping), the baked lookups, MinMaxCurve modes, Gradient (blend /
// fixed) and MinMaxGradient modes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evalCurve, bakeCurve, lut, MinMax, MM, evalGradient, GradientLut, MinMaxColor, MG } from '../../public/js/render/vfx/curves.js';

const near = (a, b, eps = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

describe('AnimationCurve', () => {
  test('a linear key pair (slopes 1) is the identity between the keys and clamps outside', () => {
    const k = [[0, 0, 1, 1], [1, 1, 1, 1]];
    for (const t of [0, 0.25, 0.5, 0.9, 1]) near(evalCurve(k, t), t);
    assert.equal(evalCurve(k, -1), 0);
    assert.equal(evalCurve(k, 3), 1);
  });

  test('cubic Hermite with flat tangents eases (smoothstep)', () => {
    const k = [[0, 0, 0, 0], [2, 1, 0, 0]];
    near(evalCurve(k, 1), 0.5);
    near(evalCurve(k, 0.5), 3 * 0.25 ** 2 - 2 * 0.25 ** 3);
  });

  test('tangents scale with the segment length (outSlope · Δt)', () => {
    // value 0 → 0 with slope 4 out of the first key over Δt = 0.5: h(s) = (s³ − 2s² + s)·2 at s = 0.5 → 0.25
    const k = [[0, 0, 0, 4], [0.5, 0, 0, 0]];
    near(evalCurve(k, 0.25), 0.25);
  });

  test('a null slope on either side holds the earlier key (stepped)', () => {
    assert.equal(evalCurve([[0, 2, 0, null], [1, 5, 0, 0]], 0.99), 2);
    assert.equal(evalCurve([[0, 2, 0, 0], [1, 5, null, 0]], 0.5), 2);
    assert.equal(evalCurve([[0, 2, 0, null], [1, 5, 0, 0]], 1), 5);
  });

  test('weighted keys follow the Bézier form (weights 1/3 = the Hermite curve)', () => {
    const plain = [[0, 0, 0, 2], [1, 1, 0, 0]];
    const third = [[0, 0, 0, 2, 2, 1 / 3, 1 / 3], [1, 1, 0, 0, 1, 1 / 3, 1 / 3]];
    for (const t of [0.1, 0.3, 0.6, 0.85]) near(evalCurve(third, t), evalCurve(plain, t), 2e-3, `t=${t}`);
    // heavier out weight pulls the curve further along the tangent early on
    const heavy = [[0, 0, 0, 2, 2, 0, 0.8], [1, 1, 0, 0, 0, 0, 0]];
    assert.ok(evalCurve(heavy, 0.2) > evalCurve(third, 0.2));
  });

  test('a single key is a constant; no keys read 0', () => {
    assert.equal(evalCurve([[0.3, 7, 0, 0]], 0.9), 7);
    assert.equal(evalCurve([], 0.5), 0);
  });

  test('bakeCurve + lut reproduce the curve within a fraction of a percent', () => {
    const k = [[0, 1, -1, -1.60248], [0.236561, 0.620915, -1.60248, 1.26444], [0.455086, 0.897226, 1.26444, -1.64654], [1, 0, -1.64654, -1]];
    const tab = bakeCurve(k);
    for (let i = 0; i <= 50; i++) { const t = i / 50; near(lut(tab, t), evalCurve(k, t), 6e-3, `t=${t}`); }
    assert.equal(lut(tab, -0.5), tab[0]);
    assert.equal(lut(tab, 2), tab[tab.length - 1]);
  });
});

describe('MinMaxCurve', () => {
  test('Constant / TwoConstants / Curve / TwoCurves', () => {
    const c = new MinMax(3);
    assert.equal(c.mode, MM.CONST);
    assert.equal(c.at(0.7, 0.2), 3);
    assert.ok(c.constant);
    const two = new MinMax({ min: 1, max: 5 });
    assert.equal(two.mode, MM.TWO_CONST);
    assert.equal(two.at(0, 0), 1);
    assert.equal(two.at(0, 1), 5);
    assert.equal(two.at(0.9, 0.5), 3);
    assert.equal(two.peak, 5);
    const cur = new MinMax({ scalar: 2, curve: [[0, 0, 1, 1], [1, 1, 1, 1]] });
    assert.equal(cur.mode, MM.CURVE);
    near(cur.at(0.5, 0.9), 1);
    near(cur.peak, 2);
    const tc = new MinMax({ scalar: 10, minCurve: [[0, 0, 0, 0], [1, 0, 0, 0]], maxCurve: [[0, 1, 0, 0], [1, 1, 0, 0]] });
    assert.equal(tc.mode, MM.TWO_CURVES);
    near(tc.at(0.3, 0.25), 2.5);
  });

  test('unknown encodings read as the fallback constant', () => {
    assert.equal(new MinMax(null, 4).at(0.5, 0.5), 4);
    assert.equal(new MinMax({ weird: 1 }, 2).at(0.5, 0.5), 2);
  });
});

describe('Gradient / MinMaxGradient', () => {
  const g = { mode: 'blend', color: [[0, 1, 0, 0], [1, 0, 0, 1]], alpha: [[0, 1], [0.5, 0], [1, 1]] };

  test('blend interpolates colour and alpha keys separately and clamps outside', () => {
    const c = evalGradient(g, 0.5);
    near(c[0], 0.5); near(c[2], 0.5); near(c[3], 0);
    near(evalGradient(g, 0.25)[3], 0.5);
    assert.deepEqual(evalGradient(g, -1), [1, 0, 0, 1]);
    assert.deepEqual(evalGradient(g, 2), [0, 0, 1, 1]);
  });

  test("fixed holds the first key at or after t (Unity's fixed mode)", () => {
    const f = { mode: 'fixed', color: [[0.3, 1, 0, 0], [0.7, 0, 1, 0]], alpha: [[0.5, 0.2], [1, 0.9]] };
    assert.deepEqual(evalGradient(f, 0.1).slice(0, 3), [1, 0, 0]);
    assert.deepEqual(evalGradient(f, 0.31).slice(0, 3), [0, 1, 0]);
    assert.equal(evalGradient(f, 0.5)[3], 0.2);
    assert.equal(evalGradient(f, 0.51)[3], 0.9);
  });

  test('GradientLut matches the exact evaluation', () => {
    const L = new GradientLut(g);
    const out = [0, 0, 0, 0];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      L.at(t, out);
      const e = evalGradient(g, t);
      for (let k = 0; k < 4; k++) near(out[k], e[k], 2e-2, `t=${t} k=${k}`);
    }
  });

  test('MinMaxGradient modes', () => {
    const out = [0, 0, 0, 0];
    const col = new MinMaxColor([0.2, 0.4, 0.6, 0.8]);
    assert.equal(col.mode, MG.COLOR);
    assert.deepEqual(col.at(0.5, 0.5, out).map((x) => Math.round(x * 10) / 10), [0.2, 0.4, 0.6, 0.8]);
    const two = new MinMaxColor({ min: [0, 0, 0, 0], max: [1, 1, 1, 1] });
    assert.equal(two.mode, MG.TWO_COLORS);
    assert.deepEqual(two.at(0, 0.25, out), [0.25, 0.25, 0.25, 0.25]);
    const gr = new MinMaxColor({ gradient: g });
    assert.equal(gr.mode, MG.GRADIENT);
    near(gr.at(0.5, 0.9, out)[0], 0.5, 2e-2);
    const tg = new MinMaxColor({ minGradient: { color: [[0, 0, 0, 0]], alpha: [[0, 0]] }, maxGradient: { color: [[0, 1, 1, 1]], alpha: [[0, 1]] } });
    assert.equal(tg.mode, MG.TWO_GRADIENTS);
    near(tg.at(0.3, 0.5, out)[1], 0.5, 1e-6);
    const rnd = new MinMaxColor({ random: g });
    assert.equal(rnd.mode, MG.RANDOM);
    near(rnd.at(0.99, 0, out)[0], 1, 1e-6); // the random point picks the gradient position
  });
});
