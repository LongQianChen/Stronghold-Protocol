// test/render/vfx-skill-fixes.test.js — the maintainer's skill-effect reports of 2026-10-15 (round 46, history
// §32.14.38) and the shared causes the audit fixed in render/vfx: skinned meshes with the client's 1–2 bone influences
// per vertex (铃兰 S3's fox tails: a strip across the board), renderers that sort before the units (野鬃 S2's ring of
// lances drawn over her body), a projectile's effects on its target and tile and a timer projectile's hit (溯光星源
// S3's lightning: only her shot straight up was drawn), a projectile's own flying effect (the index's `main` named the
// chain or the rope) and a harpoon's rope — a chain's line is not flown (the client draws it between the chain's
// targets as the shot reaches them: the merge with §32.14.36) —, world-space LineRenderers' placeholder points, and the
// attach rows of a skill's mode (溯光星源 S3's range).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect, behindUnits, basisOf } from '../../public/js/render/vfx/effect.js';
import { completeAxes } from '../../public/js/render/vfx/psys.js';
import { FrameData, cameraBasis, buildSkinned, skinStride, STRIP_STRIDE } from '../../public/js/render/vfx/geom.js';
import { FxWiring, TIMER_HIT_MAX } from '../../public/js/render/vfx/wiring.js';
import { projectileParts } from '../../public/js/render/vfx/flight.js';
import { skillPlan, attachUses } from '../../public/js/render/vfx/skills.js';
import { mat4Trs } from '../../public/js/render/vfx/math.js';
import { builtinMesh } from '../../public/js/render/vfx/library.js';

const CAM = cameraBasis(30, [0, -5, -8], 720, 0.7);
const MAT = {
  name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
  queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
};
const node = (id, parent, o = {}) => ({ id, name: `n${id}`, parent, children: [], active: true, pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0, 1], scale: o.scale || [1, 1, 1], ...o.extra });
function desc(nodes) {
  for (const n of nodes) if (n.parent != null) nodes[n.parent].children.push(n.id);
  return { format: 'fx-prefab', version: 1, key: 'test', nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {} };
}
const root = () => node(0, null, { extra: { behaviours: [{ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 1, _rotateType: 0, _spawnLocation: 1 } }] } });
const mr = (order, layer = 0, mesh = 'cone') => ({ meshFilter: mesh, meshRenderer: { m_Enabled: true, materials: [0], m_SortingOrder: order, m_SortingLayer: layer } });

// a cone (not flat in its mesh space) and a flat quad
const CONE = { positions: [0, 0, 0, 1, 0, 1, -1, 0, 1, 0, 1, 1], uv0: [0, 0, 1, 0, 0, 1, 1, 1], submeshes: [[0, 1, 2, 0, 2, 3]] };
const LIB = { mesh: (k) => (k === 'cone' ? CONE : k.startsWith('builtin:') ? builtinMesh(k.slice(8)) : null) };

describe('skinned meshes: the client keeps 1–4 bone influences per vertex (铃兰 S3\'s fox tails)', () => {
  // two bones: bone 0 moved +1 in x, bone 1 moved +2 in y; identity bind poses (row-major)
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const bones = [mat4Trs([1, 0, 0], [0, 0, 0, 1], [1, 1, 1]), mat4Trs([0, 2, 0], [0, 0, 0, 1], [1, 1, 1])];
  const base = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uv0: [0, 0, 1, 0, 0, 1], submeshes: [[0, 1, 2]], bindPoses: [I, I] };
  const verts = (md) => {
    const fd = new FrameData();
    const r = buildSkinned(md, bones, 0, fd, null);
    if (!r) return null;
    return [0, 1, 2].map((v) => [0, 1, 2].map((c) => Math.round(fd.strip[v * STRIP_STRIDE + c] * 1e4) / 1e4));
  };
  const want = [[0.5, 1, 0], [2, 0, 0], [0, 3, 0]];

  test('four influences per vertex (§33.9, the fixed extractor): Σ w · (bone · bind pose) · v', () => {
    const md = { ...base, boneIndices: [0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], boneWeights: [0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] };
    assert.equal(skinStride(md), 4);
    assert.deepEqual(verts(md), want);
  });

  test('two per vertex (an extraction made before the fix) reads the same — read as four, the vertices fell apart into a strip', () => {
    const md = { ...base, boneIndices: [0, 1, 0, 0, 1, 0], boneWeights: [0.5, 0.5, 1, 0, 1, 0] };
    assert.equal(skinStride(md), 2);
    assert.deepEqual(verts(md), want);
  });

  test('one bone per vertex without weights (the client drops BlendWeight): each vertex follows its bone; no indices: not drawn', () => {
    const md = { ...base, boneIndices: [1, 0, 1] };
    assert.equal(skinStride(md), 1);
    assert.deepEqual(verts(md), [[0, 2, 0], [2, 0, 0], [0, 3, 0]]);
    assert.equal(skinStride({ ...base }), 0, 'a skin without bone indices (the old export of these meshes)');
    assert.equal(verts({ ...base }), null);
    assert.equal(skinStride({ ...base, boneIndices: [0, 1], bindPoses: [I, I] }), 0, 'a count that is no whole number per vertex');
  });
});

