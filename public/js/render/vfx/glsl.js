// render/vfx/glsl.js — GLSL ES 3.0 programs of the official battle effects' shader families (DESIGN §33.7; client
// docs: the official effects layer). Our own GLSL: each family reproduces the computation of the client's particle
// shaders as documented for the runtime (official shader source is never part of the repository).
//
//   vertexSource(kind)            'quad' (instanced particle quads: centre + two half-axis vectors per particle),
//                                 'mesh' (instanced meshes: centre + a 3×3 basis per instance — mesh particles and
//                                 MeshRenderers), 'strip' (CPU-built triangles: trails, lines, skinned meshes)
//   fragmentSource(family, defs)  the family's fragment shader; defs: { cvs (custom vertex streams), weight (_WEIGHT_ON),
//                                 lite (the light tier drops the distortion lookups) }
//   FAMILIES                      the families and the Unity properties each reads (uniform `u<name>`)
//
// Conventions of every family: material properties are uniforms named after the Unity property (`u_TintColor`,
// `u_MainTex`, `u_MainTex_ST` …); `u_Time` is Unity's _Time (t/20, t, 2t, 3t) on the battle clock; colours are in
// gamma space as the client renders them; the vertex colour is the particle / mesh colour; outputs are straight
// colour + alpha for the material's own blend state (render/vfx/gl.js maps the alpha factors for the transparent
// effect canvas). Custom vertex streams (the *(CustomData) shaders' `_HGCUSTOMVERTEXSTREAM_ON` variant) arrive packed
// as Unity packs them after the UV: v_t0 = TEXCOORD0.zw, v_t1 = TEXCOORD1, v_t2 = TEXCOORD2.

const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

const VARY_OUT = `out vec2 v_uv; out vec4 v_col; out vec2 v_t0; out vec4 v_t1; out vec4 v_t2; out vec3 v_wpos; out vec3 v_nrm;\n`;
const VARY_IN = `in vec2 v_uv; in vec4 v_col; in vec2 v_t0; in vec4 v_t1; in vec4 v_t2; in vec3 v_wpos; in vec3 v_nrm;\n`;

/** Attribute locations (shared by every program so one VAO layout fits all). */
export const LOC = Object.freeze({
  corner: 0, pos: 0, center: 1, ax: 2, ay: 3, m0: 2, m1: 3, color: 4, uvr: 5, t0: 6, t1: 7, t2: 8, nrm: 9, uv: 10, vcol: 11, m2: 12,
});

