// render/vfx/gl.js — the WebGL2 side of the official battle effects: programs per (geometry kind × shader family
// variant), the instanced quad / mesh draws and the CPU-built triangle draws of render/vfx/geom.js, textures and
// meshes on the GPU, the material render states, and the board's depth heightfield for the ZTest materials.
// It draws into the Pixi canvas's own context (render/vfx/system.js calls it from inside the Pixi render and resets
// Pixi's GL state afterwards).
//
// Blending onto the effect canvas: the Pixi canvas is transparent over the three.js board and composited with
// premultiplied alpha (displayed = C + board × (1 − A)). A material's colour factors are used as they are; its alpha
// factors (meant for an opaque target) are replaced so that the board shows through as the client draws it:
// OneMinusSrcAlpha destinations accumulate coverage (One, OneMinusSrcAlpha), additive / screen-like destinations keep
// the target alpha (Zero, One), and the Multiply family darkens by the luminance it multiplies with.
// Culling: Unity treats clockwise screen triangles as front faces; the effects reach the screen with the same winding
// (the battle frame's flip is part of the camera equivalence), so frontFace(CW) + the material's cull mode.

import { vertexSource, fragmentSource, DEPTH_VS, DEPTH_FS, LOC } from './glsl.js';
import { QUAD_STRIDE, MESH_STRIDE, STRIP_STRIDE } from './geom.js';
import { BLEND, UNIFORM_DEFAULTS } from './materials.js';

const DEFAULT_TEX = { white: [255, 255, 255, 255], black: [0, 0, 0, 255], gray: [128, 128, 128, 255], grey: [128, 128, 128, 255], bump: [128, 128, 255, 255], clear: [0, 0, 0, 0] };

export class FxGL {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {{ texture: (key: string) => { image: any, info: any } | null, mesh: (key: string) => any }} lib
   */
  constructor(gl, lib) {
    this.gl = gl;
    this.lib = lib;
    this.programs = new Map();     // `${kind}|${mat.key}` → program record
    this.textures = new Map();     // `${key}|${half}` → { tex, bytes }
    this.meshes = new Map();       // mesh key → { vao, vbo, ibo, sub: [{ first, count }], type }
    this.defaults = {};
    this.stats = { draws: 0, programs: 0, textures: 0, texBytes: 0, quads: 0, meshes: 0, tris: 0 };
    this.hasDepth = !!(gl.getContextAttributes && gl.getContextAttributes()?.depth);
    this._init();
  }

  _init() {
    const gl = this.gl;
    // the shared quad corners
    this.cornerVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    this.cornerIbo = gl.createBuffer();
    // dynamic buffers
    this.quadBuf = gl.createBuffer();
    this.meshBuf = gl.createBuffer();
    this.stripVbo = gl.createBuffer();
    this.stripIbo = gl.createBuffer();
    // quad VAO
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cornerIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerVbo);
    gl.enableVertexAttribArray(LOC.corner);
    gl.vertexAttribPointer(LOC.corner, 2, gl.FLOAT, false, 8, 0);
    for (const l of [LOC.center, LOC.ax, LOC.ay, LOC.color, LOC.uvr, LOC.t0, LOC.t1, LOC.t2]) { gl.enableVertexAttribArray(l); gl.vertexAttribDivisor(l, 1); }
    // strip VAO
    this.stripVao = gl.createVertexArray();
    gl.bindVertexArray(this.stripVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripVbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.stripIbo);
    const S = STRIP_STRIDE * 4;
    gl.enableVertexAttribArray(LOC.pos); gl.vertexAttribPointer(LOC.pos, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(LOC.uv); gl.vertexAttribPointer(LOC.uv, 2, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(LOC.vcol); gl.vertexAttribPointer(LOC.vcol, 4, gl.FLOAT, false, S, 20);
    gl.enableVertexAttribArray(LOC.nrm); gl.vertexAttribPointer(LOC.nrm, 3, gl.FLOAT, false, S, 36);
    gl.bindVertexArray(null);
    // 1×1 default textures
    for (const [name, c] of Object.entries(DEFAULT_TEX)) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(c));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.defaults[name] = t;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    // depth heightfield program
    this.depthProg = this._link(DEPTH_VS, DEPTH_FS);
    this.depthVp = this.depthProg ? gl.getUniformLocation(this.depthProg, 'u_vp') : null;
    this.hfVao = null; this.hfVbo = null; this.hfCount = 0;
  }