describe('renderers that sort before the units draw under them (野鬃 S2\'s ring of lances)', () => {
  const gathered = (nodes) => {
    const fx = new Effect(compileEffect(desc([root(), ...nodes])), { seed: 1, lib: LIB });
    fx.update(1 / 30);
    const out = [];
    fx.gather(CAM, (e) => out.push(e));
    return out;
  };

  test('behindUnits: a lower sorting layer, or the Default layer with a negative order (the units: layer 0, order 0)', () => {
    assert.equal(behindUnits(0, -3), true);
    assert.equal(behindUnits(0, 0), false);
    assert.equal(behindUnits(0, 2), false);
    assert.equal(behindUnits(-2, 5), true);
    assert.equal(behindUnits(3, -5), false);
  });

  test('a cone at order −3 (野鬃\'s huan) is in the ground pass; at order 2 over the units; a flat decal at order 0 stays on the ground', () => {
    const [behind] = gathered([node(1, 0, { extra: mr(-3) })]);
    assert.equal(behind.ground, true);
    const [front] = gathered([node(1, 0, { extra: mr(2) })]);
    assert.equal(front.ground, false, 'not flat, a positive order: over the units as before');
    const [layer] = gathered([node(1, 0, { extra: mr(5, -2) })]);
    assert.equal(layer.ground, true, 'a layer below Default');
    const [decal] = gathered([node(1, 0, { extra: mr(0, 0, 'builtin:Quad') })]);
    assert.equal(decal.ground, true, 'a flat quad lying on the ground (the flat rule)');
  });
});

describe('LineRenderers: the authored points are placeholders, the game sets the end points', () => {
  const line = (world) => ({ lineRenderer: { m_Enabled: true, materials: [0], m_UseWorldSpace: world, m_Positions: [[5, 4, -0.24], [6, 3, -0.24]], m_Parameters: { widthMultiplier: 0.5, widthCurve: [[0, 1, 0, 0]], colorGradient: null, alignment: 0, textureMode: 0 } } });

  test('a world-space line draws nothing until linkLines (溯光星源 S1\'s chain sat at world (5, 4) → (6, 3)); then it runs from → to', () => {
    const fx = new Effect(compileEffect(desc([root(), node(1, 0, { extra: line(true) })])), { seed: 1 });
    fx.update(1 / 30);
    const items = [];
    fx.collect(CAM, new FrameData(), (it) => items.push(it), 1);
    assert.equal(items.length, 0, 'no placeholder line');
    assert.equal(fx.hasLines, true);
    fx.linkLines([-3, 1, -0.4], [-1, 1, -0.4]);
    const fd = new FrameData();
    fx.collect(CAM, fd, (it) => items.push(it), 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].part, 'line');
    const xs = [0, 1, 2, 3].map((v) => fd.strip[v * STRIP_STRIDE]);
    assert.ok(Math.min(...xs) >= -3.01 && Math.max(...xs) <= -0.99 && Math.max(...xs) - Math.min(...xs) > 1.9, `the ribbon spans the end points: ${xs}`);
  });

  test('a node-space line draws its authored points (a range outline)', () => {
    const fx = new Effect(compileEffect(desc([root(), node(1, 0, { extra: line(false) })])), { seed: 1 });
    fx.update(1 / 30);
    const items = [];
    fx.collect(CAM, new FrameData(), (it) => items.push(it), 1);
    assert.equal(items.length, 1);
  });
});

