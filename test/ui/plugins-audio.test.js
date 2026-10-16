// test/ui/plugins-audio.test.js — a cosmetic plugin's sound (DESIGN §32 P1a review round 2): fetched without its
// extension first (public/js/media.js mediaUrl — the plugin route, for the download managers /media/ avoids), with the
// URL that has it as the fallback; a sound that will not load either way is reported (AudioManager onFailed → the
// cosmetic layers, public/js/assets.js), its entry falls back to the installation's, and the entry the manifest names
// then plays instead, once: the BGM track, the voice line of the same slot, the same UI sound, the bond cue. A fake Web
// Audio window
// (like test/ui/audio.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager, VoiceGate } from '../../public/js/audio.js';
import { mediaUrl } from '../../public/js/media.js';
import { createCosmeticLayers } from '../../public/js/assets.js';
import { loadVisual } from '../../public/js/cosmetics.js';

// what composes a set's document loads with the first document (cosmetics.js loadVisual): here before any layer is laid
await loadVisual();
import { visualHashOf, writesHashOf, VISUAL_HASH_VERSION } from '../../shared/plugins/visual.js';
import { sha256Hex } from '../../shared/sha256.js';

function fakeWindow() {
  const listeners = new Map();
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); } start() {} stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  return {
    win: { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); } },
    fire(t) { listeners.get(t)?.(); },
  };
}

const BASE = { audio: {
  bgm: { prep: { intro: '/assets/audio/bgm/prep_intro.mp3', loop: '/assets/audio/bgm/prep_loop.mp3' } },
  sfx: { ui: { buy: '/assets/audio/sfx/buy.mp3', bondUp: '/assets/audio/sfx/bond.mp3' }, battle: {}, units: {} },
  voice: { char_a: { select: '/assets/audio/voice/a_select.mp3' } },
} };
const fileSha = (rel) => sha256Hex(`tunes:${rel}`);
const url = (rel) => `/p/tunes/${fileSha(rel).slice(0, 8)}/${rel}`;
const doc = (() => {
  const files = ['plugin.json', 'b/loop.mp3', 'b/buy.mp3', 'b/sel.ogg', 'b/bond.mp3'];
  const ops = [
    { at: ['audio', 'bgm', 'prep'], track: { loop: 'b/loop.mp3' } },
    { at: ['audio', 'sfx', 'ui', 'buy'], file: 'b/buy.mp3' },
    { at: ['audio', 'voice', 'char_a', 'select'], file: 'b/sel.ogg' },
    { at: ['audio', 'sfx', 'ui', 'bondUp'], file: 'b/bond.mp3' },
  ];
  const parts = { assets: 'aa'.repeat(32), overlays: [{ id: 'tunes', version: '1.0.0', files: Object.fromEntries(files.map((rel) => [rel, fileSha(rel)])), writes: writesHashOf(ops) }] };
  return { visual: { v: VISUAL_HASH_VERSION, vs: visualHashOf(parts), ...parts }, writes: [{ id: 'tunes', ops }] };
})();
const tick = () => new Promise((r) => setTimeout(r, 10));

test('a plugin sound is fetched without its extension; one that will not load falls back and the installation\'s entry plays instead', async () => {
  const fw = fakeWindow();
  const origFetch = globalThis.fetch;
  const urls = [];
  // the plugin's files are gone from the server (with or without the extension); the installation's are there
  globalThis.fetch = async (u) => { urls.push(u); return String(u).startsWith('/p/') ? { ok: false, status: 404, headers: { get: () => 'text/html' } } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  try {
    const layers = createCosmeticLayers();
    layers.setRoom(doc);
    const failed = [];
    const a = new AudioManager({ win: fw.win, getManifest: () => layers.apply(BASE), onFailed: (u) => { failed.push(u); return layers.fail(u); } });
    a.voiceGate = new VoiceGate({ gapMs: 0 });
    a.install();
    fw.fire('pointerdown');
    assert.equal(layers.apply(BASE).audio.bgm.prep.loop, url('b/loop.mp3'), 'the room\'s track');
    a.playBgm('prep');
    for (let i = 0; i < 4; i++) await tick();
    assert.deepEqual(urls.slice(0, 2), [mediaUrl(url('b/loop.mp3')), url('b/loop.mp3')], 'without the extension first, then with it');
    assert.equal(mediaUrl(url('b/loop.mp3')), url('b/loop.mp3').replace(/\.mp3$/, ''));
    assert.deepEqual(failed, [url('b/loop.mp3')]);
    assert.equal(a.bgm?.loopUrl, BASE.audio.bgm.prep.loop, 'the installation\'s track plays — its intro too');
    assert.ok(urls.includes(mediaUrl(BASE.audio.bgm.prep.intro)));
    // a UI sound
    a.sfx('buy');
    for (let i = 0; i < 3; i++) await tick();
    assert.ok(failed.includes(url('b/buy.mp3')));
    assert.ok(urls.includes(mediaUrl(BASE.audio.sfx.ui.buy)), 'then the installation\'s sound');
    // a voice line of the same slot
    assert.equal(a.voice('char_a', 'select'), true);
    for (let i = 0; i < 3; i++) await tick();
    assert.ok(failed.includes(url('b/sel.ogg')));
    assert.equal(a.voiceNode?.url, BASE.audio.voice.char_a.select);
    // the bond cue (its own channel: _playBondCue)
    a.sfx('bondUp');
    for (let i = 0; i < 3; i++) await tick();
    assert.ok(failed.includes(url('b/bond.mp3')));
    assert.ok(urls.includes(mediaUrl(BASE.audio.sfx.ui.bondUp)), 'then the installation\'s cue');
    assert.ok(a.bondCueNode, 'and it plays');
    // the installation's own sound failing is no plugin file: nothing falls back, nothing plays again
    assert.equal(layers.fail(BASE.audio.sfx.ui.buy), false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('the music follows the art: a room\'s set arriving under the prep track switches to its track; the same loop keeps playing', async () => {
  const fw = fakeWindow();
  const origFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  try {
    const layers = createCosmeticLayers();
    const a = new AudioManager({ win: fw.win, getManifest: () => layers.apply(BASE), onFailed: (u) => layers.fail(u) });
    layers.subscribe(() => a.refreshBgm()); // main.js
    a.install();
    fw.fire('pointerdown');
    a.playBgm('prep');
    for (let i = 0; i < 3; i++) await tick();
    assert.equal(a.bgm?.loopUrl, BASE.audio.bgm.prep.loop, 'the installation\'s track');
    layers.setRoom(doc);
    for (let i = 0; i < 3; i++) await tick();
    assert.equal(a.bgm?.loopUrl, url('b/loop.mp3'), 'the room\'s track now');
    const n = urls.length;
    layers.setPersonal([]); // no change at all
    layers.fail('/assets/nothing.png');
    for (let i = 0; i < 3; i++) await tick();
    assert.equal(a.bgm?.loopUrl, url('b/loop.mp3'));
    assert.equal(urls.length, n, 'nothing fetched again');
    layers.setRoom(null);
    for (let i = 0; i < 3; i++) await tick();
    assert.equal(a.bgm?.loopUrl, BASE.audio.bgm.prep.loop, 'the room left: the installation\'s again');
  } finally {
    globalThis.fetch = origFetch;
  }
});
