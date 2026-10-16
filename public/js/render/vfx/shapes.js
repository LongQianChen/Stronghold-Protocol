// render/vfx/shapes.js — the ShapeModule of a Unity ParticleSystem (DESIGN §33.5): where a particle is born and the
// direction it starts along, in the system's local space. Unity's geometry: the cone and the hemisphere open along
// the shape's local +Z, the circle / donut / rectangle lie in its local XY plane, the edge runs along local X, the box
// is the unit cube scaled by the shape's own scale; the result goes through the shape's own transform (m_Position,
// m_Rotation as Euler degrees, m_Scale), then randomDirectionAmount / sphericalDirectionAmount / randomPositionAmount.
//
//   const sh = new Shape(module, { mesh: (key) => meshData | null })   (module: node.particleSystem.ShapeModule)
//   sh.sample(rng, ctx, out)   out = { px, py, pz, dx, dy, dz }; ctx = { time (system s), tau (0…1), index, count }
//                              (index / count: the particle's place in its burst — the BurstSpread arc mode)
//
// Cone directions follow Unity's formula: at a base point of radial fraction f the direction is
// normalize(f·sin(angle)·(cos a, sin a), cos(angle)), i.e. tilted atan(f·tan angle) from the axis (90° = radial).
// Mesh shapes emit from a vertex, an edge or a triangle (placementMode 0 / 1 / 2) along the interpolated normal.

import { MinMax } from './curves.js';
import { DEG, quatEuler, mat4Trs, mat4Point, mat4Dir } from './math.js';

const TYPE_BY_ID = Object.freeze({
  0: 'sphere', 1: 'sphere', 2: 'hemisphere', 3: 'hemisphere', 4: 'cone', 5: 'box', 6: 'mesh', 7: 'cone', 8: 'coneVolume',
  9: 'coneVolume', 10: 'circle', 11: 'circle', 12: 'singleSidedEdge', 13: 'meshRenderer', 14: 'skinnedMeshRenderer',
  15: 'boxShell', 16: 'boxEdge', 17: 'donut', 18: 'rectangle', 19: 'sprite', 20: 'spriteRenderer',
});

/** Shell flags of Unity's deprecated ids (SphereShell, HemisphereShell, ConeShell, ConeVolumeShell, CircleEdge). */
const SHELL_IDS = new Set([1, 3, 7, 9, 11]);

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec3 = (v, d) => (Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : d.slice());

/** A MultiModeParameter (`{ value, mode, spread, speed }`) → a sampler of the 0…1 fraction along it. */
class MultiMode {
  constructor(p, value) {
    const o = p && typeof p === 'object' ? p : { value: num(p, value) };
    this.value = num(o.value, value);
    this.mode = num(o.mode, 0) | 0;
    this.spread = Math.max(0, num(o.spread, 0));
    this.speed = new MinMax(o.speed ?? 1, 1);
  }

  /** Fraction 0…1 for a particle (r: its random, ctx: system time and burst place). */
  frac(r, ctx) {
    let u;
    switch (this.mode) {
      case 1: u = ((ctx.time * this.speed.at(ctx.tau, 0)) % 1 + 1) % 1; break;                     // Loop
      case 2: { const x = ((ctx.time * this.speed.at(ctx.tau, 0)) % 2 + 2) % 2; u = x > 1 ? 2 - x : x; break; } // PingPong
      case 3: u = ctx.count > 0 ? ctx.index / ctx.count : r; break;                               // BurstSpread
      default: u = r;
    }
    if (this.spread > 0) u = Math.min(1, Math.round(u / this.spread) * this.spread);
    return u;
  }
}