describe('projectiles: the flying effect, the link line, the effects on the target and the timer\'s hit', () => {
  const simple = (main, life = 10, type = 1) => ({ class: 'SimpleProjectile', node: 'p', fields: { _mainEffect: main, _lifeTimeType: type, _lifeTime: life } });

  test('projectileParts: the projectile class\'s _mainEffect and life; a chain\'s and a harpoon\'s lines by their class (the index\'s `main` named them)', () => {
    // (render/vfx/flight.js since the merge with §32.14.36: `link` became `rope` — drawn in flight — and `chain` — not)
    const chain = { main: 'pasngr_attack_line', lifeTime: null, behaviours: [simple('pasngr_attack_trail'), { class: 'ChainLightningEffectBehaviour', node: 'p', fields: { _mainEffect: 'pasngr_attack_line' } }] };
    assert.deepEqual({ ...projectileParts(chain) }, { main: 'pasngr_attack_trail', rope: null, chain: 'pasngr_attack_line', life: 10 });
    const harpoon = { main: 'glady_skill_01_line', behaviours: [{ class: 'HarpoonProjectile', node: 'p', fields: { _mainEffect: 'glady_skill_01_trail', _lifeTimeType: 1, _lifeTime: 5 } }, { class: 'HarpoonRenderer', node: 'p', fields: { _mainEffect: 'glady_skill_01_line' } }] };
    assert.deepEqual({ ...projectileParts(harpoon) }, { main: 'glady_skill_01_trail', rope: 'glady_skill_01_line', chain: null, life: 5 });
    const timer = { main: null, lifeTime: 0.517, behaviours: [simple('', 0.517)] };
    assert.deepEqual({ ...projectileParts(timer) }, { main: null, rope: null, chain: null, life: 0.517 }, '溯光星源 S3: no flying effect, a 0.517 s life');
    // an index of the fixed extractor: `main` the projectile class's own, `link` the line (its class in `behaviours`)
    const fixed = { main: 'A_Trail', link: 'a_line', lifeTime: 2, behaviours: [simple('A_Trail', 2), { class: 'HarpoonRenderer', node: 'p', fields: { _mainEffect: 'A_Line' } }] };
    assert.deepEqual({ ...projectileParts(fixed) }, { main: 'a_trail', rope: 'a_line', chain: null, life: 2 }, 'a fixed index');
    assert.deepEqual({ ...projectileParts({ main: 'B_Trail', lifeTime: 2 }) }, { main: 'b_trail', rope: null, chain: null, life: 2 }, 'no behaviours: its main and life');
    assert.deepEqual({ ...projectileParts(null) }, { main: null, rope: null, chain: null, life: null });
  });

  async function setup() {
    const prefabs = ['bolt', 'tile_fx', 'hit', 'trail', 'line', 'pc', 'head', 'rope'].reduce((o, k) => ({ ...o, [k]: { looping: false } }), {});
    const index = {
      format: 'fx-index', version: 3, skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {} }, prefabs,
      units: { char_1_sh: { kind: 'char', modes: [{ name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'p_timer', cast: [], hit: [] } }], skills: {} } },
      projectiles: {
        p_timer: { main: null, lifeTime: 0.517, onHit: ['hit'], toTargetOnStart: ['bolt'], toTileOnStart: ['tile_fx'], effects: ['bolt', 'tile_fx', 'hit'], behaviours: [simple('', 0.517)] },
        p_chain: { main: 'line', lifeTime: null, onHit: ['hit'], effects: ['hit', 'line', 'trail'], behaviours: [simple('trail'), { class: 'ChainLightningEffectBehaviour', node: 'p', fields: { _mainEffect: 'line' } }] },
        p_harp: { main: 'rope', lifeTime: null, onHit: ['hit'], effects: ['hit', 'rope', 'head'], behaviours: [{ class: 'HarpoonProjectile', node: 'p', fields: { _mainEffect: 'head' } }, { class: 'HarpoonRenderer', node: 'p', fields: { _mainEffect: 'rope' } }] },
      },
    };
    const handles = [];
    const ofx = {
      active: true, time: 0, lite: false, timers: [],
      lib: { has: (k) => !!prefabs[k], def: (k) => (prefabs[k] ? { spawn: k === 'tile_fx' ? 5 : 2, rotateType: k === 'bolt' ? 1 : 0, leftIsDefault: false, rotY: k === 'bolt' ? 2 : -1, isLoop: false } : null), index: async () => index, preload: async () => 0, defs: new Map() },
      spawn(key, place, opts) { const h = { key, place, opts, stopped: false, stop() { this.stopped = true; }, kill() { this.stopped = true; } }; handles.push(h); return h; },
    };
    const w = new FxWiring(ofx, { speed: () => 11 });
    await w.ready();
    const v = (id, key, x, y = 10, facing = 1) => ({ id, x, y, z: 0, visFacing: facing, isEnemy: /^enemy_/.test(key), alive: true, flags: 0, info: { id, spine: key, defId: key } });
    const step = (dt) => { ofx.time += dt; w.tick(); };
    return { w, ofx, handles, v, step, index };
  }

  test('a timer projectile (溯光星源 S3): its lightning on the target and its tile effect at the start, its hit at the end of its life', async () => {
    const { w, ofx, handles, v, step, index } = await setup();
    const src = v(1, 'char_1_sh', 5), tgt = v(2, 'enemy_9_x', 7.4, 10.2, -1);
    w._fly(index.projectiles.p_timer, src, tgt, 'bolt', ofx.time);
    const bolt = handles.find((h) => h.key === 'bolt');
    assert.ok(bolt, 'toTargetOnStart plays');
    assert.equal(bolt.place.flipY, false, 'shot from the left: the art as authored (from the upper left)');
    assert.ok(Math.abs(bolt.place.pos[0] - (7.4 - 10)) < 1e-6, 'on the target');
    assert.equal(typeof bolt.opts.track, 'function', 'kept on the target while it lives (_holdByOwner)');
    tgt.x = 7.0; bolt.opts.track({ anchor: [0, 0, 0] });
    const tile = handles.find((h) => h.key === 'tile_fx');
    assert.ok(tile && Math.abs(tile.place.pos[0] - (7 - 10)) < 1e-6 && Math.abs(tile.place.pos[1] - (10 - 9)) < 1e-6, 'toTileOnStart on the target\'s tile');
    // the sim lands the shot after 2.4 / 11 s; the lightning lands at 0.517 s: the hit waits, the damage meanwhile is covered
    step(0.25);
    assert.ok(!handles.some((h) => h.key === 'hit'), 'no hit before the lightning lands');
    assert.equal(w.damage(tgt, 'arts', src, ofx.time), true, 'the damage in between draws no procedural spark');
    step(0.3);
    assert.ok(handles.some((h) => h.key === 'hit'), 'the hit at the end of its life');
    assert.ok(TIMER_HIT_MAX >= 0.517);
    // from the right: mirrored (the lightning falls from the upper right)
    w._fly(index.projectiles.p_timer, v(3, 'char_1_sh', 9), tgt, 'bolt', ofx.time);
    assert.equal(handles.filter((h) => h.key === 'bolt')[1].place.flipY, true);
  });

  test('a chain projectile flies its own trail, not its line; a harpoon\'s rope runs from the muzzle to the head, then fades', async () => {
    const { w, ofx, handles, v, index } = await setup();
    const src = v(1, 'char_1_sh', 5), tgt = v(2, 'enemy_9_x', 8);
    w._fly(index.projectiles.p_chain, src, tgt, 'bolt', ofx.time);
    // the client plays a chain's line between the chain's targets as the shot reaches them (ChainLightningHitBehaviour:
    // the sim's 'chain' bounces), never from the muzzle to the shot — read when this round's branches were merged
    assert.deepEqual(handles.map((h) => h.key), ['trail'], 'the trail flies (the index named the line as `main`), its line does not');
    handles.length = 0;
    w._fly(index.projectiles.p_harp, src, tgt, 'arrow', ofx.time);
    assert.deepEqual(handles.map((h) => h.key).sort(), ['head', 'rope'], 'the head flies (the index named the rope as `main`)');
    const rope = handles.find((h) => h.key === 'rope');
    const got = [];
    const fake = { time: 0.1, state: 'play', linkLines: (a, b) => got.push([a.slice(), b.slice()]), stop() { this.state = 'stopping'; } };
    rope.opts.track(fake);
    const [from, head] = got[0];
    assert.ok(head[0] > from[0] && head[0] < 8 - 10, `the head between the muzzle and the target: ${from} → ${head}`);
    fake.time = 5;
    rope.opts.track(fake);
    assert.equal(fake.state, 'stopping', 'the rope fades once the shot arrives');
  });
});

