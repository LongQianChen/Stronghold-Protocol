// test/render/vfx-frame.test.js — the official effects' frames and clips (DESIGN §33.2, §33.10): the Unity battle
// frame ↔ board frame map, the effects' view-projection against render/projection.js's camera (the pixels must agree),
// Euler / quaternion conventions, clip sampling (transform, active, material, renderer and system bindings; wrap and
// hold), the mount points of a unit's skin and the board heightfield of the depth pre-pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unityToBoard, boardToUnity, quatEuler, quatRotate, mat4, mat4Point } from '../../public/js/render/vfx/math.js';
import { boardViewProj, unityViewProj, heightfield } from '../../public/js/render/vfx/system.js';
import { compileClip, sampleClip, clipTime, quatToEuler } from '../../public/js/render/vfx/clips.js';
import { spawnPoint, mountPoint, spawnKind, mountKind, skinShift } from '../../public/js/render/vfx/mounts.js';
import { presetCamera, OFFICIAL } from '../../public/js/render/projection.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

describe('frames', () => {
  test('the Unity battle frame is the board frame through C = diag(1, 1, −1) and the centre', () => {
    assert.deepEqual(unityToBoard(0, 0, 0), [10, 9, -0]);
    assert.deepEqual(unityToBoard(-4.5, 2, -0.75), [5.5, 11, 0.75]);
    assert.deepEqual(boardToUnity(...unityToBoard(1.25, -3, 2)), [1.25, -3, 2]);
  });

  test("the effects' view-projection lands every point on Camera.project's pixel", () => {
    const W = 1280, H = 720;
    for (const kind of ['normal', 'prep', 'unite', 'boss']) {
      const cam = presetCamera(kind, { width: W, height: H }, { side: 'L' });
      const vpB = boardViewProj(cam, W, H, 0.5, 80, mat4());
      const vpU = unityViewProj(cam, W, H, 0.5, 80, mat4());
      for (const [x, y, z] of [[5, 10, 0], [0, 9, 0.4], [10, 12, 1.5], [3.3, 7.7, 0.1]]) {
        const p = cam.project(x, y, z);
        const clip = (m, a, b, c) => {
          const o = [m[0] * a + m[4] * b + m[8] * c + m[12], m[1] * a + m[5] * b + m[9] * c + m[13], m[2] * a + m[6] * b + m[10] * c + m[14], m[3] * a + m[7] * b + m[11] * c + m[15]];
          return [(o[0] / o[3] + 1) / 2 * W, (1 - o[1] / o[3]) / 2 * H, o[2] / o[3]];
        };
        const b = clip(vpB, x, y, z);
        near(b[0], p.x, 1e-3, `${kind} board x`); near(b[1], p.y, 1e-3, `${kind} board y`);
        assert.ok(b[2] > -1 && b[2] < 1, 'inside the depth range');
        const u = boardToUnity(x, y, z);
        const c = clip(vpU, u[0], u[1], u[2]);
        near(c[0], p.x, 1e-3, `${kind} unity x`); near(c[1], p.y, 1e-3, `${kind} unity y`);
      }
    }
  });

  test("the official camera's forward in the Unity frame is (0, sin 30°, cos 30°): a −30° X tilt faces it", () => {
    // a unit's Graphic node (quaternion (−0.258819, 0, 0, 0.965926)) turns its skeleton's normal onto the view axis
    const n = quatRotate([-0.258819, 0, 0, 0.965926], [0, 0, 1]);
    const t = OFFICIAL.pitch * Math.PI / 180;
    near(n[1], Math.sin(t), 1e-5); near(n[2], Math.cos(t), 1e-5);
  });

  test('quatEuler ↔ quatToEuler round trip (Unity Z, X, Y order)', () => {
    for (const [x, y, z] of [[30, 0, 0], [0, 45, 0], [0, 0, -60], [20, 35, 50], [-70, 10, 120]]) {
      const e = quatToEuler(quatEuler(x, y, z));
      const q1 = quatEuler(x, y, z), q2 = quatEuler(e[0], e[1], e[2]);
      const dot = Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]);
      near(dot, 1, 1e-6, `${x},${y},${z}`);
    }
  });

  test('heightfield: the tile tops at their heights (less the bias) and walls for raised tiles', () => {
    const tri = heightfield((r, c) => (r === 1 && c === 1 ? 0.42 : 0), 3, 3, 0.02);
    // 9 tops (2 triangles each) + 4 walls of the raised tile
    assert.equal(tri.length / 9, 9 * 2 + 4 * 2);
    let top = 0;
    for (let i = 2; i < tri.length; i += 3) top = Math.max(top, tri[i]);
    near(top, 0.4, 1e-6);
  });
});

