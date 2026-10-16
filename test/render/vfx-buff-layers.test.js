// test/render/vfx-buff-layers.test.js — the buff-state effects of the 0.3.0 official-effects audit (round 46, R2 / R6 /
// R17; DESIGN §33.11 / §33.16): PauseAnotherEffect (effect.js def.pauses, system.js pausing an owner's effects), the
// per-layer loops of a talent shown by the sim's hit-negating layers (b.snap `layers`, talentfx.js), the `[eff_cond]`
// state loops of a charge skill (skills.js COND_BUFFS, b.snap `charges`, skillfx.js), 泡泡 S2's counter bound to its
// official hit on the attacker (FX_BINDINGS), and the two display-only snapshot readouts (sim snapshot.js, interp.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { skillPlan, condState, COND_BUFFS, FX_BINDINGS, bindingEffects, planKeys } from '../../public/js/render/vfx/skills.js';
import { layerView, chargeView } from '../../server/sim/snapshot.js';
import { normalizeSnapshot, SnapshotBuffer } from '../../public/js/render/interp.js';

const SKILL = 16;

/** A prefab descriptor whose root carries the given behaviours. */
const desc = (key, behaviours = []) => ({ key, nodes: [{ id: 0, name: key, parent: null, children: [], active: true, behaviours }] });
const pauseB = (effect, preDelay = 0) => ({ class: 'PauseAnotherEffect', enabled: true, fields: { _effect: effect, _preDelay: preDelay, _checkUpdate: 1 } });

describe('PauseAnotherEffect (effect.js, system.js)', () => {
  test('the descriptor keeps the keys it pauses (lower case) and their pre-delay', () => {
    const def = compileEffect(desc('lay_01', [pauseB('LAY_02'), pauseB('lay_03', 0.2)]));
    assert.deepEqual(def.pauses, [{ key: 'lay_02', delay: 0 }, { key: 'lay_03', delay: 0.2 }]);
    assert.deepEqual(compileEffect(desc('plain')).pauses, []);
  });

  test("an effect playing on an owner pauses that owner's effects of the named key after its pre-delay, until it stops", () => {
    const fx = (key, owner, pauses = [], time = 1) => ({ def: { key, pauses }, owner, state: 'play', time, pausedBy: false });
    const A = {}, B = {};
    const top = fx('lay_01', A, [{ key: 'lay_02', delay: 0 }, { key: 'lay_03', delay: 0 }]);
    const mid = fx('lay_02', A, [{ key: 'lay_03', delay: 0 }]);
    const low = fx('lay_03', A);
    const other = fx('lay_03', B);
    const late = fx('aura', A);
    const waits = fx('range', A, [{ key: 'aura', delay: 0.2 }], 0.1);
    const sys = { effects: [top, mid, low, other, late, waits] };
    OfficialFx.prototype._pauseOthers.call(sys);
    assert.deepEqual(sys.effects.map((f) => f.pausedBy), [false, true, true, false, false, false], 'the top shows; another owner is untouched; the pre-delay has not passed');
    waits.time = 0.3;
    top.state = 'stopping';
    OfficialFx.prototype._pauseOthers.call(sys);
    assert.deepEqual(sys.effects.map((f) => f.pausedBy), [false, false, true, false, true, false], 'the stopped top no longer pauses: the middle shows');
  });

  test('a paused effect draws nothing (Effect.gather returns before reading its nodes)', () => {
    const fx = new Effect(compileEffect(desc('plain')), {});
    const trap = new Proxy({}, { get() { throw new Error('read'); } });
    fx.pausedBy = true;
    fx.hier = trap;
    assert.doesNotThrow(() => fx.gather({ pos: [0, 0, 0] }, () => {}));
    fx.pausedBy = false;
    assert.throws(() => fx.gather({ pos: [0, 0, 0] }, () => {}), /read/);
  });
});

// ---- the synthetic index ------------------------------------------------------------------------------------------

const LAYERS = ['lay_01', 'lay_02', 'lay_03'];
const COND_KEYS = ['billro_skill_01_buff_01', 'billro_skill_01_buff_01_02', 'billro_skill_01_buff_02'];
const LOOPING = new Set([...LAYERS, ...COND_KEYS, 'bar_01', 'bar_02']);
const KEYS = [...LOOPING, 'lay_begin', 'bubble_skill_02_hit', 'g_hit', 'g_die', 'g_birth'];
const PAUSES = { lay_01: ['lay_02', 'lay_03'], lay_02: ['lay_03'], bar_01: ['bar_02'] };

