// test/render/vfx-origins.test.js — where official shots and weapon effects leave a unit (DESIGN §32.14.36): a skin point
// a BoneFollower keeps on a Spine bone is the bone where the model draws it (render/vfx/mounts.js, UnitView.boneOffset) —
// for a shot as the attack clip poses it at its strike frame —; the mount point's rotation (the Graphic tilt, the facing
// turn, the bone's angle) for MUZZLE_POINT / Special-point spawns and FollowMountPoint without `_keepOriginRotation`;
// FollowMountPoint for every effect that has one (FollowOwner as before); the client's ParacurveMovement arc and AmiyaS2Movement wobble
// (render/vfx/flight.js); the projectile behaviour's own flying effect (a chain line or a harpoon rope is none; the rope
// runs from the mount point to the head); 号角's Blocked sub-ability only while she blocks; the facing variants of modes
// (灰毫's S2(U) / S2(D) / S2(LR)); and, with the local client's skeletons and extraction, the static Muzzle against the
// bone at the strike frame.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitPoint, mountRotation, spawnRotationKind, skinPoint, SKELETON_TILT } from '../../public/js/render/vfx/mounts.js';
import { projectileParts, paracurve, arcHeight, wobble } from '../../public/js/render/vfx/flight.js';
import { FxWiring, pickAttacks, modeVariant } from '../../public/js/render/vfx/wiring.js';
import { quatRotate } from '../../public/js/render/vfx/math.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GRAPHIC = [-0.258819, 0, 0, 0.965926];
const C30 = Math.cos(30 * Math.PI / 180), S30 = Math.sin(30 * Math.PI / 180);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const nearV = (a, b, eps, msg) => a.forEach((x, i) => near(x, b[i], eps, `${msg}[${i}]`));

/** A skin like 灰毫's: a bone-followed Muzzle (its pos the edit-time Default pose: low and far right), static points. */
const SKIN = {
  graphic: { rot: GRAPHIC },
  points: {
    HitPoint: { all: { pos: [0, 0.232, -0.25], bone: null } },
    Muzzle: { front: { pos: [0.907, -0.151, -0.028], bone: 'F_Muzzle' }, back: { pos: [0.915, -0.149, -0.029], bone: 'B_Muzzle' } },
    SpecialPoint0: { front: { pos: [-0.047, 0.099, -0.173], bone: 'F_Weapon' } },
  },
};

/** A view whose model draws `bones` (name → { x, up, angle }) with draw sign `flip`; records its calls. */
function boneView(bones, flip = 1) {
  const calls = [];
  return {
    calls, bones,
    boneOffset(names, out, strike) {
      calls.push({ names: [...names], strike: !!strike });
      for (const n of names) {
        const b = bones[n];
        if (b) { out.x = b.x * flip; out.up = b.up; out.angle = b.angle ?? 0; out.flip = flip; return out; }
      }
      return null;
    },
  };
}

