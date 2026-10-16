// render/vfx/clips.js — Animator / legacy Animation clips of the official battle effects (DESIGN §33.10): the decoded
// keyframes of a clip sampled at the clip time and applied to the effect instance's nodes, renderers and systems.
//
//   const c = compileClip(clip)               the curves grouped by target (shared per descriptor)
//   sampleClip(c, t, sink)                     evaluates every curve at clip time t (looping clips wrap at `length`,
//                                              others hold their end values) and hands the values to `sink`:
//     sink.transform(node, pos | null, rot | null, scale | null, euler | null)   per node, only the animated axes are
//                                              numbers (NaN = keep the node's own value); rot is a quaternion
//     sink.active(node, on)                    GameObject.m_IsActive (> 0.5)
//     sink.material(node, type, prop, comp, v) a renderer's material property (comp: 0–3 for r g b a / x y z w, −1 float)
//     sink.renderer(node, type, path, v)       a Trail / Line renderer field (m_Parameters.widthMultiplier, m_Time …)
//     sink.system(node, path, v)               a ParticleSystem field ('EmissionModule.rateOverTime.scalar' …)
//   clipTime(c, t)                             the sampled time for an elapsed time t (wrap / hold)
//   quatToEuler(q, out)                        Unity's Euler angles (degrees, Z X Y order) of a quaternion
//
// Curves on objects the prefab lacks (`node: null`) and MonoBehaviour fields are skipped, like Unity does with
// unresolved bindings.

import { evalCurve } from './curves.js';

const COMP = { r: 0, g: 1, b: 2, a: 3, x: 0, y: 1, z: 2, w: 3 };
const RENDERERS = new Set(['MeshRenderer', 'ParticleSystemRenderer', 'TrailRenderer', 'LineRenderer', 'SkinnedMeshRenderer', 'SpriteRenderer']);

/** Group a clip's curves by target. */
export function compileClip(clip) {
  const length = Math.max(0, Number(clip?.length) || 0);
  const wrap = Number(clip?.wrapMode) || 0;
  const out = {
    name: clip?.name || '', length, loop: !!clip?.loop || wrap === 2, pingPong: wrap === 4, legacy: !!clip?.legacy,
    nodes: new Map(),  // node → { pos: [k|null ×3], rot: [k|null ×4], euler: [k|null ×3], scale: [k|null ×3] }
    active: [],        // { node, keys }
    material: [],      // { node, type, prop, comp, keys }
    renderer: [],      // { node, type, path, keys }
    system: [],        // { node, path, keys }
  };
  for (const cv of Array.isArray(clip?.curves) ? clip.curves : []) {
    if (cv.node == null || !Array.isArray(cv.keys) || !cv.keys.length) continue;
    const p = String(cv.property || '');
    if (cv.type === 'Transform') {
      const m = /^(localPosition|localRotation|localEulerAnglesRaw|localEulerAngles|localEulerAnglesBaked|localScale)\.([xyzw])$/.exec(p);
      if (!m) continue;
      let t = out.nodes.get(cv.node);
      if (!t) { t = { pos: [null, null, null], rot: [null, null, null, null], euler: [null, null, null], scale: [null, null, null] }; out.nodes.set(cv.node, t); }
      const slot = m[1] === 'localPosition' ? t.pos : m[1] === 'localRotation' ? t.rot : m[1] === 'localScale' ? t.scale : t.euler;
      slot[COMP[m[2]]] = cv.keys;
    } else if (cv.type === 'GameObject' && p === 'm_IsActive') {
      out.active.push({ node: cv.node, keys: cv.keys });
    } else if (RENDERERS.has(cv.type) && p.startsWith('material.')) {
      const m = /^material\.([^.]+)(?:\.([rgbaxyzw]))?$/.exec(p);
      if (m) out.material.push({ node: cv.node, type: cv.type, prop: m[1], comp: m[2] ? COMP[m[2]] : -1, keys: cv.keys });
    } else if (RENDERERS.has(cv.type)) {
      out.renderer.push({ node: cv.node, type: cv.type, path: p, keys: cv.keys });
    } else if (cv.type === 'ParticleSystem') {
      out.system.push({ node: cv.node, path: p, keys: cv.keys });
    }
  }
  return out;
}

/** The clip time sampled for an elapsed time t. */
export function clipTime(c, t) {
  if (!(c.length > 0)) return 0;
  if (c.pingPong) { const x = ((t % (2 * c.length)) + 2 * c.length) % (2 * c.length); return x > c.length ? 2 * c.length - x : x; }
  if (c.loop) return ((t % c.length) + c.length) % c.length;
  return Math.min(Math.max(0, t), c.length);
}

const _pos = [NaN, NaN, NaN], _rot = [NaN, NaN, NaN, NaN], _eul = [NaN, NaN, NaN], _scl = [NaN, NaN, NaN];

const fill = (dst, keysArr, t) => {
  let any = false;
  for (let i = 0; i < keysArr.length; i++) {
    const k = keysArr[i];
    if (k) { dst[i] = evalCurve(k, t); any = true; } else dst[i] = NaN;
  }
  return any;
};

/** Sample every curve of compiled clip c at elapsed time t into the sink (see the header). */
export function sampleClip(c, t, sink) {
  const ct = clipTime(c, t);
  for (const [node, tr] of c.nodes) {
    const hp = fill(_pos, tr.pos, ct), hr = fill(_rot, tr.rot, ct), he = fill(_eul, tr.euler, ct), hs = fill(_scl, tr.scale, ct);
    if (hr) {
      // a quaternion track: normalise the animated components with the node's own for the rest (done by the sink)
      sink.transform(node, hp ? _pos : null, _rot, hs ? _scl : null, null);
    } else sink.transform(node, hp ? _pos : null, null, hs ? _scl : null, he ? _eul : null);
  }
  for (const a of c.active) sink.active(a.node, evalCurve(a.keys, ct) > 0.5);
  for (const m of c.material) sink.material(m.node, m.type, m.prop, m.comp, evalCurve(m.keys, ct));
  for (const r of c.renderer) sink.renderer(r.node, r.type, r.path, evalCurve(r.keys, ct));
  for (const s of c.system) sink.system(s.node, s.path, evalCurve(s.keys, ct));
}

/** Unity's Euler angles (degrees) of quaternion q (rotation = Ry · Rx · Rz) into out [x, y, z]. */
export function quatToEuler(q, out = [0, 0, 0]) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  // matrix elements of the rotation (column-vector convention)
  const m12 = 2 * (y * z - w * x);
  const m02 = 2 * (x * z + w * y), m22 = 1 - 2 * (x * x + y * y);
  const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z);
  const sx = Math.max(-1, Math.min(1, -m12));
  const R = 180 / Math.PI;
  out[0] = Math.asin(sx) * R;
  if (Math.abs(sx) < 0.99999) {
    out[1] = Math.atan2(m02, m22) * R;
    out[2] = Math.atan2(m10, m11) * R;
  } else {
    // gimbal lock: put the whole turn on y
    const m00 = 1 - 2 * (y * y + z * z), m20 = 2 * (x * z - w * y);
    out[1] = Math.atan2(-m20, m00) * R;
    out[2] = 0;
  }
  return out;
}
