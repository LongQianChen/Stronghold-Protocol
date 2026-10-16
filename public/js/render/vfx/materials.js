// render/vfx/materials.js — the official effects' materials (DESIGN §33.7) compiled for render/vfx/gl.js: the
// shader family of render/vfx/glsl.js, the uniform values (floats, colours / vectors, textures with their _ST), the
// render state of the material's first pass (blend factors, blend op, ZTest, ZWrite, cull, colour mask) and its queue.
//
//   compileMaterial(m, { lite })  → { family, defs, key, floats, vecs, textures, state, queue, fallback }
//   familyOf(shaderName)          → { family, fallback?: true }   (unknown and unported shaders fall back to the
//                                   closest simple family; `fallbackLog()` lists them once each)
//
// The light tier (精简) compiles the distortion families without their distortion lookups and draws the Rim shaders
// as the basic family ("exotic shaders fall back").

const BLEND = Object.freeze({
  Zero: 0, One: 1, DstColor: 2, SrcColor: 3, OneMinusDstColor: 4, SrcAlpha: 5, OneMinusSrcColor: 6, DstAlpha: 7,
  OneMinusDstAlpha: 8, SrcAlphaSaturate: 9, OneMinusSrcAlpha: 10,
});
export { BLEND };

/** Unity CompareFunction names → our depth test (null = always pass / disabled). */
const ZTEST = Object.freeze({ Disabled: null, Never: 'never', Less: 'less', Equal: 'equal', LessEqual: 'lequal', Greater: 'greater', NotEqual: 'notequal', GreaterEqual: 'gequal', Always: null });