describe('mount points on the drawn model (mounts.js)', () => {
  test('a bone-followed point is the bone where the model draws it, up the plane the camera faces; static points keep their offset', () => {
    const view = boneView({ F_Muzzle: { x: 0.97, up: 0.62, angle: 16 } });
    const u = { x: 4, y: 11, z: 0, left: false, back: false, view, tilt: 30 };
    nearV(unitPoint(SKIN, 'muzzle', u), [4 - 10 + 0.97, 11 - 9 + 0.62 * C30, -0.62 * S30], 1e-9, 'muzzle on its bone');
    assert.deepEqual(view.calls[0], { names: ['F_Muzzle', 'B_Muzzle'], strike: false }, 'the facing\'s bone first, then the other skeleton\'s');
    unitPoint(SKIN, 'muzzle', { ...u, back: true, strike: true });
    assert.deepEqual(view.calls[1], { names: ['B_Muzzle', 'F_Muzzle'], strike: true }, 'a Back model looks for B_Muzzle first; a shot asks for the strike frame');
    // a raised unit (a high tile, a flyer's hover): from its feet
    nearV(unitPoint(SKIN, 'muzzle', { ...u, z: 0.4 }), [-6 + 0.97, 2 + 0.62 * C30, -0.4 - 0.62 * S30], 1e-9, 'raised');
    // the camera's tilt decides the plane (the official 30° when the camera says nothing)
    nearV(unitPoint(SKIN, 'muzzle', { ...u, tilt: undefined }), unitPoint(SKIN, 'muzzle', u), 1e-12, 'SKELETON_TILT');
    assert.equal(SKELETON_TILT, 30);
    // a point no bone moves: the skin's offset, the view never asked
    const n = view.calls.length;
    nearV(unitPoint(SKIN, 'hit', u), [-6, 2.232, -0.25], 1e-9, 'HitPoint');
    assert.equal(view.calls.length, n);
    // no model drawn (the diamond, a point on the ground), no such bone: the skin's offset, mirrored for a left-facing unit
    nearV(unitPoint(SKIN, 'muzzle', { x: 4, y: 11, z: 0, left: true }), [-6 - 0.907, 2 - 0.151, -0.028], 1e-9, 'no view');
    nearV(unitPoint(SKIN, 'muzzle', { ...u, left: true, view: boneView({}) }), [-6 - 0.907, 2 - 0.151, -0.028], 1e-9, 'no bone');
    assert.deepEqual(skinPoint(SKIN, 'hit', false).bones, null);
    assert.deepEqual(skinPoint(SKIN, 's0', true).bones, ['F_Weapon'], 'a front-only point serves the Back model too');
  });

  test('the mount rotation: the Graphic tilt, the facing turn (180° about the plane\'s up) and the bone\'s angle', () => {
    const at = (bones, flip, kind = 'muzzle', left = flip < 0) => {
      const q = mountRotation(SKIN, kind, { x: 4, y: 11, z: 0, left, back: false, view: boneView(bones, flip) });
      return { x: quatRotate(q, [1, 0, 0]), y: quatRotate(q, [0, 1, 0]) };
    };
    // the bone's x axis along the screen's right: local +x stays +x, local +y is the camera's up
    let r = at({ F_Muzzle: { x: 1, up: 0.6, angle: 0 } }, 1);
    nearV(r.x, [1, 0, 0], 1e-6, 'angle 0: x');
    nearV(r.y, [0, C30, -S30], 1e-6, 'angle 0: y is the plane\'s up');
    // a staff held straight up (安洁莉娜's S2: F_Weapon at 89.7°): a weapon effect laid along +x rises along the staff
    r = at({ F_Weapon: { x: 0.35, up: 0.6, angle: 90 } }, 1, 's0');
    nearV(r.x, [0, C30, -S30], 1e-6, 'angle 90: x up the model');
    // drawn facing left: turned about the plane's up axis (x mirrored, the up kept)
    r = at({ F_Muzzle: { x: 1, up: 0.6, angle: 0 } }, -1);
    nearV(r.x, [-1, 0, 0], 1e-6, 'left: x');
    nearV(r.y, [0, C30, -S30], 1e-6, 'left: y');
    r = at({ F_Muzzle: { x: 1, up: 0.6, angle: 30 } }, -1);
    nearV(r.x, [-Math.cos(Math.PI / 6), Math.sin(Math.PI / 6) * C30, -Math.sin(Math.PI / 6) * S30], 1e-6, 'left, 30°: the bone mirrored');
    // a static point: the tilt and the facing only
    r = at({}, 1, 'hit', true);
    nearV(r.x, [-1, 0, 0], 1e-6, 'HitPoint, left');
    assert.equal(mountRotation(SKIN, null, { x: 0, y: 0 }), null, 'FOOT / GROUND: the unit\'s own rotation');
    // which spawn locations take the point's rotation (Effect._InitLocationFromEntity)
    assert.deepEqual([3, 8, 11, 13, 18, 34].map(spawnRotationKind), ['muzzle', 's0', 's3', 's4', 's8', 's23']);
    assert.deepEqual([0, 1, 2, 4, 5, 6, 7, 12].map(spawnRotationKind), [null, null, null, null, null, null, null, null]);
  });

  // 洛洛's skin as the client has it (chararts/char_4040_rockr.ab defaultskin): SpecialPoint1's BoneFollower keeps the
  // point on F_UVA_01 / B_UVA_01 without its rotation (followBoneRotation 0), the point's own 30° about X cancelling the
  // Graphic's −30°; SpecialPoint2 follows F_Weapon_24's rotation; an enemy-like static Muzzle turned 45° about Z
  const X30 = [0.258819, 0, 0, 0.965926];
  const ROCKR = {
    graphic: { rot: GRAPHIC },
    points: {
      HitPoint: { all: { pos: [0, 0.232, -0.25], bone: null, rot: [0, 0, 0, 1] } },
      SpecialPoint1: { front: { pos: [0.575, 0.499, -0.404], bone: 'F_UVA_01', rot: X30, followRot: false },
        back: { pos: [0.576, 0.499, -0.404], bone: 'B_UVA_01', rot: X30, followRot: false } },
      SpecialPoint2: { front: { pos: [-0.688, 0.517, -0.414], bone: 'F_Weapon_24', rot: [0, 0, -0.374788, 0.927108], followRot: true } },
      Muzzle: { all: { pos: [0.3, 0.4, -0.3], bone: null, rot: [0, 0, 0.382683, 0.92388] } },
    },
  };
  /** The same skin as an index extracted before the points' rotations has it: no `rot`, no `followRot`. */
  const OLD = { graphic: ROCKR.graphic, points: Object.fromEntries(Object.entries(ROCKR.points).map(([nm, p]) => [nm,
    Object.fromEntries(Object.entries(p).map(([f, v]) => [f, { pos: v.pos, bone: v.bone }]))])) };
  const axes = (skin, kind, bones, flip, extra = {}) => {
    const q = mountRotation(skin, kind, { x: 4, y: 11, z: 0, left: flip < 0, back: false, view: boneView(bones, flip), ...extra });
    return { x: quatRotate(q, [1, 0, 0]), y: quatRotate(q, [0, 1, 0]), q };
  };

  test('a point whose BoneFollower does not follow the bone\'s rotation keeps its own: 洛洛\'s drone lies flat at home whatever F_UVA_01\'s angle', () => {
    const bones = { F_UVA_01: { x: 0.6, up: 0.7, angle: 90 }, B_UVA_01: { x: 0.6, up: 0.7, angle: 90 }, F_Weapon_24: { x: -0.7, up: 0.6, angle: 40 } };
    // facing right: Graphic (−30° about X) · the point's 30° about X = the identity — the prefab as authored
    let r = axes(ROCKR, 's1', bones, 1);
    nearV(r.x, [1, 0, 0], 1e-5, 'right: x');
    nearV(r.y, [0, 1, 0], 1e-5, 'right: y (no tilt, not the bone\'s 90°)');
    // another angle of the bone changes nothing
    nearV(axes(ROCKR, 's1', { F_UVA_01: { x: 0.6, up: 0.7, angle: -35 } }, 1).y, [0, 1, 0], 1e-5, 'any bone angle');
    // facing left: the FaceSwitcher's 180° about the plane's up, between the Graphic and the point: Rx(−60°) · Ry(180°)
    r = axes(ROCKR, 's1', bones, -1);
    nearV(r.x, [-1, 0, 0], 1e-5, 'left: x');
    nearV(r.y, [0, 0.5, -Math.sqrt(3) / 2], 1e-5, 'left: y');
    // the Back skeleton's point: the same
    nearV(axes(ROCKR, 's1', bones, 1, { back: true }).y, [0, 1, 0], 1e-5, 'back');
    // its position still follows the bone (followXYPosition)
    nearV(unitPoint(ROCKR, 's1', { x: 4, y: 11, z: 0, left: false, back: false, view: boneView(bones, 1) }), [-6 + 0.6, 2 + 0.7 * C30, -0.7 * S30], 1e-9, 'on the bone');
    // a point that follows its bone's rotation: the bone's angle, not its own `rot` (the edit-time pose)
    r = axes(ROCKR, 's2', bones, 1);
    nearV(r.x, [Math.cos(40 * Math.PI / 180), Math.sin(40 * Math.PI / 180) * C30, -Math.sin(40 * Math.PI / 180) * S30], 1e-5, 'SpecialPoint2 on its bone');
    // ... and without the drawn bone the angle is 0 (as before), not the edit-time `rot`
    nearV(axes(ROCKR, 's2', {}, 1).x, [1, 0, 0], 1e-5, 'SpecialPoint2 without a model');
    // a point no bone moves keeps its own rotation (45° about Z on the skeleton plane)
    r = axes(ROCKR, 'muzzle', {}, 1);
    nearV(r.x, [Math.SQRT1_2, Math.SQRT1_2 * C30, -Math.SQRT1_2 * S30], 1e-5, 'static Muzzle');
    nearV(axes(ROCKR, 'hit', {}, 1).y, [0, C30, -S30], 1e-5, 'HitPoint: the identity under the tilt');
  });

  test('an index without the points\' rotations: every bone-followed point takes the bone\'s angle, the others the identity', () => {
    const bones = { F_UVA_01: { x: 0.6, up: 0.7, angle: 90 } };
    // 洛洛's drone as the merge drew it: turned by the bone's 90° (upright)
    nearV(axes(OLD, 's1', bones, 1).x, [0, C30, -S30], 1e-5, 'old index: the bone\'s angle');
    nearV(axes(OLD, 'muzzle', {}, 1).x, [1, 0, 0], 1e-5, 'old index: a static point has no rotation of its own');
    nearV(axes(OLD, 'muzzle', {}, -1).x, [-1, 0, 0], 1e-5, 'old index: static, facing left');
    assert.deepEqual(skinPoint(OLD, 's1', false), { pos: OLD.points.SpecialPoint1.front.pos, bones: ['F_UVA_01', 'B_UVA_01'], rot: null, followRot: true });
    assert.deepEqual(skinPoint(ROCKR, 's1', true), { pos: ROCKR.points.SpecialPoint1.back.pos, bones: ['B_UVA_01', 'F_UVA_01'], rot: X30, followRot: false });
    assert.equal(skinPoint(ROCKR, 'muzzle', false).followRot, false, 'no bone: nothing to follow');
    // a malformed `rot` is ignored (the identity)
    const bad = { graphic: ROCKR.graphic, points: { Muzzle: { all: { pos: [0, 0, 0], bone: null, rot: [0, 0, 'x', 1] } } } };
    nearV(axes(bad, 'muzzle', {}, 1).x, [1, 0, 0], 1e-5, 'malformed rot');
  });
});

