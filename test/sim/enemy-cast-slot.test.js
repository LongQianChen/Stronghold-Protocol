// test/sim/enemy-cast-slot.test.js — the display-only enemy skill event ['cast', id, slot, dur?] (server/sim/content/
// enemies/helpers.js castSlot, DESIGN §8.2 / SIM.md; the client's skill clip and official skill effects, 0.3.0 Phase
// 3d): an enemy using a skill names its slot in its data record's skills[] — a multi-skill leader each of its own, a
// cooldown skill as it fires (with the blackboard duration), an SP skill on the attack it makes, before that attack's
// 'atk' —, and the event changes nothing else: the battle with it is the battle without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));
const OPS = [{ uid: 1, chessId: 'chess_char_1_02_a', row: 9, col: 5, dir: 'RIGHT' }, { uid: 2, chessId: 'chess_char_2_02_a', row: 10, col: 4, dir: 'RIGHT' }];
const tough = (key) => ({ ...EN[key], stats: { ...EN[key].stats, maxHp: 1e8 } });

function run(key, seconds, opts = {}) {
  const h = makeBattle({ timeLimit: 600, autoFinish: false, seed: 3, flags: { dpPerSec: 0, dpMax: 999 }, units: OPS,
    enemies: [{ key, pos: [9, 8] }], defs: { enemies: { [key]: tough(key) } }, ...opts });
  h.run(seconds);
  return h;
}

test("a multi-skill leader (鼠王 enemy_1509_mousek) names each skill's slot: DriftSand 0, SandStorm 1 (its duration with it)", () => {
  const h = run('enemy_1509_mousek', 75);   // (SandStorm's initial cooldown is 60 s)
  const e = h.enemy('enemy_1509_mousek');
  const casts = h.events.filter((ev) => ev[0] === 'cast' && ev[1] === e.id);
  const slots = new Set(casts.map((ev) => ev[2]));
  const sk = EN.enemy_1509_mousek.skills;
  assert.equal(sk[0].prefabKey, 'DriftSand');
  assert.equal(sk[1].prefabKey, 'SandStorm');
  assert.ok(slots.has(0) && slots.has(1), `slots ${[...slots]}`);
  for (const ev of casts.filter((x) => x[2] === 1)) assert.equal(ev[3], sk[1].bb.duration, "SandStorm's duration");
  for (const ev of casts) assert.ok(Number.isInteger(ev[2]) && ev[2] >= 0 && ev[2] < sk.length);
});

test("an SP skill (粉碎攻坚手 enemy_1045_hammer stuncombat, spCost 2): the cast comes with every third attack, before its 'atk'", () => {
  const h = run('enemy_1045_hammer', 40);
  const e = h.enemy('enemy_1045_hammer');
  const mine = h.events.filter((ev) => (ev[0] === 'cast' || ev[0] === 'atk') && ev[1] === e.id);
  const atks = mine.filter((ev) => ev[0] === 'atk').length;
  const casts = mine.filter((ev) => ev[0] === 'cast');
  assert.ok(atks >= 3, `attacks ${atks}`);
  assert.equal(casts.length, Math.floor(atks / 3));
  for (let i = 0; i < mine.length; i++) if (mine[i][0] === 'cast') assert.equal(mine[i + 1]?.[0], 'atk', 'the skill attack follows');
  assert.ok(casts.every((ev) => ev[2] === 0));
});

test('display only: the same battle without the event (its kits never cast) ends in the same state', () => {
  const a = run('enemy_1509_mousek', 45);
  const b = run('enemy_1509_mousek', 45);
  assert.deepEqual(a.events, b.events, 'deterministic');
  const strip = (h) => JSON.stringify(h.snapshot());
  // a battle that records no events reaches the same snapshot (the event is the only difference castSlot makes)
  const quiet = run('enemy_1509_mousek', 45, { recordEvents: false });
  assert.equal(strip(quiet), strip(a));
});