/** The vertex shader of a geometry kind. */
export function vertexSource(kind) {
  if (kind === 'quad') {
    return `${HEAD}
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 a_center;
layout(location=2) in vec3 a_ax;
layout(location=3) in vec3 a_ay;
layout(location=4) in vec4 a_color;
layout(location=5) in vec4 a_uvr;
layout(location=6) in vec2 a_t0;
layout(location=7) in vec4 a_t1;
layout(location=8) in vec4 a_t2;
uniform mat4 u_vp;
${VARY_OUT}
void main() {
  vec3 p = a_center + a_ax * a_corner.x + a_ay * a_corner.y;
  vec3 n = cross(a_ax, a_ay);
  float l = length(n);
  v_nrm = l > 1e-8 ? n / l : vec3(0.0, 0.0, -1.0);
  v_wpos = p;
  v_uv = a_uvr.xy + (a_corner + 0.5) * a_uvr.zw;
  v_col = a_color; v_t0 = a_t0; v_t1 = a_t1; v_t2 = a_t2;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  }
  if (kind === 'mesh') {
    return `${HEAD}
layout(location=0) in vec3 a_pos;
layout(location=9) in vec3 a_nrm;
layout(location=10) in vec2 a_uv;
layout(location=11) in vec4 a_vcol;
layout(location=1) in vec3 a_center;
layout(location=2) in vec3 a_m0;
layout(location=3) in vec3 a_m1;
layout(location=12) in vec3 a_m2;
layout(location=4) in vec4 a_color;
layout(location=5) in vec4 a_uvr;
layout(location=6) in vec2 a_t0;
layout(location=7) in vec4 a_t1;
layout(location=8) in vec4 a_t2;
uniform mat4 u_vp;
${VARY_OUT}
void main() {
  vec3 p = a_center + a_m0 * a_pos.x + a_m1 * a_pos.y + a_m2 * a_pos.z;
  vec3 n = mat3(a_m0, a_m1, a_m2) * a_nrm;
  float l = length(n);
  v_nrm = l > 1e-8 ? n / l : vec3(0.0, 0.0, -1.0);
  v_wpos = p;
  v_uv = a_uvr.xy + a_uv * a_uvr.zw;
  v_col = a_color * a_vcol; v_t0 = a_t0; v_t1 = a_t1; v_t2 = a_t2;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
  }
  // strip
  return `${HEAD}
layout(location=0) in vec3 a_pos;
layout(location=10) in vec2 a_uv;
layout(location=11) in vec4 a_vcol;
layout(location=9) in vec3 a_nrm;
uniform mat4 u_vp;
${VARY_OUT}
void main() {
  v_wpos = a_pos;
  float l = length(a_nrm);
  v_nrm = l > 1e-8 ? a_nrm / l : vec3(0.0, 0.0, -1.0);
  v_uv = a_uv; v_col = a_vcol; v_t0 = vec2(0.0); v_t1 = vec4(0.0); v_t2 = vec4(0.0);
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;
}

/** Depth-only heightfield of the board (the ground pass's pre-pass): board positions through u_vp. */
export const DEPTH_VS = `${HEAD}
layout(location=0) in vec3 a_pos;
uniform mat4 u_vp;
void main() { gl_Position = u_vp * vec4(a_pos, 1.0); }`;
export const DEPTH_FS = `${HEAD}
out vec4 o;
void main() { o = vec4(0.0); }`;

// ---- fragment families --------------------------------------------------------------------------------------------

const COMMON = `
uniform vec4 u_Time;
uniform vec3 u_WorldSpaceCameraPos;
out vec4 o_col;
vec4 chan4(vec4 c, float ch) { return ch < 0.5 ? c : ch < 1.5 ? c.rrrr : ch < 2.5 ? c.gggg : ch < 3.5 ? c.bbbb : c.aaaa; }
float chan1(vec4 c, float ch) { return ch < 0.5 ? c.r : ch < 1.5 ? c.g : ch < 2.5 ? c.b : c.a; }
vec2 st(vec2 uv, vec4 s) { return uv * s.xy + s.zw; }
float dissolveMask(float d, float amount, float border) {
  float r = 1.0 - roundEven(amount + 0.5);
  return clamp((d - amount + border * r) / max(border, 1e-4), 0.0, 1.0);
}
vec2 uvRot(vec2 uv, vec4 r, float on) { vec2 c = uv - 0.5; return on > 0.5 ? vec2(dot(c, r.xz), dot(c, r.yw)) + 0.5 : uv; }
vec4 premul(vec3 rgb, float a, float pm) { return pm < 1.5 ? vec4(rgb * a * 2.0, a) : vec4(rgb, a); }
`;

const S = (names) => names.map((n) => `uniform sampler2D u${n};`).join('\n');
const U4 = (names) => names.map((n) => `uniform vec4 u${n};`).join('\n');
const U1 = (names) => names.map((n) => `uniform float u${n};`).join('\n');

/**
 * Families: `src(defs)` → fragment body, `props` the Unity properties read (for the material compiler's uniform
 * list; textures listed in `tex`).
 */
export const FAMILIES = {
  // Additive / AlphaBlend and their L2D, Bloom, ZWrite, ZDistort, TileBasedTint relatives: 2 × vertex colour × tint ×
  // the main texture (or one of its channels); AlphaBlend's _PremultiplyAlpha source factor One premultiplies (×2 more)
  basic: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_MainTex_ST', '_TintColor'])}
${U1(['_MainTexChannel', '_PremultiplyAlpha'])}
void main() {
  vec4 c = chan4(texture(u_MainTex, st(v_uv, u_MainTex_ST)), u_MainTexChannel) * 2.0 * v_col * u_TintColor;
  float a = clamp(c.a, 0.0, 1.0);
  o_col = premul(c.rgb, a, u_PremultiplyAlpha);
}`,
  },
  // Unity's built-in 'Legacy Shaders/Particles/Alpha Blended Premultiply': colour × texture × colour alpha (blend One,
  // OneMinusSrcAlpha) — the disabled timing systems' Default-Particle material mostly
  legacyPremul: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_MainTex_ST'])}
void main() { o_col = v_col * texture(u_MainTex, st(v_uv, u_MainTex_ST)) * v_col.a; }`,
  },
  // 'Legacy Shaders/Particles/Alpha Blended'
  legacyAlpha: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_MainTex_ST', '_TintColor'])}
void main() { vec4 c = 2.0 * v_col * u_TintColor * texture(u_MainTex, st(v_uv, u_MainTex_ST)); o_col = vec4(c.rgb, clamp(c.a, 0.0, 1.0)); }`,
  },
  // 'Particles/Standard Unlit' (multiply colour mode, emission)
  stdUnlit: {
    tex: ['_MainTex', '_EmissionMap'],
    src: () => `${S(['_MainTex', '_EmissionMap'])}
${U4(['_MainTex_ST', '_Color', '_EmissionColor'])}
${U1(['_EmissionEnabled'])}
void main() {
  vec4 c = texture(u_MainTex, st(v_uv, u_MainTex_ST)) * u_Color * v_col;
  if (u_EmissionEnabled > 0.5) c.rgb += texture(u_EmissionMap, st(v_uv, u_MainTex_ST)).rgb * u_EmissionColor.rgb;
  o_col = vec4(c.rgb, clamp(c.a, 0.0, 1.0));
}`,
  },
  // Dissolve AB / Add: the main texture's alpha cut by a noise texture against _Amount with a soft _BorderWidth
  dissolve: {
    tex: ['_MainTex', '_DissolveTex'],
    src: () => `${S(['_MainTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_TintColor'])}
${U1(['_Amount', '_BorderWidth'])}
void main() {
  float m = dissolveMask(texture(u_DissolveTex, st(v_uv, u_DissolveTex_ST)).r, u_Amount, u_BorderWidth);
  vec4 c = 2.0 * v_col * u_TintColor * texture(u_MainTex, st(v_uv, u_MainTex_ST));
  o_col = vec4(c.rgb, clamp(m * c.a, 0.0, 1.0));
}`,
  },
  // Dissolve AB / Add UVTween: both UVs scrolled by _Time × _UVTween (xy main, zw dissolve), wrapped
  dissolveTween: {
    tex: ['_MainTex', '_DissolveTex'],
    src: () => `${S(['_MainTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_TintColor', '_UVTween'])}
${U1(['_Amount', '_BorderWidth'])}
void main() {
  vec4 tw = u_Time.y * u_UVTween;
  vec2 duv = fract(st(v_uv, u_DissolveTex_ST) + tw.zw), muv = fract(st(v_uv, u_MainTex_ST) + tw.xy);
  float m = dissolveMask(texture(u_DissolveTex, duv).r, u_Amount, u_BorderWidth);
  vec4 c = 2.0 * v_col * u_TintColor * texture(u_MainTex, muv);
  o_col = vec4(c.rgb, clamp(m * c.a, 0.0, 1.0));
}`,
  },
  // Dissolve (VertexColor Major): the vertex alpha drives the dissolve, the tint only the final alpha
  dissolveVc: {
    tex: ['_MainTex', '_DissolveTex'],
    src: () => `${S(['_MainTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_TintColor'])}
${U1(['_BorderWidth'])}
void main() {
  float d = texture(u_DissolveTex, st(v_uv, u_DissolveTex_ST)).r;
  float m = clamp((d - (1.0 - v_col.a) + v_col.a * u_BorderWidth) / max(u_BorderWidth, 1e-4), 0.0, 1.0);
  vec4 t = texture(u_MainTex, st(v_uv, u_MainTex_ST));
  o_col = vec4(t.rgb * 2.0 * v_col.rgb, clamp(t.a * m * u_TintColor.a, 0.0, 1.0));
}`,
  },
  // Dissolve … Double: two dissolve textures, each with its amount and border
  dissolveDouble: {
    tex: ['_MainTex', '_DissolveTex_01', '_DissolveTex_02'],
    src: () => `${S(['_MainTex', '_DissolveTex_01', '_DissolveTex_02'])}
${U4(['_MainTex_ST', '_DissolveTex_01_ST', '_DissolveTex_02_ST', '_TintColor'])}
${U1(['_Amount_01', '_BorderWidth_01', '_Amount_02', '_BorderWidth_02'])}
void main() {
  float m1 = dissolveMask(texture(u_DissolveTex_01, st(v_uv, u_DissolveTex_01_ST)).r, u_Amount_01, u_BorderWidth_01);
  float m2 = dissolveMask(texture(u_DissolveTex_02, st(v_uv, u_DissolveTex_02_ST)).r, u_Amount_02, u_BorderWidth_02);
  vec4 c = 2.0 * v_col * u_TintColor * texture(u_MainTex, st(v_uv, u_MainTex_ST));
  o_col = vec4(c.rgb, clamp(m1 * m2 * c.a, 0.0, 1.0));
}`,
  },
  // Dissolve(CustomData): scrolled main / dissolve UVs, optional dissolve (_UseDissolveTex) by _DissolveIntensity;
  // the custom streams add UV offsets and the intensity / border
  dissolveCd: {
    tex: ['_MainTex', '_DissolveTex'],
    src: (d) => `${S(['_MainTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_MainColor'])}
${U1(['_MainUSpeed', '_MainVSpeed', '_DissolveUSpeed', '_DissolveVSpeed', '_MainTexChannel', '_DissolvTexChannel', '_Opacity', '_UseDissolveTex', '_DissolveIntensity', '_BorderWidth', '_PremultiplyAlpha'])}
void main() {
  vec2 muv = st(v_uv, u_MainTex_ST), duv = st(v_uv, u_DissolveTex_ST);
  float inten = u_DissolveIntensity, border = u_BorderWidth;
  ${d.cvs ? 'muv += v_t0; duv += v_t1.xy; inten += v_t1.z; border = clamp(border + v_t1.w, 0.0, 1.0);' : ''}
  muv += u_Time.y * vec2(u_MainUSpeed, u_MainVSpeed);
  duv += u_Time.y * vec2(u_DissolveUSpeed, u_DissolveVSpeed);
  vec4 t = chan4(texture(u_MainTex, muv), u_MainTexChannel);
  float dv = chan1(texture(u_DissolveTex, duv), u_DissolvTexChannel);
  float m = dissolveMask(dv, inten, border);
  float a = t.a * u_MainColor.a * v_col.a * 2.0 * u_Opacity;
  a = clamp(mix(a, m * a, u_UseDissolveTex), 0.0, 1.0);
  vec3 rgb = t.rgb * v_col.rgb * u_MainColor.rgb * 2.0;
  o_col = premul(rgb, a, u_PremultiplyAlpha);
}`,
  },
  // Disturb Origin: the main UV pushed by a distortion texture × (_IntensityU, _IntensityV)
  disturbOrigin: {
    tex: ['_MainTex', '_DisturTex'],
    src: (d) => `${S(['_MainTex', '_DisturTex'])}
${U4(['_MainTex_ST', '_DisturTex_ST', '_MainColor'])}
${U1(['_IntensityU', '_IntensityV'])}
void main() {
  float n = ${d.lite ? '0.0' : 'texture(u_DisturTex, st(v_uv, u_DisturTex_ST)).r'};
  vec2 uv = st(v_uv + n * vec2(u_IntensityU, u_IntensityV), u_MainTex_ST);
  vec4 c = texture(u_MainTex, uv) * u_MainColor * v_col * u_MainColor.a;
  o_col = c * 2.0;
}`,
  },
  // Disturb Anchor: distortion around an anchor (one or two textures, optional weight map and dissolve), UV tween
  disturbAnchor: {
    tex: ['_MainTex', '_DisturTex', '_DisturTex_02', '_WeightTex', '_DissolveTex'],
    src: (d) => `${S(['_MainTex', '_DisturTex', '_DisturTex_02', '_WeightTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DisturTex_ST', '_DisturTex_02_ST', '_WeightTex_ST', '_DissolveTex_ST', '_MainColor', '_UVTween'])}
${U1(['_MainColorACtrl', '_IntensityU', '_IntensityV', '_AnchorU', '_AnchorV', '_ToggleUseDisturb2', '_IntensityU_02', '_IntensityV_02', '_AnchorU_02', '_AnchorV_02', '_ToggleUseDissolve', '_Amount', '_BorderWidth'])}
void main() {
  vec4 tw = fract(u_Time.y * u_UVTween);
  vec2 d1 = vec2(0.0), d2 = vec2(0.0);
  ${d.lite ? '' : `
  float n1 = texture(u_DisturTex, st(v_uv, u_DisturTex_ST) + tw.zw).r;
  d1 = vec2(n1) - vec2(u_AnchorU, u_AnchorV);
  if (u_ToggleUseDisturb2 > 0.5) d2 = vec2(texture(u_DisturTex_02, st(v_uv, u_DisturTex_02_ST)).r) - vec2(u_AnchorU_02, u_AnchorV_02);
  ${d.weight ? 'vec2 w = texture(u_WeightTex, st(v_uv, u_WeightTex_ST)).rg; d1 *= w; d2 *= w;' : ''}`}
  vec2 uv = v_uv + d1 * vec2(u_IntensityU, u_IntensityV) + d2 * vec2(u_IntensityU_02, u_IntensityV_02);
  vec4 c = texture(u_MainTex, st(uv, u_MainTex_ST) + tw.xy) * u_MainColor * v_col * 2.0;
  c.a *= 1.0 + u_MainColorACtrl * (u_MainColor.a - 1.0);
  c.rgb *= 1.0 + u_MainColorACtrl * (u_MainColor.a - 1.0);
  if (u_ToggleUseDissolve > 0.5) c.a = clamp(c.a * dissolveMask(texture(u_DissolveTex, st(uv, u_DissolveTex_ST)).r, u_Amount, u_BorderWidth), 0.0, 1.0);
  o_col = c;
}`,
  },
  // Disturb(CustomData): weight-masked distortion of the main UV (and optionally the dissolve UV), scrolled UVs,
  // optional UV rotations (FxUVRotation), dissolve, opacity
  disturbCd: {
    tex: ['_MainTex', '_DisturbTex', '_WeightTex', '_DissolveTex'],
    src: (d) => `${S(['_MainTex', '_DisturbTex', '_WeightTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_DisturbTex_ST', '_WeightTex_ST', '_MainColor', '_Rotation0', '_Rotation1', '_Rotation2', '_Rotation3'])}
${U1(['_HG_UV_ROTATION', '_MainUSpeed', '_MainVSpeed', '_DissolveUSpeed', '_DissolveVSpeed', '_DisturbUSpeed', '_DisturbVSpeed', '_MainTexChannel', '_DisturbTexChannel', '_DissolvTexChannel', '_Opacity', '_PremultiplyAlpha', '_DisturbInfluenceDissolveUV', '_Amount', '_BorderWidth', '_IntensityU', '_IntensityV', '_DisturbScale'])}
void main() {
  vec2 o0 = vec2(0.0), o1 = vec2(0.0), o3 = vec2(0.0); float addA = 0.0, addI = 0.0;
  ${d.cvs ? 'o0 = v_t0; o1 = v_t1.xy; addA = v_t1.z; addI = v_t1.w; o3 = v_t2.xy;' : ''}
  vec2 muv = uvRot(st(v_uv, u_MainTex_ST) + o0, u_Rotation0, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_MainUSpeed, u_MainVSpeed));
  vec2 duv = uvRot(st(v_uv, u_DissolveTex_ST) + o1, u_Rotation1, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_DissolveUSpeed, u_DissolveVSpeed));
  vec2 wuv = uvRot(st(v_uv, u_WeightTex_ST), u_Rotation2, u_HG_UV_ROTATION);
  vec2 tuv = uvRot(st(v_uv, u_DisturbTex_ST) + o3, u_Rotation3, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_DisturbUSpeed, u_DisturbVSpeed));
  vec2 dist = vec2(0.0);
  ${d.lite ? '' : `vec2 w = texture(u_WeightTex, wuv).rg;
  dist = (vec2(addI) + vec2(u_IntensityU, u_IntensityV)) * chan1(texture(u_DisturbTex, tuv), u_DisturbTexChannel) * w;`}
  float sc = u_DisturbScale > 0.0 ? u_DisturbScale : 1.0;
  vec4 t = chan4(texture(u_MainTex, muv + dist * sc), u_MainTexChannel) * u_MainColor * v_col;
  float a = 2.0 * t.a * u_Opacity;
  float dv = chan1(texture(u_DissolveTex, duv + u_DisturbInfluenceDissolveUV * dist), u_DissolvTexChannel);
  a = clamp(dissolveMask(dv, u_Amount + addA, u_BorderWidth) * a, 0.0, 1.0);
  o_col = premul(t.rgb * 2.0, a, u_PremultiplyAlpha);
}`,
  },
  // Ram/Disturb(CustomData): Disturb(CustomData) with a ramp texture multiplied in
  ramDisturbCd: {
    tex: ['_MainTex', '_DisturbTex', '_RamTex', '_DissolveTex'],
    src: (d) => `${S(['_MainTex', '_DisturbTex', '_RamTex', '_DissolveTex'])}
${U4(['_MainTex_ST', '_DissolveTex_ST', '_DisturbTex_ST', '_RamTex_ST', '_MainColor', '_Rotation0', '_Rotation1', '_Rotation2', '_Rotation3'])}
${U1(['_HG_UV_ROTATION', '_MainUSpeed', '_MainVSpeed', '_DissolveUSpeed', '_DissolveVSpeed', '_DisturbUSpeed', '_DisturbVSpeed', '_MainTexChannel', '_DisturbTexChannel', '_DissolvTexChannel', '_RamTexChannel', '_Opacity', '_PremultiplyAlpha', '_DisturbInfluenceDissolveUV', '_DisturbInfluenceMainUV', '_Amount', '_BorderWidth', '_IntensityU', '_IntensityV'])}
void main() {
  vec2 o0 = vec2(0.0), o1 = vec2(0.0), o3 = vec2(0.0); float addA = 0.0, addI = 0.0;
  ${d.cvs ? 'o0 = v_t0; o1 = v_t1.xy; addA = v_t1.z; addI = v_t1.w; o3 = v_t2.xy;' : ''}
  vec2 muv = uvRot(st(v_uv, u_MainTex_ST) + o0, u_Rotation0, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_MainUSpeed, u_MainVSpeed));
  vec2 duv = uvRot(st(v_uv, u_DissolveTex_ST) + o1, u_Rotation1, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_DissolveUSpeed, u_DissolveVSpeed));
  vec2 ruv = uvRot(st(v_uv, u_RamTex_ST), u_Rotation2, u_HG_UV_ROTATION);
  vec2 tuv = uvRot(st(v_uv, u_DisturbTex_ST) + o3, u_Rotation3, u_HG_UV_ROTATION) + fract(u_Time.y * vec2(u_DisturbUSpeed, u_DisturbVSpeed));
  vec4 ram = chan4(texture(u_RamTex, ruv), u_RamTexChannel);
  vec4 dist = vec4(0.0);
  ${d.lite ? '' : 'dist = (vec4(addI) + vec4(u_IntensityU, u_IntensityV, u_IntensityU, u_IntensityV)) * chan1(texture(u_DisturbTex, tuv), u_DisturbTexChannel);'}
  vec2 muv2 = muv + dist.xy * u_DisturbInfluenceMainUV;
  vec2 duv2 = duv + dist.zw * u_DisturbInfluenceDissolveUV;
  vec4 t = chan4(texture(u_MainTex, muv2), u_MainTexChannel) * u_MainColor * v_col * ram;
  float a = 2.0 * t.a * u_Opacity;
  float dv = chan1(texture(u_DissolveTex, duv2), u_DissolvTexChannel);
  a = clamp(dissolveMask(dv, u_Amount + addA, u_BorderWidth) * a, 0.0, 1.0);
  o_col = premul(t.rgb * 2.0, a, u_PremultiplyAlpha);
}`,
  },
  // Ram Add / AlphaBlend: main texture × a ramp texture × 2 × colour
  ram: {
    tex: ['_MainTex', '_RamTex'],
    src: () => `${S(['_MainTex', '_RamTex'])}
${U4(['_MainTex_ST', '_RamTex_ST', '_TintColor'])}
void main() {
  vec4 c = texture(u_RamTex, st(v_uv, u_RamTex_ST)) * 2.0 * v_col * u_TintColor * texture(u_MainTex, st(v_uv, u_MainTex_ST));
  o_col = vec4(c.rgb, clamp(c.a, 0.0, 1.0));
}`,
  },
  // Mask (Add / AlphaBlend): main texture + 2 × an added texture masked by the mask's alpha × _AddFactor
  mask: {
    tex: ['_MainTex', '_MaskTex', '_AddTex'],
    src: () => `${S(['_MainTex', '_MaskTex', '_AddTex'])}
${U4(['_MainTex_ST', '_AddTex_ST', '_TintColor'])}
${U1(['_AddFactor'])}
void main() {
  vec2 muv = st(v_uv, u_MainTex_ST);
  vec4 add = texture(u_AddTex, st(v_uv, u_AddTex_ST)) * texture(u_MaskTex, muv).a * u_AddFactor;
  vec4 c = (add * 2.0 + texture(u_MainTex, muv)) * 2.0 * v_col * u_TintColor;
  o_col = vec4(c.rgb, clamp(c.a, 0.0, 1.0));
}`,
  },
  // Rim Texture (Add / AlphaBlend): a fresnel rim (1 − n·v)^_RimPower × tint × colour, × 2 × texture
  rimTex: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_MainTex_ST', '_TintColor'])}
