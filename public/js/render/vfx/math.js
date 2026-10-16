// render/vfx/math.js — the small 3D math of the official battle effects (DESIGN §33.2), in Unity's conventions:
// left-handed axes, quaternions (x, y, z, w), Euler degrees applied as Quaternion.Euler (about Z, then X, then Y:
// q = qy · qx · qz), TRS matrices T · R · S. Matrices are column-major Float32Array(16) (WebGL's layout).
//
// Frames: effects are built in the battle's Unity frame (x = column − 10, y = row − 9, z = −height); the board frame
// of render/projection.js is (x = column, y = row, z = height). `unityToBoard` is the map between them:
// C = diag(1, 1, −1) plus the centre's translation (C is its own inverse; it flips winding — DESIGN §33.2).
// Pure math, no allocation in the per-particle helpers (they write into `out`).

export const DEG = Math.PI / 180;

/** Column / row of the Unity frame's origin on the board (projection.js OFFICIAL.center). */
export const UNITY_ORIGIN = Object.freeze([10, 9]);

/** A Unity battle-frame point as a board point (x = col, y = row, z = height). */
export function unityToBoard(x, y, z, out = [0, 0, 0]) {
  out[0] = x + UNITY_ORIGIN[0]; out[1] = y + UNITY_ORIGIN[1]; out[2] = -z;
  return out;
}

/** A board point as a Unity battle-frame point. */
export function boardToUnity(x, y, z, out = [0, 0, 0]) {
  out[0] = x - UNITY_ORIGIN[0]; out[1] = y - UNITY_ORIGIN[1]; out[2] = -z;
  return out;
}

// ---- quaternions ---------------------------------------------------------------------------------------------------

export function quat(x = 0, y = 0, z = 0, w = 1) { return [x, y, z, w]; }

/** a · b (apply b first, then a) into out. */
export function quatMul(a, b, out = [0, 0, 0, 1]) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function quatNormalize(q, out = q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  out[0] = q[0] / l; out[1] = q[1] / l; out[2] = q[2] / l; out[3] = q[3] / l;
  return out;
}

/** Unity's Quaternion.Euler(x, y, z) (degrees): rotate about Z, then X, then Y. */
export function quatEuler(x, y, z, out = [0, 0, 0, 1]) {
  const hx = x * DEG / 2, hy = y * DEG / 2, hz = z * DEG / 2;
  const cx = Math.cos(hx), sx = Math.sin(hx), cy = Math.cos(hy), sy = Math.sin(hy), cz = Math.cos(hz), sz = Math.sin(hz);
  // qy · qx · qz
  out[0] = cy * sx * cz + sy * cx * sz;
  out[1] = sy * cx * cz - cy * sx * sz;
  out[2] = cy * cx * sz - sy * sx * cz;
  out[3] = cy * cx * cz + sy * sx * sz;
  return out;
}

/** Rotation of `rad` radians about a unit axis. */
export function quatAxis(ax, ay, az, rad, out = [0, 0, 0, 1]) {
  const s = Math.sin(rad / 2);
  out[0] = ax * s; out[1] = ay * s; out[2] = az * s; out[3] = Math.cos(rad / 2);
  return out;
}

/** Rotate vector v by unit quaternion q into out. */
export function quatRotate(q, v, out = [0, 0, 0]) {
  const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  // t = 2 · cross(q.xyz, v); v' = v + w·t + cross(q.xyz, t)
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

// ---- 4×4 matrices (column-major) -----------------------------------------------------------------------------------

export function mat4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function mat4Identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }

/** T(p) · R(q) · S(s) into out. */
export function mat4Trs(p, q, s, out = mat4()) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
  return out;
}

/** a · b into out (out may alias a or b). */
export function mat4Mul(a, b, out = mat4()) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

export function mat4Copy(src, out) { out.set(src); return out; }

/** Inverse of an affine matrix (rotation · scale + translation) into out; identity when singular. */
export function mat4InvertAffine(m, out = mat4()) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12)) return mat4Identity(out);
  const k = 1 / det;
  const r00 = A * k, r01 = -(b * i - c * h) * k, r02 = (b * f - c * e) * k;
  const r10 = B * k, r11 = (a * i - c * g) * k, r12 = -(a * f - c * d) * k;
  const r20 = C * k, r21 = -(a * h - b * g) * k, r22 = (a * e - b * d) * k;
  const tx = m[12], ty = m[13], tz = m[14];
  out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
  out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
  out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
  out[12] = -(r00 * tx + r10 * ty + r20 * tz);
  out[13] = -(r01 * tx + r11 * ty + r21 * tz);
  out[14] = -(r02 * tx + r12 * ty + r22 * tz);
  out[15] = 1;
  return out;
}

/** m · (x, y, z, 1) into out (offset o). */
export function mat4Point(m, x, y, z, out, o = 0) {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** m · (x, y, z, 0) into out (offset o). */
export function mat4Dir(m, x, y, z, out, o = 0) {
  out[o] = m[0] * x + m[4] * y + m[8] * z;
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z;
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

/** The scale of each basis column (lossy scale) into out. */
export function mat4Scale(m, out = [1, 1, 1]) {
  out[0] = Math.hypot(m[0], m[1], m[2]); out[1] = Math.hypot(m[4], m[5], m[6]); out[2] = Math.hypot(m[8], m[9], m[10]);
  // a mirrored basis (negative determinant) keeps the sign on x
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) out[0] = -out[0];
  return out;
}

/** The rotation of an affine matrix as a quaternion (the scale removed). */
export function mat4Rotation(m, out = [0, 0, 0, 1]) {
  const s = mat4Scale(m, _s3);
  const sx = s[0] || 1, sy = s[1] || 1, sz = s[2] || 1;
  const m00 = m[0] / sx, m01 = m[1] / sx, m02 = m[2] / sx;
  const m10 = m[4] / sy, m11 = m[5] / sy, m12 = m[6] / sy;
  const m20 = m[8] / sz, m21 = m[9] / sz, m22 = m[10] / sz;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1);
    out[3] = 0.25 / k; out[0] = (m12 - m21) * k; out[1] = (m20 - m02) * k; out[2] = (m01 - m10) * k;
  } else if (m00 > m11 && m00 > m22) {
    const k = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out[3] = (m12 - m21) / k; out[0] = 0.25 * k; out[1] = (m10 + m01) / k; out[2] = (m20 + m02) / k;
  } else if (m11 > m22) {
    const k = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out[3] = (m20 - m02) / k; out[0] = (m10 + m01) / k; out[1] = 0.25 * k; out[2] = (m21 + m12) / k;
  } else {
    const k = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out[3] = (m01 - m10) / k; out[0] = (m20 + m02) / k; out[1] = (m21 + m12) / k; out[2] = 0.25 * k;
  }
  return quatNormalize(out);
}
const _s3 = [1, 1, 1];

// ---- vectors -------------------------------------------------------------------------------------------------------

export function vlen(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

export function normalize3(v, o = 0) {
  const l = Math.sqrt(v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]);
  if (l > 1e-12) { v[o] /= l; v[o + 1] /= l; v[o + 2] /= l; }
  return v;
}

export function cross3(ax, ay, az, bx, by, bz, out, o = 0) {
  out[o] = ay * bz - az * by; out[o + 1] = az * bx - ax * bz; out[o + 2] = ax * by - ay * bx;
  return out;
}