  _link(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`fx shader: ${log}`); }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(`fx program: ${log}`); }
    return p;
  }

  /** The program of a geometry kind and compiled material (built on first use). */
  program(kind, mat) {
    const key = `${kind}|${mat.key}`;
    let rec = this.programs.get(key);
    if (rec !== undefined) return rec;
    const gl = this.gl;
    try {
      const prog = this._link(vertexSource(kind), fragmentSource(mat.family, mat.defs));
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      const uniforms = [];
      let unit = 0;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        if (!info) continue;
        const loc = gl.getUniformLocation(prog, info.name);
        const name = info.name.startsWith('u') ? info.name.slice(1) : info.name;
        const u = { name, loc, type: info.type, unit: -1 };
        if (info.type === gl.SAMPLER_2D) u.unit = unit++;
        uniforms.push(u);
      }
      rec = { prog, uniforms, vp: gl.getUniformLocation(prog, 'u_vp'), time: gl.getUniformLocation(prog, 'u_Time'), camPos: gl.getUniformLocation(prog, 'u_WorldSpaceCameraPos'), pass: -1, plans: new WeakMap() };
      this.stats.programs++;
    } catch (err) {
      console.warn('[fx] program failed', mat.family, err?.message || err);
      rec = null;
    }
    this.programs.set(key, rec);
    return rec;
  }

  /**
   * The uniform binding plan of a material on a program (built once): its textures by sampler unit, its floats and
   * vectors with their values resolved (material value, else the family default).
   */
  _plan(rec, mat) {
    let p = rec.plans.get(mat);
    if (p) return p;
    const gl = this.gl;
    p = { tex: [], f: [], v: [] };
    for (const u of rec.uniforms) {
      const nm = u.name;
      if (nm === '_vp' || nm === '_Time' || nm === '_WorldSpaceCameraPos') continue;
      if (u.unit >= 0) {
        const t = mat.textures.find((x) => x.name === nm);
        p.tex.push({ loc: u.loc, unit: u.unit, key: t && t.key ? t.key : null, fallback: this.defaults[t?.def || 'white'] || this.defaults.white, glTex: null });
      } else if (u.type === gl.FLOAT) p.f.push({ loc: u.loc, name: nm, value: mat.floats[nm] ?? UNIFORM_DEFAULTS[nm] ?? 0 });
      else if (u.type === gl.FLOAT_VEC4) p.v.push({ loc: u.loc, name: nm, value: mat.vecs[nm] || (nm.endsWith('_ST') ? ST1 : nm.startsWith('_Rotation') ? ROT1 : V0) });
    }
    rec.plans.set(mat, p);
    return p;
  }

  /** The GL texture of an fx texture key (null while its image loads). */
  texture(key, half) {
    const id = `${key}|${half ? 1 : 0}`;
    const t = this.textures.get(id);
    if (t) return t.tex;
    const src = this.lib.texture(key, half);
    if (!src || !src.image) return null;
    const gl = this.gl, img = src.image, info = src.info || {};
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Unity samples v = 0 at the image's bottom row (an ImageBitmap arrives flipped already: WebGL ignores FLIP_Y for
    // bitmaps); textures are straight alpha (no premultiplication on upload)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !src.flipped);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const wrap = (w) => (w === 'clamp' ? gl.CLAMP_TO_EDGE : w === 'mirror' || w === 'mirrorOnce' ? gl.MIRRORED_REPEAT : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(info.wrapU));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(info.wrapV));
    const point = info.filter === 'point';
    const mips = (info.mips || 1) > 1 && !point;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, point ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, point ? gl.NEAREST : mips ? (info.filter === 'trilinear' ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_NEAREST) : gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const bytes = (img.width || 1) * (img.height || 1) * 4 * (mips ? 1.34 : 1);
    this.textures.set(id, { tex, bytes });
    // the decoded image is on the GPU now: the library lets it go (it is decoded again only after a context loss)
    this.lib.release?.(key, half);
    this.stats.textures++;
    this.stats.texBytes += bytes;
    return tex;
  }

  /** GPU copy of a mesh (null while it loads). */
  mesh(key) {
    let m = this.meshes.get(key);
    if (m !== undefined) return m;
    const data = this.lib.mesh(key);
    if (!data) return null;
    const gl = this.gl;
    const P = data.positions || [], nv = (P.length / 3) | 0;
    if (!nv) { this.meshes.set(key, null); return null; }
    const v = new Float32Array(nv * 12);
    for (let i = 0; i < nv; i++) {
      v[i * 12] = P[i * 3]; v[i * 12 + 1] = P[i * 3 + 1]; v[i * 12 + 2] = P[i * 3 + 2];
      const N = data.normals; v[i * 12 + 3] = N ? N[i * 3] : 0; v[i * 12 + 4] = N ? N[i * 3 + 1] : 0; v[i * 12 + 5] = N ? N[i * 3 + 2] : 1;
      const U = data.uv0; v[i * 12 + 6] = U ? U[i * 2] : 0; v[i * 12 + 7] = U ? U[i * 2 + 1] : 0;
      const C = data.colors; v[i * 12 + 8] = C ? C[i * 4] : 1; v[i * 12 + 9] = C ? C[i * 4 + 1] : 1; v[i * 12 + 10] = C ? C[i * 4 + 2] : 1; v[i * 12 + 11] = C ? C[i * 4 + 3] : 1;
    }
    const subs = Array.isArray(data.submeshes) ? data.submeshes : [];
    let total = 0;
    for (const s of subs) total += s.length;
    const big = nv > 65535;
    const idx = big ? new Uint32Array(total) : new Uint16Array(total);
    const sub = [];
    let o = 0;
    for (const s of subs) { idx.set(s, o); sub.push({ first: o, count: s.length }); o += s.length; }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(LOC.pos); gl.vertexAttribPointer(LOC.pos, 3, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(LOC.nrm); gl.vertexAttribPointer(LOC.nrm, 3, gl.FLOAT, false, 48, 12);
    gl.enableVertexAttribArray(LOC.uv); gl.vertexAttribPointer(LOC.uv, 2, gl.FLOAT, false, 48, 24);
    gl.enableVertexAttribArray(LOC.vcol); gl.vertexAttribPointer(LOC.vcol, 4, gl.FLOAT, false, 48, 32);
    for (const l of [LOC.center, LOC.m0, LOC.m1, LOC.m2, LOC.color, LOC.uvr, LOC.t0, LOC.t1, LOC.t2]) { gl.enableVertexAttribArray(l); gl.vertexAttribDivisor(l, 1); }
    gl.bindVertexArray(null);
    m = { vao, vbo, ibo, sub, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, size: big ? 4 : 2 };
    this.meshes.set(key, m);
    return m;
  }

  /** Upload a frame's geometry (geom.js FrameData). */
  upload(fd) {
    const gl = this.gl;
    if (fd.nq) { gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.bufferData(gl.ARRAY_BUFFER, fd.quad.subarray(0, fd.nq * QUAD_STRIDE), gl.STREAM_DRAW); }
    if (fd.nm) { gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf); gl.bufferData(gl.ARRAY_BUFFER, fd.mesh.subarray(0, fd.nm * MESH_STRIDE), gl.STREAM_DRAW); }
    if (fd.ns) { gl.bindBuffer(gl.ARRAY_BUFFER, this.stripVbo); gl.bufferData(gl.ARRAY_BUFFER, fd.strip.subarray(0, fd.ns * STRIP_STRIDE), gl.STREAM_DRAW); }
    if (fd.ni) {
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.stripIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, fd.index.subarray(0, fd.ni), gl.STREAM_DRAW);
    }
    this.stats.quads = fd.nq; this.stats.meshes = fd.nm;
  }

  /** The board heightfield (board-space triangles [x, y, z, …]) for the depth pre-pass. */
  setHeightfield(tris) {
    const gl = this.gl;
    if (!this.hfVao) {
      this.hfVao = gl.createVertexArray();
      this.hfVbo = gl.createBuffer();
      gl.bindVertexArray(this.hfVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.hfVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hfVbo);
    gl.bufferData(gl.ARRAY_BUFFER, tris, gl.STATIC_DRAW);
    this.hfCount = (tris.length / 3) | 0;
  }

  /** Clear the depth buffer and write the board's heightfield into it (no colour). */
  depthPrepass(vpBoard) {
    const gl = this.gl;
    if (!this.hasDepth || !this.depthProg) return;
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (!this.hfCount) return;
    gl.useProgram(this.depthProg);
    gl.uniformMatrix4fv(this.depthVp, false, vpBoard);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.hfVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.hfCount);
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
  }

  /**
   * Draw items (already sorted). frame = { vp (Unity → clip), cam (Unity camera position), time, half, pass }.
   */
  draw(items, frame) {
    const gl = this.gl;
    // a mask up the Pixi tree may have scissor / stencil on: kept as they are (the effects layers are never masked)
    gl.enable(gl.BLEND);
    gl.frontFace(gl.CW);
    let lastProg = null, lastState = null;
    const time = frame.time;
    const tv = [time / 20, time, time * 2, time * 3];
    let lastMat = null, lastOv = null;
    for (const it of items) {
      const mat = it.mat;
      const kind = it.kind;
      const rec = this.program(kind, mat);
      if (!rec) continue;
      const plan = this._plan(rec, mat);
      // textures first: a draw whose texture is still loading is skipped (no white flash)
      let ready = true;
      for (const e of plan.tex) {
        e.glTex = e.key ? this.texture(e.key, frame.half) : e.fallback;
        if (!e.glTex) { ready = false; break; }
      }
      if (!ready) continue;
      let mesh = null;
      if (kind === 'mesh') { mesh = this.mesh(it.meshKey); if (!mesh || !mesh.sub[it.submesh]) continue; }
      if (rec !== lastProg) {
        gl.useProgram(rec.prog);
        lastProg = rec;
        lastMat = null;
        if (rec.pass !== frame.pass) {
          gl.uniformMatrix4fv(rec.vp, false, frame.vp);
          rec.pass = frame.pass;
          if (rec.time) gl.uniform4fv(rec.time, tv);
          if (rec.camPos) gl.uniform3fv(rec.camPos, frame.cam);
        }
      }
      // material uniforms (overrides from clips / UV tweeners first): all of them for another material; for the same
      // material with other overrides only the uniforms either set names (the textures are bound again regardless:
      // another frame's upload may have rebound a unit)
      const ov = it.ov;
      if (mat !== lastMat) {
        for (const e of plan.tex) { gl.activeTexture(gl.TEXTURE0 + e.unit); gl.bindTexture(gl.TEXTURE_2D, e.glTex); gl.uniform1i(e.loc, e.unit); }
        for (const e of plan.f) {
          const o = ov ? ov[e.name] : undefined;
          gl.uniform1f(e.loc, typeof o === 'number' ? o : e.value);
        }
        for (const e of plan.v) {
          const o = ov ? ov[e.name] : undefined;
          const v = Array.isArray(o) ? o : e.value;
          gl.uniform4f(e.loc, v[0], v[1], v[2], v[3]);
        }
        lastMat = mat; lastOv = ov;
      } else {
        for (const e of plan.tex) { gl.activeTexture(gl.TEXTURE0 + e.unit); gl.bindTexture(gl.TEXTURE_2D, e.glTex); }
        if (ov !== lastOv) {
          for (const e of plan.f) {
            if (!(ov && e.name in ov) && !(lastOv && e.name in lastOv)) continue;
            const o = ov ? ov[e.name] : undefined;
            gl.uniform1f(e.loc, typeof o === 'number' ? o : e.value);
          }
          for (const e of plan.v) {
            if (!(ov && e.name in ov) && !(lastOv && e.name in lastOv)) continue;
            const o = ov ? ov[e.name] : undefined;
            const v = Array.isArray(o) ? o : e.value;
            gl.uniform4f(e.loc, v[0], v[1], v[2], v[3]);
          }
          lastOv = ov;
        }
      }
      const st = mat.state;
      if (st !== lastState) { this._state(st, mat.family); lastState = st; }
      if (kind === 'quad') {
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
        const B = QUAD_STRIDE * 4, base = it.first * B;
        gl.vertexAttribPointer(LOC.center, 3, gl.FLOAT, false, B, base);
        gl.vertexAttribPointer(LOC.ax, 3, gl.FLOAT, false, B, base + 12);
        gl.vertexAttribPointer(LOC.ay, 3, gl.FLOAT, false, B, base + 24);
        gl.vertexAttribPointer(LOC.color, 4, gl.FLOAT, false, B, base + 36);
        gl.vertexAttribPointer(LOC.uvr, 4, gl.FLOAT, false, B, base + 52);
        gl.vertexAttribPointer(LOC.t0, 2, gl.FLOAT, false, B, base + 68);
        gl.vertexAttribPointer(LOC.t1, 4, gl.FLOAT, false, B, base + 76);
        gl.vertexAttribPointer(LOC.t2, 4, gl.FLOAT, false, B, base + 92);
        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, it.count);
        this.stats.tris += it.count * 2;
      } else if (kind === 'mesh') {
        gl.bindVertexArray(mesh.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
        const B = MESH_STRIDE * 4, base = it.first * B;
        gl.vertexAttribPointer(LOC.center, 3, gl.FLOAT, false, B, base);
        gl.vertexAttribPointer(LOC.m0, 3, gl.FLOAT, false, B, base + 12);
        gl.vertexAttribPointer(LOC.m1, 3, gl.FLOAT, false, B, base + 24);
        gl.vertexAttribPointer(LOC.m2, 3, gl.FLOAT, false, B, base + 36);
        gl.vertexAttribPointer(LOC.color, 4, gl.FLOAT, false, B, base + 48);
        gl.vertexAttribPointer(LOC.uvr, 4, gl.FLOAT, false, B, base + 64);
        gl.vertexAttribPointer(LOC.t0, 2, gl.FLOAT, false, B, base + 80);
        gl.vertexAttribPointer(LOC.t1, 4, gl.FLOAT, false, B, base + 88);
        gl.vertexAttribPointer(LOC.t2, 4, gl.FLOAT, false, B, base + 104);
        const s = mesh.sub[it.submesh];
        gl.drawElementsInstanced(gl.TRIANGLES, s.count, mesh.type, s.first * mesh.size, it.count);
        this.stats.tris += (s.count / 3) * it.count;
      } else {
        gl.bindVertexArray(this.stripVao);
        gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, it.first * 4);
        this.stats.tris += it.count / 3;
      }
      this.stats.draws++;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
  }

  /** Render state of a material pass (see the header for the alpha factors). */
  _state(st, family) {
    const gl = this.gl;
    const f = (b) => GL_BLEND(gl, b);
    let src = f(st.src), dst = f(st.dst), srcA, dstA;
    if (family === 'multiply' || st.src === BLEND.DstColor || (st.src === BLEND.Zero && st.dst === BLEND.SrcColor)) {
      src = gl.ZERO; dst = gl.SRC_COLOR; srcA = gl.ONE; dstA = gl.ONE_MINUS_SRC_ALPHA;
    } else if (st.dst === BLEND.OneMinusSrcAlpha || st.dst === BLEND.Zero) { srcA = gl.ONE; dstA = gl.ONE_MINUS_SRC_ALPHA; }
    else { srcA = gl.ZERO; dstA = gl.ONE; }
    gl.blendFuncSeparate(src, dst, srcA, dstA);
    const op = st.op === 'Sub' ? gl.FUNC_SUBTRACT : st.op === 'RevSub' ? gl.FUNC_REVERSE_SUBTRACT : st.op === 'Min' ? gl.MIN : st.op === 'Max' ? gl.MAX : gl.FUNC_ADD;
    gl.blendEquationSeparate(op, gl.FUNC_ADD);
    if (st.zTest && this.hasDepth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(DEPTH_FUNC(gl, st.zTest));
      gl.depthMask(!!st.zWrite);
    } else { gl.disable(gl.DEPTH_TEST); gl.depthMask(false); }
    if (st.cull === 'Back') { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
    else if (st.cull === 'Front') { gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT); }
    else gl.disable(gl.CULL_FACE);
    // alpha is always written: it is the effect canvas's coverage over the board (see the header)
    const cm = st.colorMask;
    gl.colorMask(!!(cm & 8), !!(cm & 4), !!(cm & 2), true);
  }

  /** Free GPU memory of textures not used for `ttl` frames (called by the system between battles). */
  dropTextures() {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t.tex);
    this.textures.clear();
    this.lib.forgetGpu?.();
    this.stats.textures = 0; this.stats.texBytes = 0;
  }

  destroy() {
    const gl = this.gl;
    this.dropTextures();
    for (const r of this.programs.values()) if (r) gl.deleteProgram(r.prog);
    this.programs.clear();
    for (const m of this.meshes.values()) if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo); }
    this.meshes.clear();
    for (const t of Object.values(this.defaults)) gl.deleteTexture(t);
    for (const b of [this.cornerVbo, this.cornerIbo, this.quadBuf, this.meshBuf, this.stripVbo, this.stripIbo, this.hfVbo]) if (b) gl.deleteBuffer(b);
    for (const v of [this.quadVao, this.stripVao, this.hfVao]) if (v) gl.deleteVertexArray(v);
    if (this.depthProg) gl.deleteProgram(this.depthProg);
  }
}

