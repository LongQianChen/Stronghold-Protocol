// test/render/cosmetic-refresh.test.js — views already on the board follow the art manifest when it changes under them
// (DESIGN §32 P1a review round 2): a room's cosmetic plugins arriving after the board was drawn (a reconnect, a spectator
// joining a match), a personal plugin switched during a match, the set taken away again. render/units.js retryAssets —
// which render/app.js calls on every assets.onChange — loads a picture or a Spine model the manifest names now when it
// is not the one shown or loading (the new model replaces the old in place and the old one is released; a load in
// flight of the old model is superseded), and nothing for a unit whose art did not change; render/app.js's backdrop
// mountains and shadow sprite follow the manifest's URL instead of being asked once. A plugin model or picture that fails
// to load falls back: the asset store reports it to the layers, which leave that write out, and the view loads the
// installation's. The fake PIXI of test/render/fakepixi.js; the asset store and the cosmetic layers of public/js/assets.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { createAssets, createCosmeticLayers } from '../../public/js/assets.js';
import { loadVisual } from '../../public/js/cosmetics.js';

// what composes a set's document loads with the first document (cosmetics.js loadVisual): here before any layer is laid
await loadVisual();
import { visualHashOf, modelHashOf, writesHashOf, VISUAL_HASH_VERSION } from '../../shared/plugins/visual.js';
import { sha256Hex } from '../../shared/sha256.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const IMG = { width: 180, height: 180 };
const SP = (dir) => ({ skel: `${dir}/a.skel`, atlas: `${dir}/a.atlas`, textures: [`${dir}/a.png`], anims: { idle: 'Idle' }, animations: { Idle: 1 } });
/** The installation's manifest as a page loads it (0.2.6: content-hashed URLs). */
const M = {
  chars: {
    char_002_amiya: { avatar: '/assets/~1111111111111111/char/avatar/amiya.png', spine: { front: SP('/assets/~2222222222222222/spine/amiya') } },
    char_010_chen: { avatar: '/assets/~3333333333333333/char/avatar/chen.png', spine: { front: SP('/assets/~4444444444444444/spine/chen') } },
  },
  ui: {},
};
const fileSha = (rel) => sha256Hex(`skin:${rel}`);
const FILES = ['plugin.json', 'art/a.png', 'm/t.skel', 'm/t.atlas', 'm/t.png', 'art/c.png'];
/** A room set of one plugin (server/plugins/visualSet.js's document): Amiya's avatar and Front model. */
/** A set document of one plugin `id` with these ops (server/plugins/visualSet.js). */
const docOf = (id, ops, files = FILES) => {
  const parts = { assets: 'aa'.repeat(32), overlays: [{ id, version: '1.0.0', files: Object.fromEntries(files.map((rel) => [rel, fileSha(rel)])), writes: writesHashOf(ops) }] };
  return { visual: { v: VISUAL_HASH_VERSION, vs: visualHashOf(parts), ...parts }, writes: [{ id, ops }] };
};
const META = { anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null };
const roomDoc = docOf('skin', [
  { at: ['chars', 'char_002_amiya', 'avatar'], file: 'art/a.png' },
  { at: ['chars', 'char_002_amiya', 'spine', 'front'], spine: { skel: 'm/t.skel', atlas: 'm/t.atlas', textures: ['m/t.png'], pma: false, meta: META } },
]);
const MH = modelHashOf(['m/t.skel', 'm/t.atlas', 'm/t.png'].map(fileSha)).slice(0, 8);
const PLUGIN_SKEL = `/p/skin/${MH}/m/t.skel`;
const PLUGIN_AVATAR = `/p/skin/${fileSha('art/a.png').slice(0, 8)}/art/a.png`;

