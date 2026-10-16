// test/render/vfx-hits.test.js — the official effects' hit paths fixed after the 0.3.0 effects audit (round 46, DESIGN
// §33.12 / history §32.14.41) through render/vfx/wiring.js on a synthetic index: an official shot covers the damage the
// sim lands before its drawn flight ends (R3) and the heal the sim lands at the attack (R9), a damage long before the
// arrival stays the procedural one's; a direct ranged attack with official rows draws no procedural shot, one with none
// keeps it (R4); a projectile attack's own hit rows play with its hit, a timer projectile's too (R12); a chain's bounces
// draw the line of the shot that opened the chain and its hit (R14); a 领主's ranged-kind 'atk' on the enemy it blocks
// is its Combat blow (R15); a sim-melee attack whose official ability shoots flies its projectile for show (R16).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring, CHAIN_LINE_S } from '../../public/js/render/vfx/wiring.js';

const BLOCKED = 1;
const row = (k, o = {}) => ({ effects: [k], directionType: 0, oneshot: 1, startEvent: 4, endEvent: 3, ...o });
const KEYS = ['shot_trail', 'shot_hit', 'rows_trail', 'rows_hit', 'timer_hit', 'dir_cast', 'dir_hit', 'heal_trail', 'healer_hit', 'chain_trail',
  'chain_line', 'chain_hit', 'lord_trail', 'lord_hit', 'lord_cast', 'lord_combat_cast', 'lord_combat_hit', 'sky_cast', 'sky_trail', 'sky_hit', 'g_hit', 'g_enemy', 'g_heal'];

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: k === 'chain_line' }]));
  const unit = (modes) => ({ kind: 'char', modes, skills: {}, startEffect: null, deadEffect: null });
  const ranged = (projectileKey, hit = [], cast = []) => ({ class: 'RangedAttack', projectileKey, cast, hit });
  return {
    format: 'fx-index', version: 3,
    units: {
      char_700_shot: unit([{ name: 'Default', attack: ranged('proj_shot') }]),
      // a projectile with no onHit of its own and the attack's hit row (能天使 S2/S3, 烛煌 S3); a timer projectile (录武官)
      char_701_rows: unit([{ name: 'Default', attack: ranged('proj_rows', [row('rows_hit')]) }]),
      char_708_timer: unit([{ name: 'Default', attack: { class: 'RangedHeal', projectileKey: 'proj_timer', cast: [], hit: [row('timer_hit')] } }]),
      // a direct ranged attack: rows, no projectile (能天使's MeleeAttack the sim shoots as an arrow); one with nothing
      char_702_direct: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [row('dir_cast')], hit: [row('dir_hit')] } }]),
      char_703_bare: unit([{ name: 'Default', attack: { class: 'RangedAttack', cast: [], hit: [] } }]),
      char_709_lost: unit([{ name: 'Default', attack: ranged('proj_not_extracted', [], [row('dir_cast')]) }]),
      char_704_heal: unit([{ name: 'Default', attack: { class: 'RangedHeal', projectileKey: 'proj_heal', cast: [], hit: [] } }]),
      char_705_chain: unit([{ name: 'Default', attack: ranged('proj_chain') }]),
      // a 领主: a ranged Attack and a melee Combat
      char_706_lord: unit([{ name: 'Default', attack: ranged('proj_lord', [], [row('lord_cast')]), combat: { class: 'MeleeAttack', cast: [row('lord_combat_cast')], hit: [row('lord_combat_hit')] } }]),
      // 蒂比: a RangedAttack the sim makes melee
      char_707_sky: unit([{ name: 'Default', attack: ranged('proj_sky', [], [row('sky_cast')]) }]),
      enemy_800_foe: { kind: 'enemy', modes: [{ name: 'Default', attack: ranged('proj_sky'), combat: null }], skills: {}, startEffect: null, deadEffect: null },
    },
    skills: {},
    projectiles: {
      proj_shot: { main: 'shot_trail', onHit: ['shot_hit'], effects: ['shot_trail', 'shot_hit'] },
      proj_rows: { main: 'rows_trail', effects: ['rows_trail'] },
      proj_timer: { main: null, lifeTime: 10, effects: [] },
      proj_heal: { main: 'heal_trail', onHit: ['healer_hit'], effects: ['heal_trail', 'healer_hit'] },
      proj_chain: { main: 'chain_line', onHit: ['chain_hit'], effects: ['chain_trail', 'chain_line', 'chain_hit'], behaviours: [
        { class: 'SimpleProjectile', fields: { _mainEffect: 'chain_trail', _lifeTimeType: 0 } },
        { class: 'ChainLightningEffectBehaviour', fields: { _mainEffect: 'chain_line', _playEffectOnHitPoint: 0 } },
      ] },
      proj_lord: { main: 'lord_trail', onHit: ['lord_hit'], effects: ['lord_trail', 'lord_hit'] },
      proj_sky: { main: 'sky_trail', onHit: ['sky_hit'], effects: ['sky_trail', 'sky_hit'], movement: { class: 'AdvancedMovement', speed: 10 } },
    },
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: {}, birth: {}, status: {} },
    prefabs,
  };
}