/** Family by exact shader name. */
const BY_NAME = {
  'Torappu/Particles/Additive': 'basic', 'Torappu/Particles/AlphaBlend': 'basic', 'Torappu/Particles-L2D/Additive': 'basic',
  'Torappu/Particles-L2D/AlphaBlend': 'basic', 'Torappu/Particles/AlphaBlend(ZWrite)': 'basic', 'Torappu/Particles/Bloom/Additive': 'basic',
  'Torappu/Particles/Bloom/AlphaBlend': 'basic', 'Torappu/Particles/Bloom/Opaque': 'basic', 'Torappu/Particles/Battle/AlphaBlend(TileBasedTintColor)': 'basic',
  'Torappu/Particles/ZDistort/Additive': 'basic', 'Torappu/Particles/ZDistort/AlphaBlend': 'basic', 'Torappu/Particles/Cutout': 'basic',
  'Torappu/Particles/Common': 'basic',
  'Legacy Shaders/Particles/Alpha Blended Premultiply': 'legacyPremul', 'Legacy Shaders/Particles/Alpha Blended': 'legacyAlpha',
  'Particles/Standard Unlit': 'stdUnlit',
  'Torappu/Particles/Dissolve/Dissolve AB': 'dissolve', 'Torappu/Particles/Dissolve/Dissolve Add': 'dissolve',
  'Torappu/Particles-L2D/Dissolve/Dissolve AB': 'dissolve', 'Torappu/Particles-L2D/Dissolve/Dissolve Add': 'dissolve',
  'Torappu/Particles/Bloom/Dissolve/Dissolve Add': 'dissolve', 'Torappu/Particles/Bloom/Dissolve/Dissolve AlphaBlend': 'dissolve',
  'Torappu/Particles/Dissolve/Dissolve Cutout': 'dissolve',
  'Torappu/Particles/Dissolve/Dissolve AB UVTween': 'dissolveTween', 'Torappu/Particles/Dissolve/Dissolve Add UVTween': 'dissolveTween',
  'Torappu/Particles-L2D/Dissolve/Dissolve AB UVTween': 'dissolveTween', 'Torappu/Particles-L2D/Dissolve/Dissolve Add UVTween': 'dissolveTween',
  'Torappu/Particles/Dissolve/Dissolve AB (VertexColor Major)': 'dissolveVc', 'Torappu/Particles/Dissolve/Dissolve Add (VertexColor Major)': 'dissolveVc',
  'Torappu/Particles-L2D/Dissolve/Dissolve AB (VertexColor Major)': 'dissolveVc', 'Torappu/Particles-L2D/Dissolve/Dissolve Add (VertexColor Major)': 'dissolveVc',
  'Torappu/Particles/Dissolve/Dissolve AB Double': 'dissolveDouble', 'Torappu/Particles/Dissolve/Dissolve Add Double': 'dissolveDouble',
  'Torappu/Particles/Dissolve/Dissolve Double': 'dissolveDouble', 'Torappu/Particles-L2D/Dissolve/Dissolve AB Double': 'dissolveDouble',
  'Torappu/Particles-L2D/Dissolve/Dissolve Add Double': 'dissolveDouble', 'Torappu/Particles-L2D/Dissolve/Dissolve AB Double edge': 'dissolveDouble',
  'Torappu/Particles-L2D/Dissolve/Dissolve Add Double edge': 'dissolveDouble',
  'Torappu/Particles/Dissolve/Dissolve(CustomData)': 'dissolveCd', 'Torappu/Particles-L2D/Dissolve/Dissolve(CustomData)': 'dissolveCd',
  'Torappu/Particles/ZDistort/Dissolve(CustomData)': 'dissolveCd',
  'Torappu/Particles/Disturb/Disturb Origin': 'disturbOrigin',
  'Torappu/Particles-L2D/Disturb/Disturb (Add)': 'disturbOrigin', 'Torappu/Particles-L2D/Disturb/Disturb (AlphaBlend)': 'disturbOrigin',
  'Torappu/Particles-L2D/Disturb/Disturb2 (Add)': 'disturbOrigin', 'Torappu/Particles-L2D/Disturb/Disturb2 (AlphaBlend)': 'disturbOrigin',
  'Torappu/Particles/Disturb/Disturb Anchor': 'disturbAnchor', 'Torappu/Particles-L2D/Disturb/Disturb Anchor (Add)': 'disturbAnchor',
  'Torappu/Particles-L2D/Disturb/Disturb Anchor (AlphaBlend)': 'disturbAnchor',
  'Torappu/Particles/Disturb/Disturb(CustomData)': 'disturbCd', 'Torappu/Particles-L2D/Disturb/Disturb(CustomData)': 'disturbCd',
  'Torappu/Particles/ZDistort/Disturb(CustomData)': 'disturbCd', 'Torappu/Particles/Disturb/Disturb(CustomData-RT)': 'disturbCd',
  'Torappu/Particles/Ram/Disturb(CustomData)': 'ramDisturbCd', 'Torappu/Particles-L2D/Ram/Disturb(CustomData)': 'ramDisturbCd',
  'Torappu/Particles/Ram/VertexDisturb(CustomData)': 'ramDisturbCd', 'Torappu/Particles-L2D/Ram/VertexDisturb(CustomData)': 'ramDisturbCd',
  'Torappu/Particles/Ram/Add': 'ram', 'Torappu/Particles/Ram/AlphaBlend': 'ram', 'Torappu/Particles-L2D/Ram/Add': 'ram', 'Torappu/Particles-L2D/Ram/AlphaBlend': 'ram',
  'Torappu/Particles/Mask/Mask (Add)': 'mask', 'Torappu/Particles/Mask/Mask (AlphaBlend)': 'mask',
  'Torappu/Particles-L2D/Mask/Mask (Add)': 'mask', 'Torappu/Particles-L2D/Mask/Mask (AlphaBlend)': 'mask',
  'Torappu/Particles/Rim/Rim Texture (Add)': 'rimTex', 'Torappu/Particles/Rim/Rim Texture (AlphaBlend)': 'rimTex',
  'Torappu/Particles-L2D/Rim/Rim Texture (Add)': 'rimTex', 'Torappu/Particles-L2D/Rim/Rim Texture (AlphaBlend)': 'rimTex',
  'Torappu/Particles/Rim/Rim Tint (Add)': 'rimTint', 'Torappu/Particles/Rim/Rim Tint (AlphaBlend)': 'rimTint',
  'Torappu/Particles-L2D/Rim/Rim Tint (Add)': 'rimTint', 'Torappu/Particles-L2D/Rim/Rim Tint (AlphaBlend)': 'rimTint',
  'Torappu/Particles/Flipbook(Add)': 'flipbook', 'Torappu/Particles/Flipbook(Blend)': 'flipbook',
  'Torappu/Particles/Multiply': 'multiply', 'Torappu/Particles-L2D/Multiply': 'multiply',
};

const fallbacks = new Map(); // shader name → family it falls back to

/** Shader family of a shader name (see the header). */
export function familyOf(name) {
  const s = String(name || '');
  if (BY_NAME[s]) return { family: BY_NAME[s] };
  // unported (GrabPass distortions, RGB split, blur, toon / matcap, outline, SimSpine, erase …) or unknown: the closest
  // simple family by name
  let family = 'basic';
  if (/Dissolve/.test(s)) family = /CustomData/.test(s) ? 'dissolveCd' : /Double/.test(s) ? 'dissolveDouble' : 'dissolve';
  if (!fallbacks.has(s)) fallbacks.set(s, family);
  return { family, fallback: true };
}