const tuse = (role, key, o = {}) => ({ role, keys: [key], from: 'PassiveBuffAbility._buffs → template t_1[init]', node: 'Talents/1', on: 'owner', life: { type: 'IMMEDIATELY' }, ...o });
const effCond = (key) => ({ role: 'loop', keys: [key], from: 'PassiveBuffAbility._buffs → template billro_s_1[eff_cond]', event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', on: 'owner', buff: 'billro_s_1[eff_cond]', life: { type: 'INFINITY', tick: 0.1 } });
const melee = () => ({ class: 'MeleeAttack', cast: [], hit: [] });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  return {
    format: 'fx-index', version: 3,
    units: {
      // 泥岩's shape: the [init] buff's start creates a buff per layer (ON_BUFF_START CreateBuff), the begin effect once
      char_900_lay: { kind: 'char', skills: {}, talentKeys: { base: { 0: ['1'] } }, modes: [{ name: 'Default', attack: melee() }],
        talents: { 1: { nodes: [{ node: 'Talents/1', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }],
          uses: [tuse('start', 'lay_begin', { event: 'ON_BUFF_START', action: 'CreateEffect' }),
            ...['lay_01', 'lay_03', 'lay_02', 'lay_02', 'lay_01'].map((k) => tuse('loop', k, { event: 'ON_BUFF_START', action: 'CreateBuff' }))] } } },
      // an enemy barrier with two layer variants (鼠王's shape): the whole stack while it holds
      enemy_901_bar: { kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee() }],
        talents: { shield: { bb: 'shield', nodes: [{ node: 'Talents/shield', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }],
          uses: ['bar_01', 'bar_02'].map((k) => ({ role: 'loop', keys: [k], from: 'PassiveBuffAbility._buffs', node: 'Talents/shield', on: 'owner', buff: `s[${k}]`, event: 'ON_BUFF_START', action: 'CreateBuff', life: { type: 'INFINITY' } })) } } },
      // 卡涅利安's shape: the skill's [eff_cond] buffs (named after the real template so COND_BUFFS applies)
      char_902_cnd: { kind: 'char', modes: [{ name: 'Default', attack: melee() }], talentKeys: { base: {} },
        skills: { skchr_cnd_1: { rootClass: 'CastSkill', uses: ['billro_skill_01_buff_02', 'billro_skill_01_buff_01_02', 'billro_skill_01_buff_01_02', 'billro_skill_01_buff_02', 'billro_skill_01_buff_01_02', 'billro_skill_01_buff_01'].map(effCond) } } },
      // 泡泡's shape: S2 makes no attack, its counter hit is a blackboard effect (each.hit)
      char_903_bub: { kind: 'char', modes: [{ name: 'Default', attack: melee() }], talentKeys: { base: {} },
        skills: { skchr_bubble_2: { rootClass: 'CastSkill', uses: [{ role: 'hit', keys: ['bubble_skill_02_hit'], from: 'ActiveBuffAbility._buffs.blackboard', on: 'owner', buff: 'bubble_s_2[inverse]', bb: 'effect', by: 'name', life: { type: 'LIMITED' } }] } } },
      enemy_904_foe: { kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee() }] },
    },
    skills: {},
    projectiles: {},
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_hit', heal: 'g_hit' }, die: { char: 'g_die', enemy: 'g_die' }, birth: { char: 'g_birth' }, status: {} },
    prefabs,
  };
}

const RECS = {
  char_900_lay: { charId: 'char_900_lay', talents: [{ index: 0 }] },
  char_902_cnd: { charId: 'char_902_cnd', talents: [], skills: [{ index: 0, skillId: 'skchr_cnd_1', durationType: 'NONE', duration: 20 }] },
  char_903_bub: { charId: 'char_903_bub', talents: [], skills: [{ index: 0, skillId: 'skchr_bubble_2', durationType: 'NONE', duration: 30 }] },
  enemy_901_bar: { talents: { bb: {} }, skills: [] },
};