describe('projectile flights (flight.js)', () => {
  test('the projectile behaviour\'s own effect flies; a chain line or a harpoon rope is no flying effect', () => {
    // (merged with §32.14.38's reader: one projectileParts in flight.js, which also gives the projectile class's life)
    const b = (cls, k) => ({ class: cls, node: 'p', fields: { _mainEffect: k } });
    // as the extractor writes them: `main` is the last `_mainEffect` (projectile_leizi, projectile_chr_glady_s2)
    assert.deepEqual({ ...projectileParts({ main: 'leizi_attack_02_line', behaviours: [b('SimpleProjectile', 'leizi_attack_01_trail'), b('ChainLightningEffectBehaviour', 'leizi_attack_02_line')] }) },
      { main: 'leizi_attack_01_trail', rope: null, chain: 'leizi_attack_02_line', life: null });
    assert.deepEqual({ ...projectileParts({ main: 'glady_skill_02_line', behaviours: [b('HarpoonProjectile', 'glady_skill_02_trail'), b('HarpoonRenderer', 'glady_skill_02_line')] }) },
      { main: 'glady_skill_02_trail', rope: 'glady_skill_02_line', chain: null, life: null });
    // a rope alone (溯光星源 S2's link), a chain line alone (异客 S3): nothing flies
    assert.equal(projectileParts({ main: 'halo2_skill_02_line_01', behaviours: [b('HarpoonProjectile', ''), b('HarpoonRenderer', 'halo2_skill_02_line_01')] }).main, null);
    assert.equal(projectileParts({ main: 'pasngr_attack_line', behaviours: [b('SimpleProjectile', ''), b('ChainLightningEffectBehaviour', 'pasngr_attack_line')] }).main, null);
    assert.equal(projectileParts({ main: 'X_Trail', behaviours: [b('SimpleProjectile', 'X_Trail')] }).main, 'x_trail');
    assert.equal(projectileParts({ main: 'y_trail' }).main, 'y_trail', 'an entry without behaviours: its main');
    // a renderer that is no rope (char_1039_thorn2 S3's polygon, Thorn2S3Renderer) is neither flown nor stretched
    assert.deepEqual({ ...projectileParts({ main: 'thorn2_skill_03_line', behaviours: [b('Thorn2PolygonProjectile', ''), b('Thorn2S3Renderer', 'thorn2_skill_03_line')] }) },
      { main: null, rope: null, chain: null, life: null });
  });

  test('ParacurveMovement: the client\'s arc tops out `raiseHeight` above the start — not raiseHeight × distance × 2 — and lands on the end', () => {
    // 灰毫's projectile_chr_ashlok: speed 5, raiseHeight 1, noRaiseHeightThreshold 1.3
    const mv = { class: 'ParacurveMovement', speed: 5, raiseHeight: 1, noRaiseHeightThreshold: 1.3, inverseParacurve: 0 };
    const hs = 0.31, ht = 0.25;
    const arc = paracurve(mv, hs, ht, 3);
    const ks = Array.from({ length: 201 }, (_, i) => i / 200);
    const ys = ks.map((k) => arcHeight(arc, k, ht));
    near(ys[0], hs, 1e-9, 'starts at the muzzle');
    near(ys[200], ht, 1e-9, 'lands on the target\'s point');
    const top = Math.max(...ys);
    near(top, hs + 1, 1e-3, 'the top: raiseHeight above the start');
    // where: k = √h / (√h + √(hs + h − ht))
    near(ks[ys.indexOf(top)], 1 / (1 + Math.sqrt(hs + 1 - ht)), 0.006, 'the top\'s fraction');
    // the remake's old rule rose 6 tiles above the line here
    assert.ok(top - hs < 1.01 && 1 * 3 * 2 === 6);
    // within noRaiseHeightThreshold no climb: it drops from the start to the end
    const flat = paracurve(mv, hs, ht, 1.2);
    assert.equal(flat.h, 0);
    assert.ok(ks.every((k, i) => i === 0 || arcHeight(flat, k, ht) <= arcHeight(flat, ks[i - 1], ht) + 1e-12), 'no climb');
    // inverse: a sag below the line, the same ends
    const inv = paracurve({ ...mv, inverseParacurve: 1 }, hs, ht, 3);
    assert.ok(Math.min(...ks.map((k) => arcHeight(inv, k, ht))) < ht - 0.5, 'a sag');
    near(arcHeight(inv, 1, ht), ht, 1e-9, 'inverse lands');
    // a homing end: the end height now (a target rising) is where it lands; an end above the top is reached
    near(arcHeight(arc, 1, 0.6), 0.6, 1e-9, 'a moved end');
    near(arcHeight(paracurve(mv, 0.2, 1.5, 3), 1, 1.5), 1.5, 1e-9, 'an end above the top');
    // a random height (useRandomHeight) inside its range, the same for a seed
    const rnd = { ...mv, useRandomHeight: 1, randomHeightRange: [0.5, 1.5] };
    const h1 = paracurve(rnd, hs, ht, 3, 7).h;
    assert.ok(h1 >= 0.5 && h1 <= 1.5);
    assert.equal(paracurve(rnd, hs, ht, 3, 7).h, h1);
    assert.equal(paracurve({ class: 'AdvancedMovement' }, hs, ht, 3), null);
  });

  test('AmiyaS2Movement: a wobble of `yAnimateOffset` at `yAnimateSpeed` Hz (安洁莉娜 S2)', () => {
    const w = wobble({ class: 'AmiyaS2Movement', time: 0.2, yAnimateOffset: 0.1, yAnimateSpeed: 5 }, 3);
    assert.equal(w.amp, 0.1);
    assert.equal(w.hz, 5);
    assert.ok(w.phase >= 0 && w.phase < Math.PI * 2);
    assert.equal(wobble({ class: 'AmiyaS2Movement', yAnimateOffset: 0 }), null);
    assert.equal(wobble({ class: 'ParacurveMovement', yAnimateOffset: 0.1 }), null);
  });
});

