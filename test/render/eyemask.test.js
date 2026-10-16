// test/render/eyemask.test.js — closed eyes without the stencil masks (GitHub #177; PR #384 by @Convey123, re-implemented):
// the eyelids of these models are Spine clipping attachments, the masks are off on a crowded field or below high
// quality (render/app.js pickClipping), and SpineActor._eyeMaskFallback (render/spine.js) hides a covered slot the clip
// would cut: less than a quarter of its drawn area inside the clip polygon, or less than half with its centre outside
// (GitHub #647: 纯烬艾雅法拉's eyeballs are regions — never measured before, pixi-spine's bones keep their world transform
// in `matrix` — and her lids close to a slit through their centres).
//
// Real runtime objects throughout: the official skeletons read by @pixi-spine/runtime-3.8, drawn by its real Spine
// (pixi-spine's slot containers and meshes on @pixi/core display objects — a 16 px canvas stand-in is all it needs
// headless) inside the real SpineActor. The eyeballs are meshes, drawn through `slot.currentMesh` — PR #384 hid
// `slot.currentSprite` (null on a mesh slot) and its test stubbed one onto every slot, so nothing was hidden in the
// game. The skeletons are not in the repository (public/assets: `npm run assets`): without them those tests skip; the
// synthetic skeleton (inline Spine JSON read by the same runtime) always runs.
// Run: node --test test/render/eyemask.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const dirOf = (id) => path.join(ROOT, 'public', 'assets', 'spine', 'op', id, 'front');
const have = (id) => existsSync(path.join(dirOf(id), `${id}.skel`)) && existsSync(path.join(dirOf(id), `${id}.atlas`));
const MODELS = ['char_4058_pepe', 'char_4082_qiubai', 'char_4010_etlchi', 'char_1033_swire2'];

let SpineActor, pointInPolygon, rt, base, core;
before(async () => {
  // headless pixi: its shader-precision probe and Texture.WHITE ask for a canvas; no WebGL context is needed to build
  // and update a Spine's display tree
  class HeadlessCanvas { constructor() { this.width = 16; this.height = 16; } getContext(kind) { return kind === '2d' ? { fillStyle: '', fillRect() {}, clearRect() {}, drawImage() {} } : null; } }
  globalThis.HTMLCanvasElement ??= HeadlessCanvas;
  globalThis.document ??= { createElement: () => new HeadlessCanvas() };
  rt = require('@pixi-spine/runtime-3.8');
  base = require('@pixi-spine/base');
  core = require('@pixi/core');
  globalThis.PIXI = { spine: { Spine: rt.Spine } };   // SpineActor builds `new PIXI.spine.Spine(data)`
  ({ SpineActor, pointInPolygon } = await import('../../public/js/render/spine.js'));
});

const cache = new Map();
function skeletonData(id) {
  if (!cache.has(id)) {
    const atlas = new base.TextureAtlas(readFileSync(path.join(dirOf(id), `${id}.atlas`), 'utf8'), (line, cb) => cb(new core.BaseTexture(null, { width: 1024, height: 1024 })));
    cache.set(id, new rt.SkeletonBinary(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(path.join(dirOf(id), `${id}.skel`)))));
  }
  return cache.get(id);
}
/** A real SpineActor of `id` with its manifest entry, clipping masks on or off. */
function actor(id, clip) {
  const a = new SpineActor(skeletonData(id), ASSETS.chars[id].spine.front);
  a.setClipping(clip);
  return a;
}
/** Slots whose container the fallback hid: still attached (pixi-spine shows those), yet not visible. */
const hidden = (a) => a.spine.skeleton.slots.filter((s) => s.getAttachment() && a.spine.slotContainers[s.data.index].visible === false).map((s) => s.data.name).sort();
/** Hidden slots `t` s into clip `clip` ('Die' through SpineActor.die — a knock-down — or 'Idle'), masks off. A fresh
 *  actor per time: pixi-spine's state.update takes a delta. */
function hiddenAt(id, clip, t) {
  const a = actor(id, false);
  if (clip === 'Die') a.die(); else a.spine.state.setAnimation(0, clip, true);
  a.update(t);
  return hidden(a);
}

test('pointInPolygon: inside / outside of a convex and a concave polygon', () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(pointInPolygon(5, 5, square, 4), true);
  for (const [x, y] of [[-1, 5], [11, 5], [5, -3]]) assert.equal(pointInPolygon(x, y, square, 4), false);
  const l = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];   // an L: the notch is outside
  assert.equal(pointInPolygon(6, 6, l, 6), false);
  assert.equal(pointInPolygon(2, 6, l, 6), true);
  assert.equal(pointInPolygon(8, 2, l, 6), true);
});