async function setup() {
  const index = makeIndex();
  const spawned = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [],
    lib: { has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 2 } : null), index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const h = { key, place, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: () => null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, y = 10, o = {}) => {
    const enemy = /^enemy_/.test(key) || o.enemy;
    const v = { id, x, y, z: 0, visFacing: enemy ? -1 : 1, isEnemy: !!enemy, alive: true, flags: o.flags || 0, anim: 0, sp: 0, spMax: 0, energy: null,
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: 0 } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  /** Fly the flight of `key` (its spawned handle's track) to the end. */
  const land = (key) => {
    const h = handles.find((x) => x.key === key && !x.landed);
    assert.ok(h && h.opts.track, `${key} flies`);
    h.landed = true;
    const fx = { time: 5, anchor: [0, 0, 0], yaw: 0, pitch: 0, mirror: false, stop() { this.stopped = true; } };
    h.opts.track(fx);
    return fx;
  };
  return { w, ofx, spawned, handles, view, frame, land };
}

const count = (list, k) => list.filter((x) => x === k).length;

describe('official hits after the effects audit (round 46)', () => {
  test('R3: the damage the sim lands just before the drawn flight ends is the shot\'s; one long before the arrival is not', async () => {
    const { w, spawned, view, frame, land } = await setup();
    const a = view(1, 'char_700_shot', 5), t = view(2, 'enemy_800_foe', 8);   // 3 tiles at 10 tiles/s: 0.3 s
    frame();
    assert.equal(w.attack(a, t, 'arrow', 1), true);
    frame();
    assert.equal(w.damage(t, 'phys', null, 1.03), false, 'a hit (a 灼燃 tick) 0.03 s after the shot left is not the shot\'s: procedural');
    for (let i = 0; i < 6; i++) frame();   // 0.23 s: inside CLAIM_LEAD of the arrival
    assert.equal(w.damage(t, 'phys', null, 1.25), true, 'the shot\'s damage a tick before it lands: official (no spark)');
    assert.equal(w.damage(t, 'arts', null, 1.25), true, 'another hit of the same frame too');
    assert.equal(w.damage(t, 'phys', null, 1.28), false, 'a later frame\'s damage is no hit of the shot');
    assert.ok(!spawned.includes('shot_hit'));
    land('shot_trail');
    assert.equal(count(spawned, 'shot_hit'), 1, 'its onHit plays when the drawn flight ends');
  });

  test('R9: a heal the sim lands at the attack is covered by the heal projectile on its way (no generic heal hit)', async () => {
    const { w, spawned, view, frame, land } = await setup();
    const h = view(1, 'char_704_heal', 5), p = view(2, 'char_700_shot', 7);
    frame();
    assert.equal(w.attack(h, p, 'orb', 1), true);
    assert.equal(w.heal(p, 1), true, 'covered');
    assert.ok(!spawned.includes('g_heal'), 'no generic heal hit before the healer\'s own');
    land('heal_trail');
    assert.equal(count(spawned, 'healer_hit'), 1);
    // without an official projectile on its way the generic heal hit stays
    frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame();
    assert.equal(w.heal(p, 2), true);
    assert.equal(count(spawned, 'g_heal'), 1);
  });

  test('R4: a direct ranged attack with official rows draws no procedural shot; one with none keeps it', async () => {
    const { w, spawned, view, frame } = await setup();
    const a = view(1, 'char_702_direct', 5), b = view(3, 'char_703_bare', 5, 12), t = view(2, 'enemy_800_foe', 8);
    frame();
    assert.equal(w.attack(a, t, 'arrow', 1), true, 'its cast and hit are the attack');
    assert.ok(spawned.includes('dir_cast'));
    for (let i = 0; i < 6; i++) frame();
    w.damage(t, 'phys', null, 1.2);
    assert.equal(count(spawned, 'dir_hit'), 1, 'its hit plays on the damage the sim lands after its own flight (past the melee window)');
    assert.equal(w.attack(b, t, 'arrow', 2), false, 'nothing official to draw: the procedural shot');
    const g = view(4, 'char_709_lost', 5, 14);
    frame();
    assert.equal(w.attack(g, t, 'arrow', 3), false, 'a projectile missing from the index: the procedural shot, its cast drawn');
    assert.ok(spawned.includes('dir_cast'));
  });

  test('R12: a projectile attack\'s own hit rows play with its hit (a projectile without onHit, a timer projectile)', async () => {
    const { w, spawned, view, frame, land } = await setup();
    const a = view(1, 'char_701_rows', 5), t = view(2, 'enemy_800_foe', 8);
    frame();
    w.attack(a, t, 'arrow', 1);
    assert.ok(!spawned.includes('rows_hit'));
    land('rows_trail');
    assert.equal(count(spawned, 'rows_hit'), 1);
    const m = view(3, 'char_708_timer', 5, 12), p = view(4, 'char_700_shot', 7, 12);
    frame();
    w.attack(m, p, 'orb', 2);
    assert.equal(w.heal(p, 2), true, 'its heal is covered meanwhile');
    assert.ok(!spawned.includes('g_heal') && !spawned.includes('timer_hit'));
    for (let i = 0; i < 8; i++) frame();   // 2 tiles at 10 tiles/s
    assert.equal(count(spawned, 'timer_hit'), 1, 'the timer\'s hit with the row, on the effects\' clock');
  });

  test('R14: a chain\'s bounces draw the line of the official shot that opened it and its hit; another chain stays procedural', async () => {
    const { w, ofx, spawned, handles, view, frame } = await setup();
    const c = view(1, 'char_705_chain', 5), t1 = view(2, 'enemy_800_foe', 8), t2 = view(3, 'enemy_800_foe', 9), t3 = view(4, 'enemy_800_foe', 9, 11);
    frame();
    w.attack(c, t1, 'bolt', 1);
    assert.ok(spawned.includes('chain_trail'), 'the shot flies its own flying effect, not the line');
    for (let i = 0; i < 7; i++) frame();   // a tick before the 0.3 s flight ends: the sim's hit and its bounces
    assert.equal(w.damage(t1, 'phys', null, 1.25), true);
    assert.equal(w.chain(t1, t2, 'chain', 1.25), true);
    assert.equal(w.damage(t2, 'phys', null, 1.25), true, 'the bounce\'s damage is covered');
    assert.equal(w.chain(t2, t3, 'chain', 1.25), true, 'the next bounce leaves from the last target');
    assert.equal(w.damage(t3, 'phys', null, 1.25), true);
    assert.ok(!spawned.includes('chain_line'), 'drawn when the shot reaches its first target');
    frame(); frame(); frame();
    assert.equal(count(spawned, 'chain_line'), 2);
    assert.equal(count(spawned, 'chain_hit'), 2, 'the projectile\'s hit on each bounce target');
    const line = handles.find((h) => h.key === 'chain_line');
    const fx = { anchor: [0, 0, 0], ends: null, linkLines(a, b) { this.ends = [a.slice(), b.slice()]; return this; } };
    line.opts.track(fx);
    assert.ok(fx.ends && fx.ends[0][0] !== fx.ends[1][0], 'the line runs from the previous target to the next');
    const t0 = ofx.time;
    while (ofx.time - t0 < CHAIN_LINE_S + 0.05) frame();
    assert.ok(line.stopped, 'the looping line stops');
    const x = view(5, 'enemy_800_foe', 3), y = view(6, 'enemy_800_foe', 4);
    assert.equal(w.chain(x, y, 'chain', 2), false, 'no official shot opened this chain: the procedural arc');
  });

  test('R15: a 领主\'s ranged-kind attack on the enemy it blocks is its Combat blow; on another enemy its shot', async () => {
    const { w, spawned, view, frame } = await setup();
    const l = view(1, 'char_706_lord', 7, 9, { flags: BLOCKED }), e = view(2, 'enemy_800_foe', 7.45, 9, { flags: BLOCKED });
    const far = view(3, 'enemy_800_foe', 9, 9, { flags: BLOCKED });
    frame();
    assert.equal(w.attack(l, e, 'arrow', 1), true);
    assert.ok(spawned.includes('lord_combat_cast') && !spawned.includes('lord_trail') && !spawned.includes('lord_cast'), 'the Combat cast, no shot');
    w.damage(e, 'phys', l, 1.03);
    assert.equal(count(spawned, 'lord_combat_hit'), 1, 'the Combat hit on its damage');
    frame();
    w.attack(l, far, 'arrow', 2);
    assert.ok(spawned.includes('lord_trail') && spawned.includes('lord_cast'), 'an enemy it does not block: the ranged attack');
    const free = view(4, 'char_706_lord', 7, 12), e2 = view(5, 'enemy_800_foe', 7.3, 12, { flags: BLOCKED });
    frame();
    w.attack(free, e2, 'arrow', 3);
    assert.equal(count(spawned, 'lord_trail'), 2, 'not blocking anything: its shot');
  });

  test('R16: a sim-melee attack whose official ability shoots flies the projectile for show; its damage covered until the hit', async () => {
    const { w, spawned, view, frame, land } = await setup();
    const s = view(1, 'char_707_sky', 5), e = view(2, 'enemy_800_foe', 6);
    frame();
    assert.equal(w.attack(s, e, 'none', 1), true);
    assert.ok(spawned.includes('sky_cast') && spawned.includes('sky_trail'));
    assert.equal(w.damage(e, 'phys', s, 1), true, 'the blow\'s damage (the sim lands it at once): covered');
    assert.ok(!spawned.includes('g_hit'), 'no generic hit');
    land('sky_trail');
    assert.equal(count(spawned, 'sky_hit'), 1);
    // an enemy with the same data keeps the melee path (only units of the player's side fly for show)
    const en = view(3, 'enemy_800_foe', 8), op = view(4, 'char_700_shot', 7);
    frame();
    w.attack(en, op, 'none', 2);
    assert.equal(count(spawned, 'sky_trail'), 1);
  });
});