describe('views already drawn follow a changed manifest (render/units.js retryAssets)', () => {
  let fake, UnitView;
  before(async () => {
    fake = installFakePixi();
    ({ UnitView } = await import('../../public/js/render/units.js'));
  });
  after(() => fake.restore());
  const cam = () => presetCamera('prep', { width: 1280, height: 720 });
  const unit = (assets, defId = 'char_002_amiya') => new UnitView(fakeViewCtx(fake.P, { assets, cam }),
    { id: 1, side: 'ally', kind: 'chess', defId, spine: defId, avatar: defId, tier: 3, x: 5, y: 12, maxHp: 1000 }, { prep: true });
  /** An asset store over the layers, recording what it loads; `hold` holds a model load until released. */
  const store = (layers, { hold = null } = {}) => {
    const loads = [];
    const images = [];
    const a = createAssets({ manifest: M, cosmetics: layers, loadImage: async (u) => { images.push(u); return IMG; }, unloadSpine: () => {},
      loadSpine: (e) => { loads.push(e.skel); return hold && hold.has(e.skel) ? hold.get(e.skel) : Promise.resolve({ animations: [{ name: 'Idle' }] }); } });
    return { a, loads, images };
  };

  test('the room\'s set arrives after the board was drawn: the plugin model replaces the shown one in place, its picture too; the set gone, back again', async () => {
    const layers = createCosmeticLayers();
    const { a, loads, images } = store(layers);
    const v = unit(a);
    const other = unit(a, 'char_010_chen');
    a.onChange(() => { v.retryAssets(); other.retryAssets(); }); // render/app.js onAssets
    await settle();
    assert.deepEqual(loads.sort(), [M.chars.char_002_amiya.spine.front.skel, M.chars.char_010_chen.spine.front.skel].sort());
    const first = v.actor;
    assert.ok(first && v.spineReady, 'the installation\'s model is shown');
    assert.equal(v._pic.url, M.chars.char_002_amiya.avatar);
    const chenActor = other.actor;
    layers.setRoom(roomDoc);
    await settle();
    assert.equal(loads.at(-1), PLUGIN_SKEL, 'the model the manifest names now');
    assert.ok(v.actor && v.actor !== first, 'replaced');
    assert.equal(v._actorEntry.skel, PLUGIN_SKEL);
    assert.equal(first.spine, null, 'the old model is gone');
    assert.equal(v._pic.url, PLUGIN_AVATAR);
    assert.ok(images.includes(PLUGIN_AVATAR), 'its picture (the diamond) loaded too');
    assert.equal(other.actor, chenActor, 'a unit whose art did not change keeps its model');
    assert.equal(loads.filter((u) => u === M.chars.char_010_chen.spine.front.skel).length, 1, '— not even loaded again');
    assert.equal(a.spine.stats().refs, 2, 'every acquire paired with one release: one model each');
    // the room's set taken away (the page left the room, the host switched it off): the installation's art again
    layers.setRoom(null);
    await settle();
    assert.equal(v._actorEntry.skel, M.chars.char_002_amiya.spine.front.skel);
    assert.equal(v._pic.url, M.chars.char_002_amiya.avatar);
    assert.equal(a.spine.stats().refs, 2);
    v.destroy();
    other.destroy();
    assert.equal(a.spine.stats().refs, 0);
  });

  test('a model still loading when the set arrives is superseded: the plugin model loads, the late one is released', async () => {
    const layers = createCosmeticLayers();
    let release;
    const vanilla = M.chars.char_002_amiya.spine.front.skel;
    const hold = new Map([[vanilla, new Promise((r) => { release = r; })]]);
    const { a, loads } = store(layers, { hold });
    const v = unit(a);
    a.onChange(() => v.retryAssets());
    await settle();
    assert.deepEqual(loads, [vanilla]);
    assert.equal(v.actor, null, 'still loading');
    layers.setRoom(roomDoc);
    await settle();
    assert.deepEqual(loads, [vanilla, PLUGIN_SKEL], 'the plugin model started at once');
    assert.equal(v._actorEntry?.skel, PLUGIN_SKEL);
    release({ animations: [{ name: 'Idle' }] });
    await settle();
    assert.equal(v._actorEntry.skel, PLUGIN_SKEL, 'the late installation model never shows');
    assert.equal(a.spine.stats().refs, 1, 'and is released');
    v.destroy();
  });

  test('a plugin model that fails to load falls back: the view loads the installation\'s; a failed plugin picture too', async () => {
    const layers = createCosmeticLayers();
    const loads = [];
    const vanilla = M.chars.char_002_amiya.spine.front.skel;
    const a = createAssets({ manifest: M, cosmetics: layers, unloadSpine: () => {},
      loadImage: async (u) => { if (u === PLUGIN_AVATAR) throw new Error('image failed'); return IMG; },
      loadSpine: async (e) => { loads.push(e.skel); if (e.skel === PLUGIN_SKEL) throw new Error('HTTP 404'); return { animations: [{ name: 'Idle' }] }; } });
    layers.setRoom(roomDoc);
    const v = unit(a);
    a.onChange(() => v.retryAssets());
    await settle();
    assert.deepEqual(loads, [PLUGIN_SKEL, vanilla], 'the plugin model first, then the installation\'s');
    assert.equal(v._actorEntry?.skel, vanilla);
    assert.deepEqual(layers.failed.sort(), [PLUGIN_AVATAR, PLUGIN_SKEL].sort(), 'both reported by the store');
    assert.equal(a.avatar('char_002_amiya'), M.chars.char_002_amiya.avatar, 'the picture fell back too');
    assert.equal(v._pic.url, M.chars.char_002_amiya.avatar);
    v.destroy();
  });

  test('without plugins nothing changes for a model already shown: the local-client manifest arriving late keeps the web model (as before)', async () => {
    const web = SP('/assets/~5555555555555555/spine/enemy/mh');
    const M2 = { enemies: { enemy_1305_mhslim: { icon: '/assets/e/mh.png', spine: web, spineLocal: { group: 'spine/enemy/mh', skel: 'mh.skel', atlas: 'mh.atlas', textures: ['mh.png'], anims: { idle: 'Idle' } } } }, ui: {} };
    const LOCAL = { groups: { 'spine/enemy/mh': { 'mh.skel': { path: '/l/mh.skel' }, 'mh.atlas': { path: '/l/mh.atlas' }, 'mh.png': { path: '/l/mh.png' } } } };
    const loads = [];
    const a = createAssets({ manifest: M2, cosmetics: createCosmeticLayers(), loadImage: async () => IMG, unloadSpine: () => {},
      loadSpine: async (e) => { loads.push(e.skel); return { animations: [{ name: 'Idle' }] }; } });
    const v = new UnitView(fakeViewCtx(fake.P, { assets: a, cam }), { id: 7, side: 'enemy', kind: 'enemy', defId: 'enemy_1305_mhslim', spine: 'enemy_1305_mhslim', tier: 1, x: 3, y: 4, maxHp: 500 }, {});
    a.onChange(() => v.retryAssets());
    await settle();
    assert.deepEqual(loads, [web.skel]);
    const shown = v.actor;
    assert.equal(a.seedLocal(LOCAL), true, 'the local-client manifest, late');
    await settle();
    assert.deepEqual(loads, [web.skel], 'nothing loaded again');
    assert.equal(v.actor, shown, 'the web model stays');
    v.destroy();
  });

  // a token the installation draws as a plain diamond (no picture, no model) — a plugin gives it both
  const BLANK = { ...M, tokens: { token_blank: {} } };
  const blankDoc = docOf('skin', [
    { at: ['tokens', 'token_blank', 'avatar'], file: 'art/a.png' },
    { at: ['tokens', 'token_blank', 'spine'], spine: { skel: 'm/t.skel', atlas: 'm/t.atlas', textures: ['m/t.png'], pma: false, meta: META } },
  ]);
  const TOKEN_AVATAR = `/p/skin/${fileSha('art/a.png').slice(0, 8)}/art/a.png`;
  const tokenView = (a) => new UnitView(fakeViewCtx(fake.P, { assets: a, cam }), { id: 9, side: 'ally', kind: 'token', defId: 'token_blank', spine: 'token_blank', avatar: 'token_blank', tier: 1, x: 4, y: 6, maxHp: 100 }, { prep: true });

  test('art only a plugin gives (the installation\'s slot is empty) leaves the board with its layer: no model, no picture, the references back', async () => {
    const layers = createCosmeticLayers();
    const loads = [];
    const a = createAssets({ manifest: BLANK, cosmetics: layers, loadImage: async () => IMG, unloadSpine: () => {},
      loadSpine: async (e) => { loads.push(e.skel); return { animations: [{ name: 'Idle' }] }; } });
    const v = tokenView(a);
    const chen = unit(a, 'char_010_chen');
    a.onChange(() => { v.retryAssets(); chen.retryAssets(); });
    await settle();
    assert.equal(v.actor, null, 'the installation draws it as a diamond');
    const chenActor = chen.actor;
    layers.setRoom(blankDoc);
    await settle();
    assert.equal(v._actorEntry?.skel, PLUGIN_SKEL, 'the plugin\'s model');
    assert.equal(v._pic.url, TOKEN_AVATAR);
    assert.equal(a.spine.stats().refs, 2, 'its model and Chen\'s');
    layers.setRoom(null);
    await settle();
    assert.equal(v.actor, null, 'the model is gone with its layer');
    assert.equal(v._pic.url, null, 'and the picture');
    assert.equal(v._pic.state, 'none');
    assert.equal(v.fallback.visible, true, 'the diamond again');
    assert.equal(a.spine.stats().refs, 1, 'its model released: only Chen\'s left');
    assert.equal(chen.actor, chenActor, 'Chen keeps his');
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v._pic.shown, 'placeholder', 'the image-less diamond, as without the plugin');
    v.destroy();
    chen.destroy();
    assert.equal(a.spine.stats().refs, 0);
  });

  test('the layer taken away while its model and picture still load: the late ones are never drawn and are released', async () => {
    const layers = createCosmeticLayers();
    let releaseModel;
    let releaseImage;
    const a = createAssets({ manifest: BLANK, cosmetics: layers, unloadSpine: () => {},
      loadImage: (u) => (u === TOKEN_AVATAR ? new Promise((r) => { releaseImage = () => r(IMG); }) : Promise.resolve(IMG)),
      loadSpine: (e) => (e.skel === PLUGIN_SKEL ? new Promise((r) => { releaseModel = () => r({ animations: [{ name: 'Idle' }] }); }) : Promise.resolve({ animations: [{ name: 'Idle' }] })) });
    const v = tokenView(a);
    a.onChange(() => v.retryAssets());
    await settle();
    layers.setRoom(blankDoc);
    await settle();
    assert.equal(typeof releaseModel, 'function', 'the plugin model is loading');
    assert.equal(typeof releaseImage, 'function', 'its picture too');
    assert.equal(v._spineBusy, true);
    layers.setRoom(null);
    await settle();
    assert.equal(v._spineBusy, false, 'the load is no longer this view\'s');
    releaseModel();
    releaseImage();
    await settle();
    assert.equal(v.actor, null, 'the late model is never shown');
    assert.equal(v._pic.state, 'none', 'nor the late picture');
    assert.equal(a.spine.stats().refs, 0, 'and the late model is released');
    v.destroy();
  });

  test('a replaced picture keeps the old one on the diamond until the new one is there', async () => {
    const layers = createCosmeticLayers();
    let done;
    const a = createAssets({ manifest: M, cosmetics: layers, unloadSpine: () => {}, loadSpine: () => new Promise(() => {}),
      loadImage: (u) => (u === PLUGIN_AVATAR ? new Promise((r) => { done = () => r(IMG); }) : Promise.resolve(IMG)) });
    const v = unit(a);
    await settle();
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v._pic.shown, 'img');
    const before = v.fallback.texture;
    layers.setRoom(roomDoc);
    v.retryAssets();
    await settle();
    assert.equal(typeof done, 'function', 'the new picture is on its way');
    v._pic.t0 -= 10000; // long past PIC_WAIT_MS: a picture still loading would show the placeholder
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v.fallback.texture, before, 'no placeholder in between');
    done();
    await settle();
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v._pic.shown, 'img');
    assert.notEqual(v.fallback.texture, before, 'the new picture');
    v.destroy();
  });
});

describe('the field view follows the manifest (render/app.js)', () => {
  test('the backdrop mountains and the shadow sprite are asked again whenever the manifest names another one', () => {
    const app = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    assert.match(app, /const url = assets\.ui \? assets\.ui\('entry\/bg_mountains_tiled'\) : null;\n {4}if \(url === mountainsUrl \|\| !assets\.image\) return;/);
    assert.match(app, /const url = assets\.ui \? assets\.ui\('battle\/sprite_shadow'\) : null;\n {4}if \(url === shadowUrl\) return;/);
    assert.match(app, /if \(!url\) \{ setShadow\(shadowTexture\(\)\); return; \}/, 'none named any more: the procedural shadow');
    assert.doesNotMatch(app, /mountainsAsked|shadowAsked/, 'never asked only once');
    assert.match(app, /function onAssets\(\) \{\n {4}if \(destroyed\) return;\n {4}retryBoard\(\);\n {4}loadShadow\(\);\n {4}loadMountains\(\);/);
  });
});
