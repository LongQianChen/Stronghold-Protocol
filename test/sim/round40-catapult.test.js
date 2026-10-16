// Round 40 — 自制投石机 (enemy_10162_mnctpt). PRTS 天赋: three physical attacks, splash radius 1.5, hit_interval 0.3.
// Each stone is its own damage instance (DEF, shields, 坚守 thorns). 入戏(敌方) is an unused inPlay flag: random aim
// in the side-6 square, splash projectile_range 0.5, no forced hit on the main target.
// Run: node --test test/sim/round40-catapult.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getData } from '../../server/data.js';

const KEY = 'enemy_10162_mnctpt';

function piece(id, stats = {}) {
  return chessRec({ id, skill: null, stats: { maxHp: 1e6, atk: 0, def: 0, res: 0, blockCnt: 0, tauntLevel: 0, ...stats } });
}

function field(specs, { seed = 1, enemies = null, inPlay = false, pos = [10, 8] } = {}) {
  const chess = {};
  const units = [];
  for (const s of specs) {
    chess[s.id] = piece(s.id, s.stats);
    units.push({ uid: s.uid, chessId: s.id, row: s.row, col: s.col });
  }
  const h = makeBattle({
    seed, autoFinish: false, timeLimit: 40, hooks: ['damaged'], captureNoisy: true,
    defs: { chess, ...(enemies ? { enemies } : {}) }, units,
  });
  h.step();
  const e = h.spawn(KEY, { pos, mods: { speedMul: 0 } });
  if (inPlay) h.b.addBuff(e, { key: 'inPlay', persist: true, flags: { inPlay: true } });
  return { h, e };
}

const loss = (u) => u.s.maxHp - u.hp;
const stonesOn = (h, e, u) => h.hooksOf('damaged').filter((c) => c.source === e && c.target === u && c.dmg && c.dmg.isAttack);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0); };

test('three physical stones land 0.3 s apart; DEF and a one-hit shield each apply per stone; splash is 1.5', () => {
  const { h, e } = field([
    { uid: 1, id: 'pri', row: 10, col: 5, stats: { def: 400, tauntLevel: 5 } },
    { uid: 2, id: 'near', row: 10, col: 6 },
    { uid: 3, id: 'diag', row: 11, col: 6 },
    { uid: 4, id: 'out', row: 12, col: 7 },
  ]);
  const pri = h.unit(1), near = h.unit(2);
  const atk = e.s.atk;
  const one = Math.max(atk - 400, atk * 0.05);
  assert.equal(one, atk - 400, 'DEF does not hit the 5% floor');
  assert.ok(h.runUntil(() => loss(pri) > 0, 15), 'the first stone');
  assert.equal(loss(pri), one, 'the first stone is mitigated on its own');
  assert.equal(loss(near), atk, 'splash of stone 0 is the same tick, and the neighbour has no DEF');
  h.run(0.7);
  assert.equal(loss(pri), one * 3);
  assert.equal(loss(near), atk * 3);
  assert.equal(loss(h.unit(3)), atk * 3, 'diagonal within 1.5');
  assert.equal(loss(h.unit(4)), 0, 'outside 1.5');
  const ts = stonesOn(h, e, pri).map((c) => c.t);
  assert.equal(ts.length, 3);
  assert.ok(Math.abs(ts[1] - ts[0] - 0.3) < 1e-9, `gap ${ts[1] - ts[0]}`);
  assert.ok(Math.abs(ts[2] - ts[1] - 0.3) < 1e-9, `gap ${ts[2] - ts[1]}`);
  done(h);

  const s = field([{ uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } }]);
  s.h.b.addBuff(s.h.unit(1), { key: 'test:shield', shield: s.e.s.atk, persist: true });
  assert.ok(s.h.runUntil(() => s.e.stats.attacks >= 1, 15));
  s.h.run(0.7);
  assert.equal(loss(s.h.unit(1)), s.e.s.atk * 2, 'a shield equal to one hit absorbs one stone');
  done(s.h);
});

test('losing the target after stone 1 does not cancel the volley; killing the catapult does not either', () => {
  const a = field([
    { uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } },
    { uid: 2, id: 'near', row: 10, col: 6 },
  ]);
  assert.ok(a.h.runUntil(() => loss(a.h.unit(1)) > 0, 15));
  a.h.b.addBuff(a.h.unit(1), { key: 'test:hide', persist: true, flags: { stealth: true } });
  a.h.run(0.7);
  assert.equal(loss(a.h.unit(1)), a.e.s.atk, 'a hidden primary is not force-hit by the later stones');
  assert.equal(loss(a.h.unit(2)), a.e.s.atk * 3, 'the neighbour is still splashed');
  done(a.h);

  const b = field([
    { uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } },
    { uid: 2, id: 'near', row: 10, col: 6 },
  ]);
  assert.ok(b.h.runUntil(() => loss(b.h.unit(2)) > 0, 15));
  assert.equal(loss(b.h.unit(2)), b.e.s.atk);
  b.h.b.kill(b.e, null);
  b.h.run(0.7);
  assert.equal(b.e.alive, false);
  assert.equal(loss(b.h.unit(2)), b.e.s.atk * 3, 'stones 2 and 3 were already scheduled');
  done(b.h);
});