${U1(['_RimPower'])}
void main() {
  vec3 v = normalize(u_WorldSpaceCameraPos - v_wpos);
  float r = pow(max(1.0 - clamp(dot(v, normalize(v_nrm)), 0.0, 1.0), 1e-5), u_RimPower);
  vec4 c = vec4(r * u_TintColor.rgb * v_col.rgb, r * u_TintColor.a) * 2.0 * texture(u_MainTex, st(v_uv, u_MainTex_ST));
  o_col = vec4(c.rgb, clamp(c.a, 0.0, 1.0));
}`,
  },
  // Rim Tint (Add / AlphaBlend): the rim colour alone
  rimTint: {
    tex: [],
    src: () => `${U4(['_TintColor'])}
${U1(['_RimPower'])}
void main() {
  vec3 v = normalize(u_WorldSpaceCameraPos - v_wpos);
  float r = pow(max(1.0 - clamp(dot(v, normalize(v_nrm)), 0.0, 1.0), 1e-5), u_RimPower);
  o_col = vec4(r * u_TintColor.rgb * v_col.rgb, r * u_TintColor.a);
}`,
  },
  // Flipbook (Add / Blend): an in-shader sprite sheet (_Rows × _Columns at _Speed), adjacent frames blended
  flipbook: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_TintColor'])}
${U1(['_Rows', '_Columns', '_Speed', '_AlphaIntensity'])}
void main() {
  float n = max(1.0, u_Rows * u_Columns), t = u_Time.y * u_Speed;
  float f = fract(t) * n, f0 = floor(f), f1 = mod(f0 + 1.0, n), k = fract(f);
  vec2 cell = vec2(1.0 / max(u_Rows, 1.0), 1.0 / max(u_Columns, 1.0));
  vec2 c0 = vec2(mod(f0, u_Rows), u_Columns - 1.0 - floor(f0 / u_Rows));
  vec2 c1 = vec2(mod(f1, u_Rows), u_Columns - 1.0 - floor(f1 / u_Rows));
  vec4 c = mix(texture(u_MainTex, (c0 + v_uv) * cell), texture(u_MainTex, (c1 + v_uv) * cell), k);
  c.a = clamp(c.a * u_AlphaIntensity, 0.0, 1.0);
  o_col = c * v_col * u_TintColor;
}`,
  },
  // Multiply: lerp(1, texture × colour, texture alpha × colour alpha) (blend DstColor Zero — gl.js maps it for the
  // transparent canvas: darkening by the luminance)
  multiply: {
    tex: ['_MainTex'],
    src: () => `${S(['_MainTex'])}
${U4(['_MainTex_ST'])}
void main() {
  vec4 t = texture(u_MainTex, st(v_uv, u_MainTex_ST));
  vec4 cl = clamp(v_col, 0.0, 1.0);
  vec3 m = mix(vec3(1.0), t.rgb * cl.rgb, t.a * cl.a);
  o_col = vec4(m, 1.0 - dot(m, vec3(0.299, 0.587, 0.114)));
}`,
  },
};

/** The fragment shader of a family. */
export function fragmentSource(family, defs = {}) {
  const f = FAMILIES[family] || FAMILIES.basic;
  return `${HEAD}${VARY_IN}${COMMON}${f.src(defs)}`;
}