/** A synthetic index: a lobbing fortress, a chain caster, a harpooner, a staff support, a blocker with facing modes. */
function makeIndex() {
  const b = (cls, k) => ({ class: cls, node: 'p', fields: { _mainEffect: k } });
  const ranged = (pk, cast = []) => ({ class: 'RangedAttack', projectileKey: pk, mount: 'MUZZLE', cast });
  return {
    version: 3,
    units: {
      char_lob: { kind: 'char', skin: 'char_lob', modes: [
        { name: 'Default', attack: ranged('proj_lob', [{ effects: ['lob_flash'], oneshot: 1, startEvent: 4, endEvent: 3, directionType: 0 }]) },
        { name: 'S2(U)', attack: ranged('proj_lob_s2u') }, { name: 'S2(D)', attack: ranged('proj_lob_s2d') }, { name: 'S2(LR)', attack: ranged('proj_lob_s2lr') },
      ], skills: { skchr_lob_2: { mode: null, projectiles: [], uses: [] } } },
      char_chain: { kind: 'char', skin: 'char_lob', modes: [{ name: 'Default', attack: ranged('proj_chain') }], skills: {} },
      char_harp: { kind: 'char', skin: 'char_lob', modes: [{ name: 'Default', attack: ranged('proj_harp') }], skills: {} },
      enemy_t: { kind: 'enemy', modes: [{ name: 'Default', attack: null }], skills: {} },
    },
    skills: {},
    projectiles: {
      proj_lob: { main: 'lob_trail', onHit: ['lob_hit'], effects: ['lob_trail', 'lob_hit'], movement: { class: 'ParacurveMovement', speed: 5, raiseHeight: 1, noRaiseHeightThreshold: 1.3 }, behaviours: [b('SimpleProjectile', 'lob_trail')] },
      proj_lob_s2u: { main: 's2u_trail', effects: ['s2u_trail'], movement: { class: 'AdvancedMovement' }, behaviours: [b('SimpleProjectile', 's2u_trail')] },
      proj_lob_s2d: { main: 's2d_trail', effects: ['s2d_trail'], movement: { class: 'AdvancedMovement' }, behaviours: [b('SimpleProjectile', 's2d_trail')] },
      proj_lob_s2lr: { main: 's2lr_trail', effects: ['s2lr_trail'], movement: { class: 'AdvancedMovement' }, behaviours: [b('SimpleProjectile', 's2lr_trail')] },
      proj_chain: { main: 'c_line', onHit: [], effects: ['c_trail', 'c_line'], movement: { class: 'AdvancedMovement' }, behaviours: [b('SimpleProjectile', 'c_trail'), b('ChainLightningEffectBehaviour', 'c_line')] },
      proj_harp: { main: 'h_line', onHit: [], effects: ['h_trail', 'h_line'], movement: { class: 'HarpoonMovement' }, behaviours: [b('HarpoonProjectile', 'h_trail'), b('HarpoonRenderer', 'h_line')] },
    },
    skins: { char_lob: SKIN },
    generic: { hit: {}, die: {}, birth: {}, status: {} },
    prefabs: {},
  };
}