test('坚守 thorns once per stone (cd 0.2 s, stones 0.3 s apart)', () => {
  const op = (id, taunt) => chessRec({
    id, bonds: ['steadShip'], skill: null,
    stats: { maxHp: 1e6, atk: 0, def: 0, blockCnt: 0, tauntLevel: taunt },
  });
  const h = makeBattle({
    autoFinish: false, timeLimit: 40, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { a: op('a', 5), b: op('b', 0), c: op('c', 0) } },
    bonds: { steadShip: { count: 3, active: true, tier: 2, layers: 10 } },
    units: [
      { uid: 1, chessId: 'a', row: 10, col: 5 },
      { uid: 2, chessId: 'b', row: 12, col: 2 },
      { uid: 3, chessId: 'c', row: 12, col: 3 },
    ],
  });
  h.step();
  const e = h.spawn(KEY, { pos: [10, 8], mods: { speedMul: 0 } });
  assert.ok(h.runUntil(() => loss(h.unit(1)) > 0, 15));
  h.run(0.7);
  const arts = h.hooksOf('damaged').filter((c) => c.target === e && c.type === 'arts');
  assert.equal(arts.length, 3, 'one thorn per stone, not one per volley');
  assert.ok(Math.abs(arts[1].t - arts[0].t - 0.3) < 1e-9);
  assert.ok(Math.abs(arts[2].t - arts[1].t - 0.3) < 1e-9);
  assert.equal(loss(h.unit(2)), 0);
  assert.equal(loss(h.unit(3)), 0);
  done(h);
});

test('入戏 aims inside the side-6 square at radius 0.5 and does not force the main target; the flag is unused', () => {
  const src = getData().enemies[KEY];
  assert.equal(src.talents.bb['Attack.attack@projectile_range'], 0.5);
  assert.equal(src.talents.bb['Attack.attack@offset_bound'], 3);
  const plain = field([{ uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } }]);
  assert.equal(plain.e.s.flags.inPlay, undefined);
  assert.equal(plain.e.buffs.some((b) => b.key === 'inPlay' || b.flags?.inPlay), false);

  const zeroed = structuredClone(src);
  zeroed.talents.bb['Attack.attack@offset_bound'] = 0;
  const z = field([
    { uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } },
    { uid: 2, id: 'near', row: 10, col: 6 },
  ], { enemies: { [KEY]: zeroed }, inPlay: true });
  assert.ok(z.h.runUntil(() => z.e.stats.attacks >= 1, 15));
  z.h.run(0.7);
  assert.equal(loss(z.h.unit(1)), z.e.s.atk * 3, 'bound 0 splashes on the target');
  assert.equal(loss(z.h.unit(2)), 0, 'radius 0.5 does not reach the next tile');
  done(z.h);

  const cluster = [
    { uid: 1, id: 'pri', row: 10, col: 5, stats: { tauntLevel: 5 } },
    { uid: 2, id: 'u2', row: 9, col: 4 }, { uid: 3, id: 'u3', row: 9, col: 5 },
    { uid: 4, id: 'u4', row: 9, col: 6 }, { uid: 5, id: 'u5', row: 10, col: 4 },
    { uid: 6, id: 'u6', row: 10, col: 6 }, { uid: 7, id: 'u7', row: 11, col: 4 },
    { uid: 8, id: 'u8', row: 11, col: 5 }, { uid: 9, id: 'u9', row: 11, col: 6 },
    { uid: 10, id: 'u10', row: 12, col: 5 }, { uid: 11, id: 'u11', row: 10, col: 7 },
    { uid: 12, id: 'far', row: 10, col: 9 },
  ];
  let primaryHits = 0, clusterHits = 0, farHits = 0;
  const sig = (seed) => {
    const { h, e } = field(cluster, { seed, inPlay: true });
    assert.ok(h.runUntil(() => e.stats.attacks >= 1, 15));
    h.run(0.7);
    const atk = e.s.atk;
    const got = [];
    for (const u of h.allies()) {
      const n = loss(u);
      assert.equal(n % atk, 0);
      got.push(n);
      if (u.uid === 12) farHits += n;
      else clusterHits += n;
      if (u.uid === 1) primaryHits += n / atk;
    }
    done(h);
    return got.join(',');
  };
  const a = sig(4), b = sig(4);
  assert.equal(a, b, 'the same seed aims the same stones');
  for (let seed = 1; seed <= 16; seed++) if (seed !== 4) sig(seed);
  assert.equal(farHits, 0, 'four tiles out is past ±3 plus the 0.5 radius');
  assert.ok(primaryHits < 17 * 3, 'the main target is not force-hit by every stone');
  assert.ok(clusterHits > 0, 'a stone still lands inside the square');
});
