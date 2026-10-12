// Damage-number rendering: the default path still pops every hit; official mode shows only a marked red integer
// or a yellow MISS, and does not merge those into the typed running totals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake?.restore());

const cam = presetCamera('normal', { width: 1600, height: 900 });

function unit(id, x, y) {
  return { id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, maxHp: 3000, info: { defId: 'char_x' }, onHit() {} };
}

function makeFx(views) {
  const map = new Map(views.map((v) => [v.id, v]));
  const settings = { quality: 'high', damageNumbers: true, officialDamageNumbers: false };
  const fx = new FX.FxSystem({
    ...fakeViewCtx(fake.P), settings, cam: () => cam, heightAt: () => 0, timeScale: () => 2,
    loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, settings };
}

test('official mode hides ordinary hits and heals, and draws a marked red number without merging', () => {
  const v = unit(1, 4, 9);
  const { fx, settings } = makeFx([v]);
  fx.damage(v, 40, 'phys', null);
  fx.damage(v, 60, 'phys', null);
  assert.equal(fx.nums.length, 1, 'default mode still merges same-style hits');
  assert.equal(fx.nums[0].style, 'phys');
  assert.equal(fx.nums[0].value, 100);
  assert.equal(fx.nums[0].text.text, '100');

  fx.heal(v, 15);
  assert.ok(fx.nums.some((n) => n.style === 'heal' && n.text.text === '+15'));

  for (const n of fx.nums.splice(0)) fx._releaseNum(n);
  settings.officialDamageNumbers = true;
  fx.damage(v, 40, 'phys', null);
  fx.heal(v, 15);
  assert.equal(fx.nums.length, 0, 'an unmarked hit and a heal draw no digits');
  fx.damage(v, 40, 'phys', null, 'r');
  fx.damage(v, 25, 'true', null, 'r');
  assert.equal(fx.nums.length, 2, 'official reds are separate popups');
  assert.deepEqual(fx.nums.map((n) => n.text.text), ['40', '25']);
  assert.ok(fx.nums.every((n) => n.style === 'crit'));

  fx.damage(v, 0, 'phys', null, 'r');
  assert.equal(fx.nums.at(-1).text.text, '0');
  assert.equal(fx.nums.at(-1).style, 'crit');

  settings.damageNumbers = false;
  const held = fx.nums.length;
  fx.damage(v, 90, 'phys', null, 'r');
  fx.simFx('dodge', v.x, v.y, { id: v.id, num: 'm' });
  assert.equal(fx.nums.length, held, 'turning damage numbers off hides official digits too');
});

test('a dodge marked num:m shows MISS only while official numbers are on', () => {
  const v = unit(3, 6, 10);
  const { fx, settings } = makeFx([v]);
  fx.simFx('dodge', v.x, v.y, { id: v.id, num: 'm' });
  assert.equal(fx.nums.filter((n) => n.style === 'miss').length, 0);
  settings.officialDamageNumbers = true;
  fx.simFx('dodge', v.x, v.y, { id: v.id });
  assert.equal(fx.nums.filter((n) => n.style === 'miss').length, 0);
  fx.simFx('dodge', v.x, v.y, { id: v.id, num: 'm' });
  const miss = fx.nums.filter((n) => n.style === 'miss');
  assert.equal(miss.length, 1);
  assert.equal(miss[0].text.text, 'MISS');
});