const ST1 = [1, 1, 0, 0], ROT1 = [1, 0, 0, 1], V0 = [0, 0, 0, 0];

function GL_BLEND(gl, b) {
  switch (b) {
    case BLEND.Zero: return gl.ZERO;
    case BLEND.One: return gl.ONE;
    case BLEND.DstColor: return gl.DST_COLOR;
    case BLEND.SrcColor: return gl.SRC_COLOR;
    case BLEND.OneMinusDstColor: return gl.ONE_MINUS_DST_COLOR;
    case BLEND.SrcAlpha: return gl.SRC_ALPHA;
    case BLEND.OneMinusSrcColor: return gl.ONE_MINUS_SRC_COLOR;
    case BLEND.DstAlpha: return gl.DST_ALPHA;
    case BLEND.OneMinusDstAlpha: return gl.ONE_MINUS_DST_ALPHA;
    case BLEND.SrcAlphaSaturate: return gl.SRC_ALPHA_SATURATE;
    case BLEND.OneMinusSrcAlpha: return gl.ONE_MINUS_SRC_ALPHA;
    default: return gl.ONE;
  }
}

function DEPTH_FUNC(gl, z) {
  switch (z) {
    case 'never': return gl.NEVER;
    case 'less': return gl.LESS;
    case 'equal': return gl.EQUAL;
    case 'greater': return gl.GREATER;
    case 'notequal': return gl.NOTEQUAL;
    case 'gequal': return gl.GEQUAL;
    default: return gl.LEQUAL;
  }
}