/** The effect descriptors the fake library hands out (spawn location, FollowMountPoint, direction). */
const DEFS = {
  lob_trail: { spawn: 0 }, lob_hit: { spawn: 2 }, lob_flash: { spawn: 3 }, s2u_trail: {}, s2d_trail: {}, s2lr_trail: {},
  c_trail: {}, c_line: {}, h_trail: {}, h_line: { n: 2, line: [null, { points: [[0, 0, 0], [1, 0, 0]] }] },
  staff_glow: { spawn: 0, follow: { mount: 5, keepRot: false } },     // aglina_skill_02_start: SPECIAL_0, the point's rotation
  stun_loop: { spawn: 4, follow: { mount: 3, keepRot: true } },        // buff_stun: HEAD, its own (pre-tilted) rotation
  muzzle_norot: { spawn: 6 }, flip_follow: { spawn: 0, rotateType: 1, rotY: -1, follow: { mount: 2, keepRot: false } },
  owner_flash: { spawn: 3, follow: { mount: 0, keepRot: true, owner: true } }, // amgoat_attack_01_start: FollowOwner, MUZZLE_POINT
};

function fakeOfx(index) {
  const spawned = [];
  const ofx = {
    active: true, time: 0, timers: [], ctx: { cam: () => ({ tilt: 30 }) },
    lib: { has: (k) => k in DEFS, def: (k) => (k in DEFS ? { isLoop: false, rotateType: 0, rotY: -1, n: 0, line: [], ...DEFS[k] } : null), index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const def = this.lib.def(key);
      const fx = { key, def, anchor: place.pos.slice(), mountRot: place.mountRot ? place.mountRot.slice() : null, yaw: 0, pitch: 0, mirror: !!place.mirror, flipY: !!place.flipY, time: 0, linePts: new Map(), stopped: null, stop(o = {}) { this.stopped = o; },
        // as effect.js Effect.linkLines: every LineRenderer of the prefab runs from → to
        linkLines(from, to) { for (let i = 0; i < this.def.n; i++) if (this.def.line[i]) this.linePts.set(i, [from.slice(), to.slice()]); return this; } };
      const h = { key, place, opts, fx, alive: true, stop(o) { fx.stop(o); } };
      spawned.push(h);
      return h;
    },
  };
  return { ofx, spawned };
}

async function setup() {
  const index = makeIndex();
  const f = fakeOfx(index);
  const w = new FxWiring(f.ofx, { speed: () => 10, record: () => null });
  await w.ready();
  const view = (id, key, x, y, o = {}) => ({ id, x, y, z: 0, visFacing: 1, isEnemy: /^enemy_/.test(key), alive: true, flags: 0, dir: 'RIGHT',
    info: { id, spine: key, defId: key, side: /^enemy_/.test(key) ? 'enemy' : 'ally', kind: 'op', skillIndex: 1 }, ...o });
  return { ...f, w, view, index };
}

/** Run an effect's track at battle time t (the fake effect of the fake layer). */
const run = (h, t) => { h.fx.time = t; h.opts.track?.(h.fx); };