async function setup() {
  const index = makeIndex();
  const log = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [],
    lib: { has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { key: k, isLoop: index.prefabs[k].looping, spawn: 2, pauses: (PAUSES[k] || []).map((p) => ({ key: p, delay: 0 })) } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const h = { key, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      log.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x: 5, y: 5, z: 0, visFacing: 1, isEnemy: enemy, alive: true, flags: 0, anim: 0, hp: 100, maxHp: 100, layers: 0, charges: null,
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: o.skill ?? 0 }, ...o.v };
    views.set(id, v);
    return v;
  };
  const frame = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { w.sync(views.values()); w.tick(); ofx.time += dt; } };
  const live = (k) => handles.filter((h) => h.key === k && h.alive).length;
  const liveSet = (keys) => keys.filter((k) => live(k) > 0);
  return { w, ofx, log, handles, view, frame, live, liveSet, index };
}

describe("a talent's per-layer loops (talentfx.js, b.snap `layers`)", () => {
  test('an ally plays the lowest n of the stack for n layers (the top shows), none at 0; a layer gained plays the begin again', async () => {
    const { w, view, frame, liveSet, log, handles } = await setup();
    const v = view(1, 'char_900_lay');
    w.deploy(v); frame();
    assert.deepEqual(liveSet(LAYERS), [], '0 layers: nothing');
    assert.equal(log.filter((k) => k === 'lay_begin').length, 1, 'the binding turning on plays its begin once');
    v.layers = 1; frame();
    assert.deepEqual(liveSet(LAYERS), ['lay_03'], '1 layer: the bottom variant');
    assert.equal(log.filter((k) => k === 'lay_begin').length, 2, 'a layer gained: the begin again');
    v.layers = 3; frame();
    assert.deepEqual(liveSet(LAYERS), LAYERS, '3 layers: all three (system.js pauses _02 and _03 under _01)');
    v.layers = 2; frame();
    assert.deepEqual(liveSet(LAYERS), ['lay_02', 'lay_03'], 'a layer broken: the top stops');
    assert.equal(log.filter((k) => k === 'lay_begin').length, 3);
    v.layers = 0; frame();
    assert.deepEqual(liveSet(LAYERS), [], 'every layer broken');
    assert.ok(handles.filter((h) => LAYERS.includes(h.key)).every((h) => h.opts.owner === v), 'each layer effect names its owner (PauseAnotherEffect)');
  });

  test("an enemy's stack plays whole while its barrier holds, and stops when it breaks", async () => {
    const { w, view, frame, liveSet } = await setup();
    const e = view(2, 'enemy_901_bar');
    w.spawned(e); w.simFx('phase', 5, 5, { id: 2, kind: 'artsBarrier', value: 1000 }); frame();
    assert.deepEqual(liveSet(['bar_01', 'bar_02']), ['bar_01', 'bar_02']);
    w.simFx('shieldBreak', 5, 5, { id: 2 }); frame();
    assert.deepEqual(liveSet(['bar_01', 'bar_02']), []);
  });
});

describe('[eff_cond] state loops (skills.js COND_BUFFS, skillfx.js, b.snap `charges`)', () => {
  test('the plan keeps the [eff_cond] buffs as `cond` (not unmapped); the states follow the client graph', () => {
    const idx = makeIndex();
    const plan = skillPlan(idx, 'char_902_cnd', 'skchr_cnd_1');
    assert.equal(plan.cond.length, 6);
    assert.ok(!plan.unmapped.some((u) => u.reason === 'conditional'));
    assert.deepEqual(plan.loop, []);
    assert.ok(COND_KEYS.every((k) => planKeys(plan).includes(k)), 'preloaded');
    assert.equal(condState({ on: true, charged: true }), 'charged');
    assert.equal(condState({ on: true }), 'on');
    assert.equal(condState({ charges: [2, 2] }), 'full');
    assert.equal(condState({ charges: [1, 2] }), 'ready');
    assert.equal(condState({ charges: [0, 2] }), null);
    assert.equal(condState({}), null);
    for (const t of Object.values(COND_BUFFS)) for (const st of ['charged', 'on', 'full', 'ready']) assert.ok(t[st].length >= 1);
  });

  test('ready with 1 charge → the half armour, 2 → full + half, the skill on → its half, cast with every charge → full + half', async () => {
    const { w, view, frame, liveSet } = await setup();
    const v = view(3, 'char_902_cnd');
    w.deploy(v); frame();
    assert.deepEqual(liveSet(COND_KEYS), []);
    v.charges = [1, 2]; frame();
    assert.deepEqual(liveSet(COND_KEYS), ['billro_skill_01_buff_01']);
    v.charges = [2, 2]; frame();
    assert.deepEqual(liveSet(COND_KEYS), ['billro_skill_01_buff_01_02', 'billro_skill_01_buff_02']);
    // a charged cast: the kit's start fx says so
    v.charges = [1, 2]; v.flags = SKILL; w.skill(v, true); w.simFx('shell', 5, 5, { id: 3, charged: true }); frame();
    assert.deepEqual(liveSet(COND_KEYS), ['billro_skill_01_buff_01_02', 'billro_skill_01_buff_02']);
    w.skill(v, false); v.flags = 0; v.charges = [0, 2]; frame();
    assert.deepEqual(liveSet(COND_KEYS), []);
    // a plain cast
    v.flags = SKILL; w.skill(v, true); w.simFx('shell', 5, 5, { id: 3 }); frame();
    assert.deepEqual(liveSet(COND_KEYS), ['billro_skill_01_buff_01_02']);
    w.death(v); v.alive = false; frame();
    assert.deepEqual(liveSet(COND_KEYS), [], 'death stops them');
  });
});