/** Shaders that fell back so far: [[shader name, family]] (logged by the dev viewer and the report). */
export function fallbackLog() { return [...fallbacks.entries()]; }

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Defaults for uniforms a family reads but a shader does not declare. */
export const UNIFORM_DEFAULTS = Object.freeze({
  _PremultiplyAlpha: 5, _Opacity: 1, _DisturbScale: 1, _MainColorACtrl: 1, _AlphaIntensity: 1, _RimPower: 3, _AddFactor: 0.5,
  _BorderWidth: 0.1, _Amount: 0.5,
});
const DEFAULT_VEC = Object.freeze({ _Rotation0: [1, 0, 0, 1], _Rotation1: [1, 0, 0, 1], _Rotation2: [1, 0, 0, 1], _Rotation3: [1, 0, 0, 1], _Color: [1, 1, 1, 1] });

/**
 * Compile a descriptor material.
 * @param {any} m descriptor.materials[i]
 * @param {{ lite?: boolean }} [opts]
 */
export function compileMaterial(m, opts = {}) {
  const lite = !!opts.lite;
  let { family, fallback } = familyOf(m?.shader);
  if (lite && (family === 'rimTex' || family === 'rimTint')) { family = 'basic'; fallback = true; }
  const kw = new Set(Array.isArray(m?.keywords) ? m.keywords : []);
  const floats = {}, vecs = {};
  for (const [k, v] of Object.entries(isObj(m?.floats) ? m.floats : {})) if (Number.isFinite(v)) floats[k] = v;
  for (const [k, v] of Object.entries(isObj(m?.colors) ? m.colors : {})) {
    if (Array.isArray(v)) vecs[k] = [num(v[0], 0), num(v[1], 0), num(v[2], 0), num(v[3], 1)];
  }
  for (const [k, v] of Object.entries(DEFAULT_VEC)) if (!vecs[k]) vecs[k] = v.slice();
  if (family === 'stdUnlit') floats._EmissionEnabled = kw.has('_EMISSION') ? 1 : 0;
  const textures = [];
  for (const [name, t] of Object.entries(isObj(m?.textures) ? m.textures : {})) {
    const s = Array.isArray(t?.st) ? t.st : [1, 1, 0, 0];
    vecs[name + '_ST'] = [num(s[0], 1), num(s[1], 1), num(s[2], 0), num(s[3], 0)];
    const key = typeof t?.tex === 'string' && !t.tex.startsWith('builtin:') ? t.tex : null;
    textures.push({ name, key, def: typeof t?.default === 'string' ? t.default : (/Distur|Disturb|Add|Mask/.test(name) ? 'black' : 'white') });
  }
  const p = Array.isArray(m?.passes) && m.passes.length ? m.passes[0] : {};
  const b = Array.isArray(p.blend) ? p.blend : ['SrcAlpha', 'OneMinusSrcAlpha', 'Zero', 'OneMinusSrcAlpha'];
  const state = {
    src: BLEND[b[0]] ?? BLEND.SrcAlpha, dst: BLEND[b[1]] ?? BLEND.OneMinusSrcAlpha,
    srcA: BLEND[b[2]] ?? BLEND.Zero, dstA: BLEND[b[3]] ?? BLEND.OneMinusSrcAlpha,
    op: String(p.blendOp || 'Add'),
    zTest: Object.prototype.hasOwnProperty.call(ZTEST, p.zTest) ? ZTEST[p.zTest] : 'lequal',
    zWrite: p.zWrite === true || p.zWrite === 1,
    cull: p.cull === 'Back' || p.cull === 'Front' ? p.cull : 'Off',
    colorMask: num(p.colorMask, 15) | 0,
  };
  const queue = typeof m?.queue === 'number' ? m.queue : m?.queue === 'Geometry' ? 2000 : m?.queue === 'AlphaTest' ? 2450 : m?.queue === 'Overlay' ? 4000 : 3000;
  const defs = { cvs: kw.has('_HGCUSTOMVERTEXSTREAM_ON') || num(floats._HGCustomVertexStream, 0) > 0.5, weight: kw.has('_WEIGHT_ON') || num(floats._Weight, 0) > 0.5, lite };
  const key = `${family}|${defs.cvs ? 1 : 0}${defs.weight ? 1 : 0}${lite ? 1 : 0}`;
  return { name: m?.name || '', shader: m?.shader || '', family, defs, key, floats, vecs, textures, state, queue, fallback: !!fallback };
}
