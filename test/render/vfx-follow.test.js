// test/render/vfx-follow.test.js — official effects on walking units and projectile bodies at the hit (DESIGN §32.14.40,
// the 0.3.0 effects audit's R1 and R5): a held loop without a FollowMountPoint (a status, an aura) and a `_holdByOwner`
// prefab move with their unit (render/vfx/wiring.js playOn `keep`), a hit and a range not held stay where they started,
// a chained OnPlayEmitter effect keeps to its own FollowMountPoint or moves with the unit as its prefab says; effect.js
// stop() hides `_inactiveOnFinish` at once (崖心's hook, 灰毫's shell) while the rest of the projectile fades.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const nearV = (a, b, eps, msg) => b.forEach((x, i) => near(a[i], x, eps, `${msg}[${i}]`));

const MAT = {
  name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
  queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
};

/** A particle system node (a looping emitter, or a burst of long-lived particles). */
const psNode = (id, parent, o = {}) => ({
  id, name: `ps${id}`, parent, children: [], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
  particleSystem: { lengthInSec: o.len ?? 0.5, looping: !!o.loop, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 0, scalingMode: 1,
    InitialModule: { startLifetime: o.life ?? 0.3, startSpeed: 0, startSize: 1, startColor: [1, 1, 1, 1], maxNumParticles: 100 },
    EmissionModule: { rateOverTime: o.rate ?? 0, m_Bursts: o.rate ? [] : [{ time: 0, countCurve: 2, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } },
  particleSystemRenderer: { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'view', materials: [0, null] },
  behaviours: [],
});
const root = (behaviours) => ({ id: 0, name: 'root', parent: null, children: [], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], behaviours });
const pe = (fields) => ({ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 0, _rotateType: 0, _spawnLocation: 2, _holdByOwner: 0, _inactiveOnFinish: [], ...fields } });
const b = (cls, fields) => ({ class: cls, enabled: true, fields });

function prefab(key, behaviours, loop) {
  const nodes = [root(behaviours), psNode(1, 0, loop ? { loop: true, rate: 10 } : {})];
  nodes[0].children.push(1);
  return compileEffect({ format: 'fx-prefab', version: 1, key, nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {} });
}

/** A walking enemy's skin: static points (HitPoint, HeadPoint, SpecialPoint0), offsets in the Unity root frame. */
const SKIN = { points: { HitPoint: { all: { pos: [0.1, 0.25, -0.3] } }, HeadPoint: { all: { pos: [0, 0.6, -0.5] } }, SpecialPoint0: { all: { pos: [0.3, 0.4, -0.2] } } } };
const INDEX = {
  version: 3, units: { enemy_w: { kind: 'enemy', skin: 'enemy_w', modes: [{ name: 'Default', attack: null }], skills: {} } }, skills: {}, projectiles: {},
  skins: { enemy_w: SKIN }, generic: { hit: {}, die: {}, birth: {}, status: { burn: 'burn_loop', stealth: 'stealth_loop' } }, prefabs: {},
};
const DEFS = new Map([
  // buff_burn: HIT_POINT, held by its owner, no FollowMountPoint
  ['burn_loop', prefab('burn_loop', [pe({ _isLoop: 1, _spawnLocation: 2, _holdByOwner: 1 })], true)],
  // common_stealth: FOOT_POINT, `_holdByOwner` 0 — a status loop all the same
  ['stealth_loop', prefab('stealth_loop', [pe({ _isLoop: 1, _spawnLocation: 1, _holdByOwner: 0 })], true)],
  // a range on the ground (GROUND_CENTER), not held by its owner
  ['range_loop', prefab('range_loop', [pe({ _isLoop: 1, _spawnLocation: 5, _holdByOwner: 0 })], true)],
  // a hit spark (HIT_POINT, not held) and an enemy's attack start (FOOT_POINT, held)
  ['hit_spark', prefab('hit_spark', [pe({ _spawnLocation: 2, _holdByOwner: 0 })], false)],
  ['cast_flash', prefab('cast_flash', [pe({ _spawnLocation: 1, _holdByOwner: 1 })], false)],
  // a buff that chains a weapon glow (FollowMountPoint SPECIAL_0) and a ring its owner holds (no FollowMountPoint)
  ['aura_root', prefab('aura_root', [pe({ _isLoop: 1, _spawnLocation: 1, _holdByOwner: 0 }), b('OnPlayEmitter', { _effects: ['aura_weapon', 'aura_ring'], _preDelay: 0 })], true)],
  ['aura_weapon', prefab('aura_weapon', [pe({ _isLoop: 1, _spawnLocation: 0, _holdByOwner: 1 }), b('FollowMountPoint', { _mountPointType: 5, _keepOriginRotation: 1 })], true)],
  ['aura_ring', prefab('aura_ring', [pe({ _isLoop: 1, _spawnLocation: 1, _holdByOwner: 1 })], true)],
]);

async function setup() {
  const lib = { available: true, defs: DEFS, has: (k) => DEFS.has(k), def: (k) => DEFS.get(k) || null, load: async (k) => DEFS.get(k) || null, index: async () => INDEX, preload: async (keys) => keys.length };
  const ofx = new OfficialFx({ P: { Container: class {} }, renderer: null, cam: () => ({ tilt: 30 }), lib, tier: 'full' });
  const w = new FxWiring(ofx, { speed: () => 10, record: () => null });
  await w.ready();
  const v = { id: 7, x: 5, y: 9, z: 0, visFacing: -1, isEnemy: true, alive: true, flags: 0, dir: 'LEFT', info: { id: 7, spine: 'enemy_w', defId: 'enemy_w', side: 'enemy', kind: 'enemy' } };
  return { ofx, w, v };
}