describe('the attach rows of a skill\'s mode (溯光星源 S3\'s range)', () => {
  test('attachUses: a `*_range*` row is the range, the others loops; preview-dummy rows and empty rows are left out; sub-abilities join', () => {
    const mode = { name: 'S3', attack: { class: 'AbilityParallelGroup', node: 'M/S3', attach: [{ effects: ['x_skill_03_range_01'], directionType: 0 }, { effects: ['x_dummy'], onlyAttachOnDummy: 1 }, { effects: [] }],
      abilities: [{ class: 'RangedAttack', node: 'M/S3/A', attach: [{ effects: ['x_glow'] }] }] } };
    assert.deepEqual(attachUses(mode).map((u) => [u.role, u.keys[0], u.node]), [['range', 'x_skill_03_range_01', 'M/S3'], ['loop', 'x_glow', 'M/S3/A']]);
    assert.deepEqual(attachUses(null), []);
  });

  test('skillPlan holds them for the skill: played at the start, stopped at its end (SkillFx\'s skill-held entries)', () => {
    const idx = {
      prefabs: { halo_range: { looping: true, spawn: 7 }, halo_buff: { looping: true, spawn: 1 } },
      units: { char_1_h: { modes: [{ name: 'Default', attack: null }, { name: 'S3', attack: { class: 'RangedAttack', node: 'Modes/S3/Body/S3_Attack', cast: [], attach: [{ effects: ['halo_range'], directionType: 0 }] } }], skills: {} } },
      skills: { skchr_h_3: { mode: 1, uses: [{ role: 'loop', keys: ['halo_buff'], from: 'ActiveBuffAbility._buffs', node: 'sk', on: 'owner' }], rootClass: 'CastSkill' } },
      projectiles: {},
    };
    const plan = skillPlan(idx, 'char_1_h', 'skchr_h_3', { rec: { duration: 25, skillType: 'MANUAL' } });
    assert.equal(plan.modeName, 'S3');
    assert.deepEqual(plan.range.map((e) => [e.key, e.hold, e.point]), [['halo_range', 'skill', 'GROUND_CENTER_WITH_ZERO_HEIGHT']]);
    assert.deepEqual(plan.loop.map((e) => e.key), ['halo_buff']);
    assert.deepEqual(plan.unmapped, []);
  });
});