describe('clips', () => {
  const clip = compileClip({
    name: 'c', length: 2, loop: false, curves: [
      { node: 1, type: 'Transform', property: 'localPosition.x', keys: [[0, 0, 1, 1], [2, 2, 1, 1]] },
      { node: 1, type: 'Transform', property: 'localEulerAnglesRaw.z', keys: [[0, 0, -360, -360], [2, -720, -360, -360]] },
      { node: 2, type: 'GameObject', property: 'm_IsActive', keys: [[0, 0, null, null], [1, 1, null, null]] },
      { node: 3, type: 'MeshRenderer', property: 'material._TintColor.a', keys: [[0, 1, 0, 0], [2, 0, 0, 0]] },
      { node: 3, type: 'MeshRenderer', property: 'material._Amount', keys: [[0, 0.2, 0, 0], [2, 0.2, 0, 0]] },
      { node: 4, type: 'TrailRenderer', property: 'm_Parameters.widthMultiplier', keys: [[0, 3, 0, 0]] },
      { node: 5, type: 'ParticleSystem', property: 'EmissionModule.rateOverTime.scalar', keys: [[0, 10, 0, 0]] },
      { node: null, type: 'Transform', property: 'localPosition.y', keys: [[0, 9, 0, 0]], pathHash: 1 },
    ],
  });

  test('every binding reaches the sink, unresolved ones (node null) are skipped', () => {
    const got = { t: [], a: [], m: [], r: [], s: [] };
    const sink = {
      transform: (n, pos, rot, scl, eul) => got.t.push([n, pos && pos.slice(), eul && eul.slice()]),
      active: (n, on) => got.a.push([n, on]),
      material: (n, type, prop, comp, v) => got.m.push([n, prop, comp, v]),
      renderer: (n, type, path, v) => got.r.push([n, path, v]),
      system: (n, path, v) => got.s.push([n, path, v]),
    };
    sampleClip(clip, 1, sink);
    assert.equal(got.t.length, 1);
    const [n, pos, eul] = got.t[0];
    assert.equal(n, 1);
    near(pos[0], 1, 1e-9); assert.ok(Number.isNaN(pos[1]), 'unanimated axes stay NaN');
    near(eul[2], -360, 1e-9);
    assert.deepEqual(got.a, [[2, true]]);
    assert.deepEqual(got.m.map((x) => x.slice(0, 3)), [[3, '_TintColor', 3], [3, '_Amount', -1]]);
    near(got.m[0][3], 0.5, 1e-9);
    assert.deepEqual(got.r, [[4, 'm_Parameters.widthMultiplier', 3]]);
    assert.deepEqual(got.s, [[5, 'EmissionModule.rateOverTime.scalar', 10]]);
  });

  test('a non-looping clip holds its end; a looping one wraps; ping-pong comes back', () => {
    assert.equal(clipTime(clip, 5), 2);
    assert.equal(clipTime(compileClip({ length: 2, loop: true, curves: [] }), 5), 1);
    assert.equal(clipTime(compileClip({ length: 2, wrapMode: 4, curves: [] }), 3), 1);
  });
});

describe('mount points', () => {
  const skin = { points: {
    HitPoint: { front: { pos: [0, 0.232, -0.25] }, back: { pos: [0.1, 0.2, -0.3] } },
    Muzzle: { front: { pos: [0.37, 0.4, -0.34] } },
    HeadPoint: { all: { pos: [0, 0.75, -0.55] } },
    SpecialPoint0: { front: { pos: [0.15, 0.17, -0.21] } },
  } };

  test('spawn locations and mount types name the skin points', () => {
    assert.equal(spawnKind(2), 'hit'); assert.equal(spawnKind(3), 'muzzle'); assert.equal(spawnKind(6), 'muzzle');
    assert.equal(spawnKind(4), 'head'); assert.equal(spawnKind(8), 's0'); assert.equal(spawnKind(1), null); assert.equal(spawnKind(5), null);
    assert.equal(mountKind(0), null); assert.equal(mountKind(1), 'hit'); assert.equal(mountKind(3), 'head'); assert.equal(mountKind(5), 's0');
  });

  test('a point at the feet in the Unity frame, mirrored for a left-facing unit, the Back skeleton for one facing up', () => {
    const unit = { x: 5, y: 10, z: 0.42, left: false, back: false };
    assert.deepEqual(spawnPoint(skin, 3, unit).map((v) => Math.round(v * 1000) / 1000), [-4.63, 1.4, -0.76]);
    assert.deepEqual(spawnPoint(skin, 3, { ...unit, left: true }).map((v) => Math.round(v * 1000) / 1000), [-5.37, 1.4, -0.76]);
    assert.deepEqual(spawnPoint(skin, 2, { ...unit, back: true }).map((v) => Math.round(v * 1000) / 1000), [-4.9, 1.2, -0.72]);
    assert.deepEqual(mountPoint(skin, 0, unit).map((v) => Math.round(v * 1000) / 1000), [-5, 1, -0.42]);
    assert.deepEqual(spawnPoint(skin, 8, unit).map((v) => Math.round(v * 1000) / 1000), [-4.85, 1.17, -0.63]);
  });

  test('a skin displaced by whole tiles (the prefab placement in its composition) is moved back over the feet', () => {
    const bad = { points: { HitPoint: { all: { pos: [5, 3.16, -0.268] } }, HeadPoint: { all: { pos: [5, 3.397, -0.585] } } } };
    const sh = skinShift(bad);
    assert.ok(sh);
    const p = spawnPoint(bad, 2, { x: 10, y: 9, z: 0 });
    near(p[0], 0, 1e-9); near(p[1], 0.268 * 0.9, 1e-6); near(p[2], -0.268, 1e-9);
    const h = spawnPoint(bad, 4, { x: 10, y: 9, z: 0 });
    near(h[1] - p[1], 3.397 - 3.16, 1e-6, 'the points keep their relative placement');
    assert.equal(skinShift(skin), null);
  });
});

test('mat4Point of an identity matrix is the point itself', () => {
  assert.deepEqual(mat4Point(mat4(), 1, 2, 3, [0, 0, 0]), [1, 2, 3]);
});