/**
 * A synthetic skeleton (inline Spine 3.8 JSON and atlas, read by the real runtime — no art needed). The lid clip `cut`
 * (±10 × ±5 around bone `eye`) covers a region eyeball `ballR` and a mesh eyeball `ballM` (8 × 8, centred on bone
 * `ball`, which keeps its size — noScale — like 纯烬艾雅法拉's eyeball bones) and a 4 × 4 highlight `glint` 4 above
 * their centre. Idle scales `eye` (stepped): open at 0 s, 0.7 at 1 s, 0.3 at 2 s and 0.05 at 3 s — a slit through the
 * eyeballs' centres. The L-shaped (concave) clip `blade` holds a bent strip `light` wholly inside it, whose mean vertex
 * (36, 16) lies in the L's notch.
 */
function syntheticData() {
  const atlasText = ['eye.png', 'size: 64,64', 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
    ...['ballR', 'ballM', 'glint', 'light'].flatMap((n, i) => [n, '  rotate: false', `  xy: ${i * 16}, 0`, '  size: 8, 8', '  orig: 8, 8', '  offset: 0, 0', '  index: -1'])].join('\n');
  const atlas = new base.TextureAtlas(atlasText, (line, cb) => cb(new core.BaseTexture(null, { width: 64, height: 64 })));
  const mesh = (vertices, triangles) => ({ type: 'mesh', hull: vertices.length / 2, vertices, triangles, uvs: vertices.map((v) => (v + 4) / 64), width: 8, height: 8 });
  const json = {
    skeleton: { spine: '3.8.99' },
    bones: [{ name: 'root' }, { name: 'eye', parent: 'root' }, { name: 'ball', parent: 'eye', transform: 'noScale' }],
    slots: ['cut:eye', 'ballR:ball', 'ballM:ball', 'glint:ball', 'blade:root', 'light:root'].map((s) => ({ name: s.split(':')[0], bone: s.split(':')[1], attachment: s.split(':')[0] })),
    skins: [{ name: 'default', attachments: {
      cut: { cut: { type: 'clipping', end: 'glint', vertexCount: 4, vertices: [-10, -5, 10, -5, 10, 5, -10, 5] } },
      ballR: { ballR: { width: 8, height: 8 } },
      ballM: { ballM: mesh([-4, -4, 4, -4, 4, 4, -4, 4], [0, 1, 2, 2, 3, 0]) },
      glint: { glint: { y: 4, width: 4, height: 4 } },
      blade: { blade: { type: 'clipping', end: 'light', vertexCount: 6, vertices: [20, 0, 60, 0, 60, 10, 30, 10, 30, 40, 20, 40] } },
      light: { light: mesh([22, 2, 58, 2, 58, 8, 28, 8, 28, 38, 22, 38], [0, 1, 2, 0, 2, 3, 0, 3, 5, 3, 4, 5]) },
    } }],
    animations: { Idle: { bones: { eye: { scale: [
      { time: 0, curve: 'stepped' }, { time: 1, y: 0.7, curve: 'stepped' }, { time: 2, y: 0.3, curve: 'stepped' }, { time: 3, y: 0.05, curve: 'stepped' }, { time: 4 },
    ] } } } },
  };
  return new rt.SkeletonJson(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
}

describe('the clip\'s cut on a synthetic skeleton (always runs)', () => {
  const at = (t, clip = false) => {
    const a = new SpineActor(syntheticData(), { anims: { idle: 'Idle' }, animations: { Idle: 4 } });
    a.setClipping(clip);
    a.update(t);
    return a;
  };

  test('a lid closed to a slit through the eyeballs\' centres hides the region and the mesh eyeball; open, nothing hides', () => {
    // 0.2.2 hid neither: the region's centre was never measured (pixi-spine's bones have no a…d, only `matrix`) and
    // the mesh's centre stays inside the slit — 1/16 of each eyeball is inside it
    const closed = at(3.5);
    assert.deepEqual(hidden(closed), ['ballM', 'ballR', 'glint']);
    assert.ok(closed.spine.skeleton.findSlot('ballR').getAttachment().constructor.name.includes('Region'), 'ballR is a region');
    const bone = closed.spine.skeleton.findBone('ball');
    assert.ok(bone.matrix && bone.a === undefined, 'pixi-spine keeps the world transform in bone.matrix');
    assert.deepEqual(hidden(at(0.5)), [], 'open: the highlight is 3/4 inside');
  });

  test('between a quarter and half inside, the centre decides', () => {
    // at 0.7 the highlight is 3/8 inside with its centre (4 above the eye's) outside the ±3.5 opening: hidden; at 0.3
    // the eyeballs are 3/8 inside with their centres inside the ±1.5 opening: kept (the highlight, wholly outside, hides)
    assert.deepEqual(hidden(at(1.5)), ['glint']);
    assert.deepEqual(hidden(at(2.5)), ['glint']);
  });

  test('a strip wholly inside a concave clip stays although its mean vertex lies outside (0.2.2 hid it)', () => {
    for (const t of [0.5, 1.5, 2.5, 3.5]) assert.ok(!hidden(at(t)).includes('light'), `light at ${t}`);
  });

  test('with the masks on nothing is hidden', () => {
    for (const t of [0.5, 1.5, 2.5, 3.5]) assert.deepEqual(hidden(at(t, true)), [], `masks on at ${t}`);
  });
});

describe('eyelids on the official skeletons, drawn by the real pixi-spine runtime', { skip: !MODELS.every(have) && 'the operator skeletons are not in public/assets (npm run assets)' }, () => {
  test('the eyeballs are meshes drawn through slot.currentMesh, inside the eyelid clip\'s container', () => {
    const a = actor('char_4058_pepe', true);
    a.update(0.1);
    const slots = a.spine.skeleton.slots.filter((s) => /^F_[LR]_Eye_[BC]$/.test(s.data.name));
    assert.equal(slots.length, 4);
    const clip = a.spine.skeleton.slots.find((s) => s.clippingContainer);
    for (const s of slots) {
      assert.equal(s.getAttachment().constructor.name, 'MeshAttachment', s.data.name);
      assert.ok(s.currentMesh && !s.currentSprite, `${s.data.name}: a mesh, no sprite`);
      assert.equal(a.spine.slotContainers[s.data.index].parent, clip.clippingContainer, `${s.data.name} is clipped`);
    }
  });

  test('佩佩 knocked down (Die): the four eyeball / eye-white slots hide once the lids cover three quarters of them (0.10 → 1.00 s), none before', () => {
    // at 0.1 s 21–25 % of each is still inside the closing lids (0.2.2's centre test hid them from 0.13 s)
    for (const t of [0, 0.033, 0.067]) assert.deepEqual(hiddenAt('char_4058_pepe', 'Die', t), [], `open at ${t}`);
    for (const t of [0.1, 0.3, 0.52, 1]) assert.deepEqual(hiddenAt('char_4058_pepe', 'Die', t), ['F_L_Eye_B', 'F_L_Eye_C', 'F_R_Eye_B', 'F_R_Eye_C'], `closed at ${t}`);
  });

  test('仇白 knocked down: both eyeballs hide once the eyes close', () => {
    for (const t of [0, 0.1]) assert.deepEqual(hiddenAt('char_4082_qiubai', 'Die', t), [], `open at ${t}`);
    for (const t of [0.2, 0.52, 1]) assert.deepEqual(hiddenAt('char_4082_qiubai', 'Die', t), ['F_L_Eyeball', 'F_R_Eyeball'], `closed at ${t}`);
  });

  test('隐德来希 / 琳琅诗怀雅 blink in Idle (2.13–2.37 s / 2.90–3.00 s): hidden then, never with the eyes open', () => {
    for (const t of [0.5, 1.9, 3]) assert.deepEqual(hiddenAt('char_4010_etlchi', 'Idle', t), [], `隐德来希 open at ${t}`);
    for (const t of [2.13, 2.25, 2.37]) assert.ok(hiddenAt('char_4010_etlchi', 'Idle', t).length >= 4, `隐德来希 blinking at ${t}`);
    for (const t of [0.5, 2.6, 3.2]) assert.deepEqual(hiddenAt('char_1033_swire2', 'Idle', t), [], `琳琅诗怀雅 open at ${t}`);
    for (const t of [2.9, 2.97, 3]) assert.deepEqual(hiddenAt('char_1033_swire2', 'Idle', t), ['F_H_L_Eyeball', 'F_H_L_Eyew', 'F_H_R_Eyeball', 'F_H_R_Eyew'], `琳琅诗怀雅 at ${t}`);
  });

  test('a whole clip sampled at 30 Hz: hiding is rare outside a knock-down and never takes more than the eyes', () => {
    // [model, clip, seconds, share of frames with something hidden: at least, at most]
    for (const [id, clip, dur, lo, hi] of [
      ['char_4058_pepe', 'Idle', 4, 0, 0], ['char_4058_pepe', 'Die', 1.5, 0.5, 1],
      ['char_4082_qiubai', 'Idle', 4, 0, 0.35], ['char_4082_qiubai', 'Die', 1, 0.5, 1],
      ['char_4010_etlchi', 'Idle', 4, 0.02, 0.2], ['char_1033_swire2', 'Idle', 4, 0.01, 0.2],
    ]) {
      let hit = 0, frames = 0, most = 0;
      for (let t = 0; t <= dur; t += 1 / 30) { const n = hiddenAt(id, clip, t).length; frames++; if (n) hit++; most = Math.max(most, n); }
      assert.ok(hit / frames >= lo && hit / frames <= hi, `${id} ${clip}: ${Math.round(hit / frames * 100)} % of frames (want ${lo * 100}–${hi * 100} %)`);
      assert.ok(most <= 8, `${id} ${clip}: at most ${most} slots in one frame`);
    }
  });

  test('with the masks on nothing is hidden (the stencil cuts), and turning them back on shows what the fallback hid', () => {
    const on = actor('char_4058_pepe', true);
    on.die();
    on.update(0.52);
    assert.deepEqual(hidden(on), [], 'masks on: the fallback stays out');
    const off = actor('char_4058_pepe', false);
    off.die();
    off.update(0.52);
    assert.equal(hidden(off).length, 4, 'masks off: the closed eyes are hidden');
    off.setClipping(true);
    assert.deepEqual(hidden(off), [], 'shown again for the stencil');
    const clip = off.spine.skeleton.slots.find((s) => s.clippingContainer);
    assert.equal(clip.clippingContainer.mask, clip.currentGraphics, 'the mask is back on');
  });
});

describe('纯烬艾雅法拉 (GitHub #647): region eyeballs under lids that close to a slit', { skip: !have('char_1016_agoat2') && 'her skeleton is not in public/assets (npm run assets)' }, () => {
  const EYES = ['F_L_Eyeball', 'F_R_Eyeball'];

  test('the eyeballs are regions clipped by F_*_Eyecut, on bones that keep their size while the lid bone squashes', () => {
    const a = actor('char_1016_agoat2', true);
    a.update(0.1);
    for (const name of EYES) {
      const s = a.spine.skeleton.findSlot(name);
      assert.ok(s.getAttachment().constructor.name.includes('Region'), `${name}: a region`);
      assert.equal(s.bone.data.transformMode, base.TransformMode.NoScale, `${name}: its bone does not inherit the eye bone's scale`);
      const cut = a.spine.skeleton.findSlot(name.replace('Eyeball', 'Eyecut'));
      assert.equal(a.spine.slotContainers[s.data.index].parent, cut.clippingContainer, `${name} is clipped by ${cut.data.name}`);
    }
  });

  test('Idle blink (lids shut 2.17–2.27 s, F_*_Eyeclose2 drawn): both eyeballs hidden then, never with the eyes open', () => {
    for (const t of [0.5, 1.9, 2.4]) assert.deepEqual(hiddenAt('char_1016_agoat2', 'Idle', t), [], `open at ${t}`);
    for (const t of [2.17, 2.2, 2.23, 2.26]) assert.deepEqual(hiddenAt('char_1016_agoat2', 'Idle', t), EYES, `shut at ${t}`);
  });

  test('her S3 closes her eyes while it is on (Skill_3_Idle): hidden throughout, also through the actor\'s own skill path', () => {
    for (const t of [0.1, 1, 2.5]) assert.deepEqual(hiddenAt('char_1016_agoat2', 'Skill_3_Idle', t), EYES, `Skill_3_Idle at ${t}`);
    const a = actor('char_1016_agoat2', false);
    a.setSkillIndex(2);
    a.update(0.5);
    a.setSkill(true);
    for (let i = 0; i < 20; i++) a.update(0.1);
    assert.equal(a.spine.state.tracks[0].animation.name, 'Skill_3_Idle');
    assert.deepEqual(hidden(a), EYES);
  });

  test('every clip sampled at 30 Hz: only the two eyeballs ever hide, and in Idle only during the blink', () => {
    const data = skeletonData('char_1016_agoat2');
    for (const anim of data.animations) {
      const a = actor('char_1016_agoat2', false);
      a.spine.state.setAnimation(0, anim.name, true);
      let hit = 0, frames = 0;
      for (let f = 0; f <= Math.ceil(anim.duration * 30); f++) {
        a.update(f ? 1 / 30 : 0);
        const h = hidden(a);
        frames++;
        if (h.length) { hit++; assert.deepEqual(h, EYES, `${anim.name} at ${(f / 30).toFixed(3)}`); }
      }
      if (anim.name === 'Idle') assert.equal(hit, 4, `Idle: ${hit} of ${frames} frames`);
      if (anim.name === 'Skill_3_Idle') assert.equal(hit, frames, 'Skill_3_Idle: every frame');
    }
  });

  test('with the masks on nothing is hidden', () => {
    const a = actor('char_1016_agoat2', true);
    a.spine.state.setAnimation(0, 'Idle', true);
    a.update(2.2);
    assert.deepEqual(hidden(a), []);
  });
});