export class Shape {
  /**
   * @param {any} m ShapeModule of a descriptor (absent = emit at the origin along +Z)
   * @param {{ mesh?: (key: string) => any, meshOf?: (ref: any) => { data: any, matrix: Float32Array|null } | null }} [res]
   */
  constructor(m, res = {}) {
    this.on = !!m;
    const id = num(m?.type, -1);
    this.type = (m && typeof m.typeName === 'string' && m.typeName) || TYPE_BY_ID[id] || 'none';
    this.shell = SHELL_IDS.has(id);
    this.radius = new MultiMode(m?.radius, 1);
    this.arc = new MultiMode(m?.arc, 360);
    this.thickness = Math.min(1, Math.max(0, num(m?.radiusThickness, 1)));
    if (this.shell) this.thickness = 0;
    this.angle = Math.min(90, Math.max(0, num(m?.angle, 25))) * DEG;
    this.length = num(m?.length, 5);
    this.boxThickness = vec3(m?.boxThickness, [0, 0, 0]);
    this.donutRadius = num(m?.donutRadius, 0.2);
    this.randomDirection = Math.min(1, Math.max(0, num(m?.randomDirectionAmount, 0)));
    this.sphericalDirection = Math.min(1, Math.max(0, num(m?.sphericalDirectionAmount, 0)));
    this.randomPosition = Math.max(0, num(m?.randomPositionAmount, 0));
    this.placement = num(m?.placementMode, 0) | 0;
    this.normalOffset = num(m?.m_MeshNormalOffset, 0);
    // the shape's own transform inside the system
    const pos = vec3(m?.m_Position, [0, 0, 0]), rot = vec3(m?.m_Rotation, [0, 0, 0]), scl = vec3(m?.m_Scale, [1, 1, 1]);
    this.identity = !pos[0] && !pos[1] && !pos[2] && !rot[0] && !rot[1] && !rot[2] && scl[0] === 1 && scl[1] === 1 && scl[2] === 1;
    this.matrix = mat4Trs(pos, quatEuler(rot[0], rot[1], rot[2]), scl);
    // mesh shapes: the mesh data (and, for a MeshRenderer, that renderer's transform relative to the system)
    this.mesh = null;
    this.meshMatrix = null;
    this.res = res;
    this.meshRef = null;
    if (this.type === 'mesh' && m?.m_Mesh && typeof m.m_Mesh.mesh === 'string') this.meshRef = { mesh: m.m_Mesh.mesh };
    else if ((this.type === 'meshRenderer' || this.type === 'skinnedMeshRenderer')) this.meshRef = m?.m_MeshRenderer || m?.m_SkinnedMeshRenderer || null;
    this._tri = null; // cumulative triangle areas
    this._v = [0, 0, 0];
  }

  /** The mesh of a mesh shape, resolved lazily (meshes load with the effect's other files). */
  _meshData() {
    if (this.mesh || !this.meshRef) return this.mesh;
    if (this.meshRef.mesh && this.res.mesh) this.mesh = this.res.mesh(this.meshRef.mesh);
    else if (this.meshRef.node != null && this.res.meshOf) {
      const r = this.res.meshOf(this.meshRef);
      if (r) { this.mesh = r.data; this.meshMatrix = r.matrix; }
    }
    return this.mesh;
  }