describe('a zero scale on the way: the scaling mode\'s frame and its inverse stay usable (the audit\'s geometry scan)', () => {
  test('basisOf rebuilds an empty column from the other two (turned by the mirror), float noise of a zeroed axis included', () => {
    const B = new Float64Array(9);
    // x along +y, y along −x (a 90° turn about z), z zeroed by a parent's scale
    basisOf([0, 1.16, 0, 0, -1.16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 1, B);
    assert.deepEqual(Array.from(B).map((v) => Math.round(v * 1e6) / 1e6 + 0), [0, 1, 0, -1, 0, 0, 0, 0, 1]);
    basisOf([0, 1.16, 0, 0, -1.16, 0, 0, 0, 1e-8, 2e-8, 0, 0, 0, 0, 0, 1], -1, B);
    assert.deepEqual(Array.from(B.slice(6)).map((v) => Math.round(v * 1e6) / 1e6 + 0), [0, 0, -1], 'noise is no axis; mirrored: the other hand');
    const full = completeAxes(new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 5, 6, 7, 1]), new Float32Array(16));
    assert.deepEqual(Array.from(full.slice(8, 11)), [0, 0, 1], 'an invertible stand-in for PSys._inverse');
    assert.deepEqual(Array.from(full.slice(12, 15)), [5, 6, 7]);
  });

  test('a world-space system with limit velocity under a zero-scaled parent stays put (珊比\'s attack: 24,000 tiles in a second before)', () => {
    const ps = { lengthInSec: 0.3, looping: false, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 1, scalingMode: 1,
      InitialModule: { startLifetime: 1, startSpeed: { min: 0.5, max: 1 }, startSize: 0.1, startColor: [1, 1, 1, 1], maxNumParticles: 50 },
      EmissionModule: { rateOverTime: 20, m_Bursts: [] },
      VelocityModule: { x: { min: -0.15, max: 0.15 }, y: { min: 0.3, max: 0.1 }, z: 0, speedModifier: 1, inWorldSpace: false },
      ClampVelocityModule: { magnitude: { scalar: 0.1, curve: [[0, 1, 0, 0], [1, 0, 0, 0]] }, separateAxis: false, inWorldSpace: false, dampen: 0.15, drag: 0 } };
    const nodes = [root(),
      node(1, 0, { rot: [0.908078, -0.417445, 0.0140705, 0.030608], scale: [1.16, 1.16, 0] }),
      node(2, 1, { rot: [-9.31323e-9, -2.79397e-9, -0.236397, 0.971657], extra: { particleSystem: ps, particleSystemRenderer: { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'view', materials: [0] } } })];
    const fx = new Effect(compileEffect(desc(nodes)), { seed: 3 });
    const w = [0, 0, 0];
    let far = 0;
    for (let f = 0; f < 36; f++) {
      fx.update(1 / 30);
      const s = fx.sys[2];
      for (let i = 0; i < s.count; i++) { s.worldPos(i, w); far = Math.max(far, Math.hypot(w[0], w[1], w[2])); }
    }
    assert.ok(far > 0 && far < 3, `the sparks stay near the slash: ${far}`);
  });
});