/** The enemy walks dx tiles along the board's x over a few frames. */
function walk(ofx, v, dx, frames = 4) { for (let i = 0; i < frames; i++) { v.x += dx / frames; ofx.update(1 / 30); } }

describe('held effects move with their unit (R1)', () => {
  test('status loops without a FollowMountPoint stay on the walking enemy, whatever `_holdByOwner` says', async () => {
    const { ofx, w, v } = await setup();
    assert.equal(w.status(v, 'burn', true), true);
    assert.equal(w.status(v, 'stealth', true), true);
    const burn = w.loops.get('7|burn').effect, stealth = w.loops.get('7|stealth').effect;
    const burn0 = burn.anchor.slice(), stealth0 = stealth.anchor.slice();
    nearV(burn0, [5 - 10 - 0.1, 0.25, -0.3], 1e-9, 'burn starts on the HitPoint (mirrored: she faces left)');
    nearV(stealth0, [-5, 0, 0], 1e-9, 'stealth at the feet');
    walk(ofx, v, -2.5);
    nearV(burn.anchor, [burn0[0] - 2.5, burn0[1], burn0[2]], 1e-9, 'burn walked with her');
    nearV(stealth.anchor, [stealth0[0] - 2.5, stealth0[1], stealth0[2]], 1e-9, 'stealth (`_holdByOwner` 0) too');
    // she is pushed up a slope and hovers: the offset from her feet is kept
    v.y += 1; v.z = 0.4; ofx.update(1 / 30);
    nearV(burn.anchor, [burn0[0] - 2.5, burn0[1] + 1, burn0[2] - 0.4], 1e-9, 'with her height');
  });

  test('a `_holdByOwner` one-shot moves with its unit; a hit and a range not held stay where they started', async () => {
    const { ofx, w, v } = await setup();
    const flash = w.playOn('cast_flash', v).effect, spark = w.playOn('hit_spark', v).effect, range = w.playOn('range_loop', v, { loop: true }).effect;
    const f0 = flash.anchor.slice(), s0 = spark.anchor.slice(), r0 = range.anchor.slice();
    walk(ofx, v, 1.5);
    nearV(flash.anchor, [f0[0] + 1.5, f0[1], f0[2]], 1e-9, 'the attack start (held by its owner)');
    nearV(spark.anchor, s0, 0, 'the hit spark stays where it landed');
    nearV(range.anchor, r0, 0, 'the ground range stays');
    assert.equal(flash.track !== null && spark.track === null, true, 'only the held one tracks');
  });

  test('a held range (a skill\'s loop) on the ground walks along at ground height', async () => {
    const { ofx, w, v } = await setup();
    v.hover = 0.3;
    const range = w.playOn('range_loop', v, { follow: true, loop: true, important: true }).effect;
    const r0 = range.anchor.slice();
    walk(ofx, v, 2);
    v.hover = 0.1; ofx.update(1 / 30);
    nearV(range.anchor, [r0[0] + 2, r0[1], 0], 1e-9, 'on the ground under the hover');
  });

  test('chained effects (OnPlayEmitter) keep to their own FollowMountPoint or walk as their prefab says', async () => {
    const { ofx, w, v } = await setup();
    const h = w.playOn('aura_root', v, { loop: true, important: true });
    assert.equal(typeof h.opts.track, 'function', 'a prefab with chained effects tracks them (before: a null track for all)');
    const [weapon, ring] = h.children.map((c) => c.effect);
    const root0 = h.effect.anchor.slice(), ring0 = ring.anchor.slice();
    walk(ofx, v, -1);
    nearV(h.effect.anchor, root0, 0, 'the root (not held) stays');
    nearV(weapon.anchor, [v.x - 10 - 0.3, 0.4, -0.2], 1e-9, 'the weapon glow rides SPECIAL_0 (its own FollowMountPoint)');
    nearV(ring.anchor, [ring0[0] - 1, ring0[1], ring0[2]], 1e-9, 'the ring walks with her (its own `_holdByOwner`)');
  });
});

describe('a projectile\'s body at the hit (R5)', () => {
  test('stop() hides `_inactiveOnFinish` at once; the trail fades through `_delayToFinish`', () => {
    // 灰毫's ashlok_attack_01_trail: the shell `gonggaoban` in `_inactiveOnFinish`, `_delayToFinish` 0.5, no `_inactiveOnHit`
    const nodes = [root([{ class: 'ProjectileEffect', enabled: true, fields: { _mainDir: 1, _delayToFinish: 0.5, _inactiveOnFinish: [{ node: 1 }], _inactiveOnHit: [] } }]),
      psNode(1, 0, { life: 5 }), psNode(2, 0, { loop: true, rate: 20, life: 0.4 })];
    nodes[0].children.push(1, 2);
    const fx = new Effect(compileEffect({ format: 'fx-prefab', version: 1, key: 'shell', nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {} }), { seed: 3 });
    for (let i = 0; i < 9; i++) fx.update(1 / 30);
    assert.equal(fx.hier[1], 1, 'the shell flies');
    fx.stop({ hit: true });
    fx.update(1 / 30);
    assert.equal(fx.hier[1], 0, 'the shell is gone at the hit (before: 0.6–0.8 s on the target)');
    assert.equal(fx.hier[2], 1, 'the trail stays to fade');
    assert.equal(fx.state, 'stopping');
    assert.ok(fx.sys[2].count > 0, 'with its particles');
    for (let i = 0; i < 60 && !fx.done; i++) fx.update(1 / 30);
    assert.ok(fx.done, 'and ends');
  });
});