  /** Sample a birth point and direction into out (see the header). */
  sample(rng, ctx, out) {
    let px = 0, py = 0, pz = 0, dx = 0, dy = 0, dz = 1;
    switch (this.type) {
      case 'sphere': case 'hemisphere': {
        // a uniform direction, the radius volume-uniform inside the thickness band
        const z = 2 * rng.next() - 1, a = rng.next() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
        dx = s * Math.cos(a); dy = s * Math.sin(a); dz = this.type === 'hemisphere' ? Math.abs(z) : z;
        const R = this.radius.value, k = 1 - this.thickness;
        const rr = R * Math.cbrt(k * k * k + (1 - k * k * k) * rng.next());
        px = dx * rr; py = dy * rr; pz = dz * rr;
        break;
      }
      case 'cone': case 'coneVolume': {
        const R = this.radius.value, k = 1 - this.thickness;
        const f = Math.sqrt(k * k + (1 - k * k) * this.radius.frac(rng.next(), ctx));
        const a = this.arc.frac(rng.next(), ctx) * this.arc.value * DEG;
        const ca = Math.cos(a), sa = Math.sin(a);
        px = f * R * ca; py = f * R * sa; pz = 0;
        const sn = Math.sin(this.angle), cs = Math.cos(this.angle);
        dx = f * sn * ca; dy = f * sn * sa; dz = cs;
        if (f * sn === 0 && cs === 0) { dx = ca; dy = sa; }
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        if (this.type === 'coneVolume') {
          // somewhere along the direction, the axial distance uniform over the cone's length
          const t = this.length * rng.next();
          const k2 = dz > 1e-4 ? t / dz : t;
          px += dx * k2; py += dy * k2; pz += dz * k2;
        }
        break;
      }
      case 'box': case 'boxShell': case 'boxEdge': {
        let x = rng.next() - 0.5, y = rng.next() - 0.5, z = rng.next() - 0.5;
        if (this.type === 'boxShell') {
          // onto a random face (its depth inside the shell: boxThickness of that axis)
          const ax = (rng.next() * 3) | 0, side = rng.next() < 0.5 ? -0.5 : 0.5;
          const depth = Math.min(0.5, Math.max(0, this.boxThickness[ax] / 2)) * rng.next();
          const v = side - Math.sign(side) * depth;
          if (ax === 0) x = v; else if (ax === 1) y = v; else z = v;
        } else if (this.type === 'boxEdge') {
          // onto a random edge: two coordinates at ±0.5
          const ax = (rng.next() * 3) | 0;
          const s1 = rng.next() < 0.5 ? -0.5 : 0.5, s2 = rng.next() < 0.5 ? -0.5 : 0.5;
          if (ax === 0) { y = s1; z = s2; } else if (ax === 1) { x = s1; z = s2; } else { x = s1; y = s2; }
        }
        px = x; py = y; pz = z;
        break;
      }
      case 'circle': {
        const R = this.radius.value, k = 1 - this.thickness;
        const rr = R * Math.sqrt(k * k + (1 - k * k) * rng.next());
        const a = this.arc.frac(rng.next(), ctx) * this.arc.value * DEG;
        dx = Math.cos(a); dy = Math.sin(a); dz = 0;
        px = dx * rr; py = dy * rr;
        break;
      }
      case 'donut': {
        const R = this.radius.value, k = 1 - this.thickness;
        const a = this.arc.frac(rng.next(), ctx) * this.arc.value * DEG, b = rng.next() * Math.PI * 2;
        const rt = this.donutRadius * Math.sqrt(k * k + (1 - k * k) * rng.next());
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        dx = cb * ca; dy = cb * sa; dz = sb;
        px = R * ca + rt * dx; py = R * sa + rt * dy; pz = rt * dz;
        break;
      }
      case 'rectangle': px = rng.next() - 0.5; py = rng.next() - 0.5; break;
      case 'singleSidedEdge': {
        const R = this.radius.value;
        px = (this.radius.frac(rng.next(), ctx) * 2 - 1) * R;
        dx = 0; dy = 1; dz = 0;
        break;
      }
      case 'mesh': case 'meshRenderer': case 'skinnedMeshRenderer': {
        const m = this._meshData();
        if (m && m.positions && m.positions.length >= 3) {
          this._fromMesh(m, rng, out);
          px = out.px; py = out.py; pz = out.pz; dx = out.dx; dy = out.dy; dz = out.dz;
          if (this.meshMatrix) {
            const v = this._v;
            mat4Point(this.meshMatrix, px, py, pz, v); px = v[0]; py = v[1]; pz = v[2];
            mat4Dir(this.meshMatrix, dx, dy, dz, v); dx = v[0]; dy = v[1]; dz = v[2];
          }
        }
        break;
      }
      default: break; // no shape / sprite shapes (unused): the origin, along +Z
    }
    if (!this.identity) {
      const v = this._v;
      mat4Point(this.matrix, px, py, pz, v); px = v[0]; py = v[1]; pz = v[2];
      mat4Dir(this.matrix, dx, dy, dz, v);
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l > 1e-9) { dx = v[0] / l; dy = v[1] / l; dz = v[2] / l; }
    }
    if (this.randomDirection > 0) {
      const z = 2 * rng.next() - 1, a = rng.next() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
      const k = this.randomDirection;
      dx += (s * Math.cos(a) - dx) * k; dy += (s * Math.sin(a) - dy) * k; dz += (z - dz) * k;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    }
    if (this.sphericalDirection > 0) {
      const l0 = Math.hypot(px, py, pz);
      if (l0 > 1e-9) {
        const k = this.sphericalDirection;
        dx += (px / l0 - dx) * k; dy += (py / l0 - dy) * k; dz += (pz / l0 - dz) * k;
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      }
    }
    if (this.randomPosition > 0) {
      const z = 2 * rng.next() - 1, a = rng.next() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
      const rr = this.randomPosition * Math.cbrt(rng.next());
      px += s * Math.cos(a) * rr; py += s * Math.sin(a) * rr; pz += z * rr;
    }
    out.px = px; out.py = py; out.pz = pz; out.dx = dx; out.dy = dy; out.dz = dz;
    return out;
  }

  /** A point of a mesh by placement mode (0 vertex, 1 edge, 2 triangle) and its normal. */
  _fromMesh(m, rng, out) {
    const P = m.positions, N = m.normals, nv = (P.length / 3) | 0;
    const tris = Array.isArray(m.submeshes) && m.submeshes.length ? m.submeshes[0] : null;
    const nrm = (i, o) => {
      if (N && N.length >= (i + 1) * 3) { o[0] = N[i * 3]; o[1] = N[i * 3 + 1]; o[2] = N[i * 3 + 2]; }
      else { o[0] = 0; o[1] = 0; o[2] = 1; }
      return o;
    };
    const n0 = [0, 0, 0], n1 = [0, 0, 0], n2 = [0, 0, 0];
    if (this.placement === 0 || !tris || tris.length < 3) {
      const i = Math.min(nv - 1, (rng.next() * nv) | 0);
      out.px = P[i * 3]; out.py = P[i * 3 + 1]; out.pz = P[i * 3 + 2];
      nrm(i, n0); out.dx = n0[0]; out.dy = n0[1]; out.dz = n0[2];
    } else if (this.placement === 1) {
      const t = ((rng.next() * (tris.length / 3)) | 0) * 3, e = (rng.next() * 3) | 0;
      const a = tris[t + e], b = tris[t + (e + 1) % 3], f = rng.next();
      out.px = P[a * 3] + (P[b * 3] - P[a * 3]) * f; out.py = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * f;
      out.pz = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * f;
      nrm(a, n0); nrm(b, n1);
      out.dx = n0[0] + (n1[0] - n0[0]) * f; out.dy = n0[1] + (n1[1] - n0[1]) * f; out.dz = n0[2] + (n1[2] - n0[2]) * f;
    } else {
      // a triangle by area, a uniform point inside it
      if (!this._tri) {
        const cum = new Float32Array(tris.length / 3);
        let s = 0;
        for (let i = 0; i < tris.length; i += 3) {
          const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
          const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
          const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
          s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
          cum[i / 3] = s;
        }
        this._tri = cum;
      }
      const cum = this._tri, total = cum[cum.length - 1] || 1, x = rng.next() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
      const t = lo * 3, a = tris[t], b = tris[t + 1], c = tris[t + 2];
      let u = rng.next(), v = rng.next();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      out.px = P[a * 3] * w + P[b * 3] * u + P[c * 3] * v;
      out.py = P[a * 3 + 1] * w + P[b * 3 + 1] * u + P[c * 3 + 1] * v;
      out.pz = P[a * 3 + 2] * w + P[b * 3 + 2] * u + P[c * 3 + 2] * v;
      nrm(a, n0); nrm(b, n1); nrm(c, n2);
      out.dx = n0[0] * w + n1[0] * u + n2[0] * v; out.dy = n0[1] * w + n1[1] * u + n2[1] * v; out.dz = n0[2] * w + n1[2] * u + n2[2] * v;
    }
    const l = Math.hypot(out.dx, out.dy, out.dz) || 1;
    out.dx /= l; out.dy /= l; out.dz /= l;
    if (this.normalOffset) { out.px += out.dx * this.normalOffset; out.py += out.dy * this.normalOffset; out.pz += out.dz * this.normalOffset; }
    return out;
  }
}
