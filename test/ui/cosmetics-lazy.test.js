// test/ui/cosmetics-lazy.test.js — public/js/cosmetics.js before what composes a set's document is loaded (DESIGN §32 P1a
// review round 3): the title page carries the layers without shared/plugins/visual.js; a layer laid before it is there
// (content.js loads it first, so only a careless caller) is laid once it is, the last one wins, and the art beneath is
// untouched meanwhile. Its own file: node --test gives it a fresh process, so the module is really not loaded yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCosmeticLayers, visualNow, loadVisual } from '../../public/js/cosmetics.js';
import { sha256Hex } from '../../shared/sha256.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const BASE = { chars: { char_102_texas: { avatar: '/assets/texas.png' } } };

test('a layer laid before shared/plugins/visual.js is loaded: laid once it is (the last one wins), the art beneath untouched meanwhile', async () => {
  assert.equal(visualNow(), null, 'nothing loaded at start');
  const layers = createCosmeticLayers();
  let told = 0;
  layers.subscribe(() => told++);
  // a set document of one plugin, made with the module the page would load (here only after the first setRoom)
  const v = await import('../../shared/plugins/visual.js');
  const ops = [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'a.png' }];
  const parts = { assets: 'aa'.repeat(32), overlays: [{ id: 'red', version: '1.0.0', files: { 'a.png': sha256Hex('a'), 'plugin.json': sha256Hex('p') }, writes: v.writesHashOf(ops) }] };
  const doc = { visual: { v: v.VISUAL_HASH_VERSION, vs: v.visualHashOf(parts), ...parts }, writes: [{ id: 'red', ops }] };
  const stale = { ...doc };
  assert.equal(visualNow(), null, 'importing it elsewhere is not what the layers use: loadVisual is');
  layers.setRoom(stale);
  layers.setRoom(doc);
  // another page's layers: laid, then taken away before the module is there — they stay away
  const gone = createCosmeticLayers();
  gone.setRoom(doc);
  gone.setRoom(null);
  assert.equal(layers.room, null, 'not laid yet');
  assert.equal(layers.apply(BASE), BASE, 'the art beneath meanwhile');
  await loadVisual();
  await tick();
  assert.equal(layers.room, doc, 'laid now — the last one');
  assert.equal(told, 1, 'told once');
  assert.match(layers.apply(BASE).chars.char_102_texas.avatar, /^\/p\/red\/[0-9a-f]{8}\/a\.png$/);
  assert.equal(gone.room, null, 'taken away before it was laid: never laid');
  const later = createCosmeticLayers();
  later.setRoom(doc);
  assert.equal(later.room, doc, 'loaded now: laid at once');
});