describe('the wiring places shots and weapon effects on the drawn model', () => {
  test('a shot leaves the attack clip\'s strike-frame muzzle and lobs along the client\'s arc onto the target', async () => {
    const { w, spawned, view } = await setup();
    const bones = boneView({ F_Muzzle: { x: 0.97, up: 0.62, angle: 16 } });
    const src = view(1, 'char_lob', 4, 11, { boneOffset: bones.boneOffset.bind(bones) });
    const tgt = view(2, 'enemy_t', 7, 11);
    assert.equal(w.attack(src, tgt, 'arrow', 0), true);
    const shot = spawned.find((h) => h.key === 'lob_trail');
    const from = [4 - 10 + 0.97, 2 + 0.62 * C30, -0.62 * S30];
    nearV(shot.place.pos, from, 1e-9, 'the shot starts at the drawn muzzle');
    assert.ok(bones.calls.some((c) => c.strike), 'read at the strike frame');
    const flash = spawned.find((h) => h.key === 'lob_flash');
    nearV(flash.place.pos, from, 1e-9, 'the strike\'s muzzle flash (MUZZLE_POINT) sits there too');
    nearV(quatRotate(flash.place.mountRot, [1, 0, 0]), [Math.cos(16 * Math.PI / 180), Math.sin(16 * Math.PI / 180) * C30, -Math.sin(16 * Math.PI / 180) * S30], 1e-6, '… turned along the barrel');
    // fly it: the sim's flight time (3 tiles at 10 tiles / s), the arc 1 tile above the start, the hit on arrival
    const dur = 0.3;
    let top = -Infinity;
    for (let i = 1; i <= 60; i++) { run(shot, (dur * i) / 60); if (!shot.fx.stopped) top = Math.max(top, -shot.fx.anchor[2]); }
    near(top, 0.62 * S30 + 1, 0.02, 'tops out raiseHeight (1 tile) above the muzzle');
    assert.ok(shot.fx.stopped && shot.fx.stopped.hit, 'arrives');
    assert.ok(spawned.some((h) => h.key === 'lob_hit'), 'onHit at the target');
  });

  test('the projectile behaviour\'s effect flies (not the chain line); a harpoon\'s rope spans the shooter\'s point and the head', async () => {
    const { w, spawned, view } = await setup();
    const bones = boneView({ F_Muzzle: { x: 0.5, up: 0.8, angle: 0 } });
    const tgt = view(9, 'enemy_t', 8, 11);
    w.attack(view(3, 'char_chain', 4, 11, { boneOffset: bones.boneOffset.bind(bones) }), tgt, 'bolt', 0);
    assert.deepEqual(spawned.map((h) => h.key), ['c_trail'], 'the trail, never the chain line authored in world space');
    spawned.length = 0;
    const src = view(4, 'char_harp', 4, 12, { boneOffset: bones.boneOffset.bind(bones) });
    w.attack(src, tgt, 'arrow', 0);
    assert.deepEqual(spawned.map((h) => h.key).sort(), ['h_line', 'h_trail']);
    const head = spawned.find((h) => h.key === 'h_trail'), rope = spawned.find((h) => h.key === 'h_line');
    run(head, 0.2);
    run(rope, 0.2);
    const pts = rope.fx.linePts.get(1);
    nearV(pts[0], [4 - 10 + 0.5, 3 + 0.8 * C30, -0.8 * S30], 1e-9, 'the rope\'s end at the shooter\'s muzzle');
    nearV(pts[1], head.fx.anchor, 1e-9, 'its other end at the head');
    run(head, 1);
    assert.ok(rope.fx.stopped, 'the rope goes with the head');
  });

  test('FollowMountPoint places and turns every effect that has one; MUZZLE_POINT turns, MUZZLE_POINT_WITHOUT_ROTATION does not', async () => {
    const { w, view } = await setup();
    const bones = boneView({ F_Weapon: { x: 0.35, up: 0.61, angle: 89.7 }, F_Muzzle: { x: 0.35, up: 1.32, angle: 89.7 } });
    const v = view(5, 'char_lob', 4, 11, { boneOffset: bones.boneOffset.bind(bones) });
    // 安洁莉娜's S2 glow on SPECIAL_0 (spawn NONE): at the staff bone — not at the feet —, laid along the staff
    const g = w.playOn('staff_glow', v);
    nearV(g.place.pos, [-6 + 0.35, 2 + 0.61 * C30, -0.61 * S30], 1e-9, 'on F_Weapon');
    assert.ok(quatRotate(g.place.mountRot, [1, 0, 0])[1] > 0.86, 'its +x rises with the staff');
    // it follows the bone and its angle as the clip moves it
    bones.bones.F_Weapon = { x: 0.2, up: 0.5, angle: 0 };
    run(g, 0.1);
    nearV(g.fx.anchor, [-6 + 0.2, 2 + 0.5 * C30, -0.5 * S30], 1e-9, 'followed');
    nearV(quatRotate(g.fx.mountRot, [1, 0, 0]), [1, 0, 0], 1e-6, 'turned with it');
    // a status loop that keeps its own rotation: follows the head, no mount rotation
    const s = w.playOn('stun_loop', v);
    assert.equal(s.place.mountRot, null);
    assert.ok(typeof s.opts.track === 'function', 'it follows the unit');
    assert.equal(w.playOn('muzzle_norot', v).place.mountRot, null);
    // FollowOwner (not a FollowMountPoint): at its spawn location — the muzzle, turned with it —, followed only as a held loop
    const o = w.playOn('owner_flash', v);
    nearV(o.place.pos, [-6 + 0.35, 2 + 1.32 * C30, -1.32 * S30], 1e-9, 'at the muzzle, not the feet');
    assert.ok(quatRotate(o.place.mountRot, [1, 0, 0])[1] > 0.86, 'MUZZLE_POINT turns it along the barrel');
    assert.equal(o.opts.track, null, 'a one-shot stays where it spawned');
    assert.equal(typeof w.playOn('owner_flash', v, { follow: true, loop: true }).opts.track, 'function', 'a held loop follows the unit');
    // FLIP_TWO_SIDE on a turning mount: the facing comes with the mount's rotation, no mirror on top
    const left = view(6, 'char_lob', 4, 11, { visFacing: -1, boneOffset: boneView({ F_Muzzle: { x: 0.6, up: 1, angle: 0 } }, -1).boneOffset });
    const f = w.playOn('flip_follow', left);
    assert.equal(f.place.mirror, false);
    nearV(quatRotate(f.place.mountRot, [1, 0, 0]), [-1, 0, 0], 1e-6, 'turned to the left');
  });

  test('号角\'s S2: the BlockedRangedAttack only while she blocks; facing variants of modes (灰毫 S2(U) / S2(D) / S2(LR))', async () => {
    const node = (n) => `Modes/S2/Body/Attack/${n}`;
    const burst = { class: 'BurstAttackGroup', select: { method: 'trigger', burst: 3 }, abilities: [
      { class: 'RangedAttackWithConditionalActions', node: node('BlockedRangedAttack'), k: 'blocked' },
      { class: 'RangedAttackWithConditionalActions', node: node('RangedAttack'), k: 'ranged' },
      { class: 'RangedAttackWithConditionalActions', node: node('SelfRangedAttack'), k: 'self' },
      { class: 'AbilitySelectableGroup', node: node('Full Burst'), abilities: [{ class: 'BurstRangedAttack', node: node('Full Burst/RangedAttack') }] },
    ] };
    assert.equal(pickAttacks(burst, { ranged: true }, 0)[1].k, 'ranged', 'a free shot');
    assert.equal(pickAttacks(burst, { ranged: true, blocked: true }, 0)[1].k, 'blocked', 'a shot while she blocks');
    const def = { class: 'AbilitySelectableGroup', select: { method: 'trigger' }, abilities: [
      { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack/BlockedMeleeAttack', k: 'bm' }, { class: 'RangedAttack', node: 'Modes/Default/Body/Attack/RangedAttack', k: 'r' },
      { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack/MeleeAttack', k: 'm' }] };
    assert.deepEqual([[false, false], [false, true], [true, true]].map(([r, bl]) => pickAttacks(def, { ranged: r, blocked: bl }, 0)[1].k), ['m', 'bm', 'r']);
    const modes = makeIndex().units.char_lob.modes;
    assert.deepEqual(['RIGHT', 'LEFT', 'UP', 'DOWN'].map((f) => modeVariant(modes, 'S2', f, true)?.name), ['S2(LR)', 'S2(LR)', 'S2(U)', 'S2(D)']);
    const down = [{ name: 'Default', attack: {} }, { name: 'S2', attack: {} }, { name: 'S2[Down]', attack: {} }];
    assert.deepEqual(['RIGHT', 'DOWN'].map((f) => modeVariant(down, 'S2', f).name), ['S2', 'S2[Down]']);
    assert.equal(modeVariant(down, 'S2', 'RIGHT', true), null, 'variants only: the plain mode is the extractor\'s to name');
    // in a battle: her skill on (no mode in its plan), facing right → S2(LR)'s projectile
    const { w, spawned, view } = await setup();
    const src = view(7, 'char_lob', 4, 11, { flags: 16, boneOffset: boneView({}).boneOffset });
    w.attack(src, view(8, 'enemy_t', 7, 11), 'arrow', 0);
    assert.deepEqual(spawned.map((h) => h.key), ['s2lr_trail']);
  });
});

describe('UnitView.boneOffset (render/units.js)', () => {
  let fake, UnitView;
  before(async () => {
    fake = installFakePixi();
    ({ UnitView } = await import('../../public/js/render/units.js'));
  });
  after(() => fake.restore());

  /** A pixi-spine-like bone (world matrix in skeleton space, y down). */
  const bone = (name, tx, ty, deg = 0) => ({ data: { name }, matrix: { a: Math.cos(deg * Math.PI / 180), b: Math.sin(deg * Math.PI / 180), c: 0, d: 1, tx, ty } });
  /** Pose a bone in place (a skeleton's bones keep their identity, as spine's do). */
  const pose = (b, tx, ty, deg = 0) => { Object.assign(b.matrix, bone('', tx, ty, deg).matrix); return b; };
  /** A skeleton class: the scratch skeletons of bonePose are built from it. */
  class Skel {
    constructor(data) { this.data = data; this.bones = [bone('F_Muzzle', 0, 0)]; }
    findBone(n) { return this.bones.find((b) => b.data.name === n) || null; }
    setToSetupPose() { pose(this.bones[0], 0, 0); }
    updateWorldTransform() {}
  }
  /** An attack clip whose muzzle rises through its strike frame (0.5 s): at t the bone is at (300, −400·t), 40·t° (y down). */
  const clip = { name: 'Attack', duration: 1, apply(s, last, t) { pose(s.bones[0], 300, -400 * t, 40 * t); } };

  function makeView(o = {}) {
    const v = new UnitView(fakeViewCtx(fake.P), { id: 1, side: 'ally', kind: 'op', defId: 'c', spine: 'c', tier: 3, x: 4, y: 10, maxHp: 1000, dir: o.dir || 'RIGHT' });
    const sk = new Skel({});
    pose(sk.bones[0], 320, -160, -20);   // the pose drawn now
    const tr = { animation: clip, trackTime: 0.25, loop: false, getAnimationTime() { return this.trackTime; } };
    v.actor = { spine: { skeleton: sk, spineData: {}, state: { tracks: [tr] } }, _applied: true, frozen: false, mode: 'attack', current: 'Attack',
      strikePose() { return this.mode === 'attack' ? { anim: clip, time: 0.5 } : null; } };
    v.spineReady = true;
    return { v, sk, tr };
  }

  test('the bone as drawn (UNIT.modelScale, the facing), at the strike frame on request, a just-started clip\'s own pose', () => {
    const { v } = makeView();
    const o = v.boneOffset(['B_Muzzle', 'F_Muzzle']);
    near(o.x, 1, 1e-9, 'x: 320 units = 1 tile'); near(o.up, 0.5, 1e-9, 'up: −y'); near(o.angle, 20, 1e-9, 'counter-clockwise'); assert.equal(o.flip, 1);
    // the strike frame (0.5 s): (300, −200) → 0.9375, 0.625 — whatever frame the model was last posed in
    const s = v.boneOffset(['F_Muzzle'], undefined, true);
    near(s.x, 300 / 320, 1e-9, 'strike x'); near(s.up, 200 / 320, 1e-9, 'strike up'); near(s.angle, -20, 1e-9, 'strike angle');
    // not attacking: the drawn pose
    v.actor.mode = 'base';
    near(v.boneOffset(['F_Muzzle'], undefined, true).up, 0.5, 1e-9, 'no attack clip: as drawn');
    // a clip started since the last pose (an attack nobody wound up): its own pose at its track time, not the cross-fade's
    v.actor._applied = false;
    near(v.boneOffset(['F_Muzzle']).up, 100 / 320, 1e-9, 'the new clip at 0.25 s');
    // drawn facing left: x mirrored, the angle in the skeleton kept
    const { v: l } = makeView({ dir: 'LEFT' });
    const lo = l.boneOffset(['F_Muzzle']);
    near(lo.x, -1, 1e-9, 'mirrored'); assert.equal(lo.flip, -1); near(lo.angle, 20, 1e-9, 'skeleton angle');
    assert.equal(v.boneOffset(['Nope']), null, 'no such bone');
    v.spineReady = false;
    assert.equal(v.boneOffset(['F_Muzzle']), null, 'no model drawn');
  });
});

// With the local client's art and extraction (assets fetched, extract.py --only fx): a skin's static Muzzle is its bone
// in the prefab's edit-time Default pose, and the bone at the attack clip's strike frame is elsewhere — the gap the
// runtime closed. Skipped without them.
const IDX = path.join(ROOT, 'public/assets/local/fx/index.json');
const SKEL = (id) => path.join(ROOT, `public/assets/spine/op/${id}/front/${id}.skel`);
const local = existsSync(IDX) && existsSync(SKEL('char_431_ashlok')) && existsSync(SKEL('char_291_aglina'));
test('the local client: 灰毫\'s and 安洁莉娜\'s static Muzzle is the Default pose; the strike frame raises it', { skip: !local && 'local art / extraction absent' }, () => {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const r = require('@pixi-spine/runtime-3.8'), B = require('@pixi-spine/base');
  const loader = { newRegionAttachment: (s, n) => new r.RegionAttachment(n), newMeshAttachment: (s, n) => new r.MeshAttachment(n), newBoundingBoxAttachment: (s, n) => new r.BoundingBoxAttachment(n), newPathAttachment: (s, n) => new r.PathAttachment(n), newPointAttachment: (s, n) => new r.PointAttachment(n), newClippingAttachment: (s, n) => new r.ClippingAttachment(n) };
  const idx = JSON.parse(readFileSync(IDX, 'utf8'));
  /** The bone (skeleton units, y up) at time t of a clip. */
  const at = (id, bone, anim, t) => {
    const data = new r.SkeletonBinary(loader).readSkeletonData(new Uint8Array(readFileSync(SKEL(id))));
    const sk = new r.Skeleton(data);
    sk.setToSetupPose();
    data.findAnimation(anim).apply(sk, t, t, false, null, 1, B.MixBlend.setup, B.MixDirection.mixIn);
    sk.updateWorldTransform();
    const b = sk.findBone(bone);
    return [b.worldX, -b.worldY];
  };
  /** A skin's static front point in skeleton units: through the standard FaceSwitcher (0, −0.16, −0.1) × 0.27 × data 0.01. */
  const stat = (id, name) => {
    const p = idx.skins[id].points[name].front.pos;
    return [p[0] / 0.0027, (C30 * p[1] - S30 * p[2] + 0.16) / 0.0027];
  };
  // 灰毫: the edit-time pose (Default) is where the skin's Muzzle sits — her cannon lowered, 16 units above her feet
  nearV(stat('char_431_ashlok', 'Muzzle'), at('char_431_ashlok', 'F_Muzzle', 'Default', 0), 0.5, '灰毫 static = Default pose');
  // at Attack01's OnAttack (0.533 s) the barrel is raised: 195 units up, 180 above the static point (0.56 tiles as drawn)
  const s1 = at('char_431_ashlok', 'F_Muzzle', 'Attack01', 0.533);
  assert.ok(s1[1] - stat('char_431_ashlok', 'Muzzle')[1] > 150, `灰毫 strike ${s1}`);
  // 安洁莉娜: the static MuzzlePoint 13 units up; S2's attack clip holds the staff above her head (≥ 400 units)
  nearV(stat('char_291_aglina', 'MuzzlePoint'), at('char_291_aglina', 'F_Muzzle', 'Default', 0), 0.5, '安洁莉娜 static = Default pose');
  assert.ok(at('char_291_aglina', 'F_Muzzle', 'Skill2_Loop', 0.233)[1] > 400, '安洁莉娜 S2 staff');
  // and the projectiles: their arcs (ParacurveMovement) and her S2's wobble (AmiyaS2Movement) are what flight.js reads
  assert.equal(idx.projectiles.projectile_chr_ashlok.movement.class, 'ParacurveMovement');
  assert.equal(idx.projectiles.projectile_chr_ashlok.movement.raiseHeight, 1);
  assert.equal(idx.projectiles.projectile_aglina_s2.movement.class, 'AmiyaS2Movement');
});