describe("泡泡 S2's counter (FX_BINDINGS)", () => {
  test("the kit's 'counter' plays bubble_skill_02_hit once on the attacker it names, and the procedural fx is skipped", async () => {
    const { w, view, frame, handles } = await setup();
    assert.deepEqual(bindingEffects(null, FX_BINDINGS.skchr_bubble_2.counter), ['bubble_skill_02_hit']);
    const b = view(4, 'char_903_bub');
    const foe = view(5, 'enemy_904_foe', { v: { x: 6, y: 5 } });
    w.deploy(b); w.spawned(foe); frame();
    b.flags = SKILL; w.skill(b, true); frame();
    assert.equal(w.simFx('counter', 6, 5, { id: 4, target: 5 }), true);
    const h = handles.filter((x) => x.key === 'bubble_skill_02_hit');
    assert.equal(h.length, 1);
    assert.equal(h[0].opts.owner, foe, 'on the attacker');
    assert.equal(h[0].opts.loop, false);
  });
});

describe('display-only readouts (server/sim/snapshot.js, render/interp.js)', () => {
  test('layerView sums the hit-negating layers; chargeView gives an ally charge skill [stored, maximum]', () => {
    assert.equal(layerView({ buffs: [] }), null);
    assert.equal(layerView({ buffs: [{ shieldHits: 2 }, { shieldHits: 0 }, { shield: 100 }] }), 2);
    assert.deepEqual(chargeView({ side: 'ally', skill: { maxCharges: 2, charges: 1 } }), [1, 2]);
    assert.equal(chargeView({ side: 'ally', skill: { maxCharges: 1, charges: 1 } }), null);
    assert.equal(chargeView({ side: 'enemy', skill: { maxCharges: 2, charges: 1 } }), null);
  });

  test('interp keeps them per snapshot and hands them out with the older one', () => {
    const snap = { t: 1, units: [[1, 2, 3, 10, 10, 0, 0, 0, 0], [2, 4, 3, 10, 10, 0, 0, 0, 0]], layers: [[1, 3], [2, 0], [9, 1]], charges: [[1, 1, 2], [2, 3, 2]] };
    const n = normalizeSnapshot(snap);
    assert.deepEqual([...n.layers], [[1, 3]], 'a zero or an unknown unit is dropped');
    assert.deepEqual([...n.charges], [[1, [1, 2]]], 'more charges than the maximum is dropped');
    const buf = new SnapshotBuffer({ delay: 0 });
    buf.push(snap, 0);
    buf.push({ ...snap, t: 2, layers: [[1, 2]], charges: [] }, 0.5);
    buf.push({ t: 3, units: snap.units }, 1);
    const out = buf.sample(1.99);
    assert.deepEqual([out.get(1).layers, out.get(1).charges, out.get(2).layers, out.get(2).charges], [3, [1, 2], 0, null]);
    buf.sample(2, out);
    assert.deepEqual([out.get(1).layers, out.get(1).charges], [2, null]);
    buf.sample(3, out);
    assert.deepEqual([out.get(1).layers, out.get(1).charges], [0, null], 'a snapshot without them clears them');
  });
});
