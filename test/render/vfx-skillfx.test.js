// test/render/vfx-skillfx.test.js — the official skill, talent and charge effects in a battle (render/vfx/skillfx.js
// through render/vfx/wiring.js, DESIGN §33 Phase 3b) on a synthetic index and a fake effects layer: a skill's start /
// range / loop / end on its events, loops of a view built mid-battle (UF.SKILL), passives (deploy-driven, or timed by
// their kit), ready loops, the attack rows while on (the skill's own ability replacing the mode's, the look-ahead's
// wind-up, the skill projectile, aim), hit groups by the frame's damage order, the mode from the plan, trigger, the
// 秘术师 charge (stores, the release beside the shot — never doubled —, a stale reading, death), buffs on attack targets
// handed over to the status wiring, an instant skill without an attack, the kit fx bindings (start flash, loop cover,
// pulse, FX_BINDINGS), a tier switch, preloading, and nothing at all with the layer off.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { castPhase, FLASH } from '../../public/js/render/vfx/skillfx.js';
import { skillPlan, skillProjectile, targetsOf, buffDuration, planFor, chargePlan, chargeSource, eventNum, bindingKeys, FX_BINDINGS } from '../../public/js/render/vfx/skills.js';

const SKILL = 16; // UF.SKILL

const LOOPING = new Set(['foo_s1_buff', 'foo_s1_ready', 'foo_s2_burn', 'buff_stun', 'buff_burn', 'foo_s3_loop', 'bar_buff', 'foo_s1_range_l',
  'indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04', 'indigo_attack_charge_05', 'clemnt_skill_03_mark_all_01',
  'once_loop', 'oncep_loop']);
const KEYS = ['foo_atk_start', 'foo_atk_hit', 'foo_s2_mode_cast', 'foo_s3_mode_cast', 'foo_trail', 'foo_phit', 'foo_s1_buff', 'foo_s1_begin',
  'foo_s1_range', 'foo_s1_range_l', 'foo_s1_end', 'foo_s1_ready', 'foo_s1_trig', 'foo_s2_cast_start', 'foo_s2_cast_spell', 'foo_s2_aim', 'foo_s2_h1',
  'foo_s2_h2', 'foo_s2_burn', 'foo_s2_trail', 'foo_s2_phit', 'foo_s3_loop', 'foo_s3_tick', 'foo_each_hit', 'bar_buff', 'bar_birth',
  'indigo_attack_charge_01_start', 'indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04', 'indigo_attack_charge_05',
  'indigo_attack_01_trail', 'indigo_attack_01_hit', 'clemnt_skill_03_mark_all_01', 'buff_stun', 'buff_burn', 'g_hit', 'g_heal', 'g_enemy', 'g_die',
  'qux_s1_cast', 'qux_s1_trail', 'qux_mode_cast', 'once_buff', 'once_loop', 'oncep_buff', 'oncep_loop'];

const melee = (k, ev = 2) => ({ effects: [k], oneshot: 1, startEvent: ev, endEvent: 3, directionType: 0 });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const skills = {
    // lasting: mode S2, a buff loop, a begin effect, a range (one-shot and looping), an end effect, ready, a trigger
    skchr_foo_1: { mode: 1, projectiles: [], uses: [
      { role: 'loop', keys: ['foo_s1_buff'], from: 'BuffDuringSkill._buffs', node: 'sk1', on: 'owner' },
      // the same buff reached a second way (an _extraBuffs list): one effect, played once
      { role: 'loop', keys: ['foo_s1_buff'], from: 'BuffDuringSkill._extraBuffs', node: 'sk1', on: 'owner' },
      { role: 'start', keys: ['foo_s1_begin'], from: 'CastSkill._beginEffect', node: 'sk1' },
      { role: 'range', keys: ['foo_s1_range'], from: 'CastSkill._rangeEffect', node: 'sk1' },
      { role: 'range', keys: ['foo_s1_range_l'], from: 'RangeEffectEmitter._effect', node: 'sk1' },
      { role: 'end', keys: ['foo_s1_end'], from: 'CastSkill._endEffect', node: 'sk1' },
      { role: 'ready', keys: ['foo_s1_ready'], from: 'ReadySkillEffect._effects', node: 'sk1' },
      { role: 'trigger', keys: ['foo_s1_trig'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_TAKE_DAMAGE', action: 'CreateEffect', on: 'owner' },
      { role: 'hit', keys: ['foo_each_hit'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_OUTPUT_DAMAGE', action: 'CreateEffect', on: 'owner' },
    ] },
    // the skill's own melee ability: cast rows by event, an aim, two hit groups, buffs on its targets, a projectile
    skchr_foo_2: { mode: null, projectiles: ['proj_foo_s2'], uses: [
      { role: 'start', keys: ['foo_s2_cast_start'], from: 'UberEffectEmitter._castEffects', node: 'sk2', ability: 'MeleeAttack', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
      { role: 'start', keys: ['foo_s2_cast_spell'], from: 'UberEffectEmitter._castEffects', node: 'sk2', ability: 'MeleeAttack', startEvent: 'ON_SPELL_ON', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
      { role: 'hit', keys: ['foo_s2_aim'], from: 'UberEffectEmitter._castTargetEffects', node: 'sk2', ability: 'MeleeAttack', oneshot: true, list: 'castTarget' },
      { role: 'hit', keys: ['foo_s2_h1'], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'sk2', ability: 'MeleeAttack', oneshot: true, list: 'hit' },
      { role: 'hit', keys: ['foo_s2_h2'], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'sk2', ability: 'MeleeAttack', oneshot: true, list: 'hit' },
      { role: 'loop', keys: ['foo_s2_burn'], from: 'MeleeAttack._activeBuffs', node: 'sk2', on: 'targets', buff: 'b' },
      { role: 'loop', keys: ['buff_stun'], from: 'MeleeAttack._activeBuffs', node: 'sk2', on: 'targets', buff: 'stun' },
    ] },
    // a loop and the owner's buff tick (no event: a pulse a kit fx can stand for); mode S3
    skchr_foo_3: { mode: 2, projectiles: [], uses: [
      { role: 'loop', keys: ['foo_s3_loop'], from: 'BuffDuringSkill._buffs', node: 'sk3', on: 'owner' },
      { role: 'trigger', keys: ['foo_s3_tick'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', on: 'owner' },
    ] },
    skchr_bar_1: { mode: null, projectiles: [], uses: [
      { role: 'loop', keys: ['bar_buff'], from: 'PassiveBuffAbility._buffs', node: 'sk', on: 'owner' },
      { role: 'start', keys: ['bar_birth'], from: 'AttachOrDetachSkill._startEffect', node: 'sk' },
    ] },
    skchr_indigo_1: { mode: null, projectiles: [], uses: [] },
    // a ranged attack ability of the skill's own with its projectile (none of a melee blow's)
    skchr_qux_1: { mode: null, projectiles: ['proj_qux_s1_2', 'proj_qux_s1'], uses: [
      { role: 'start', keys: ['qux_s1_cast'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'RangedAttack', startEvent: 'ON_SPELL_ON', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
    ] },
    skchr_clemnt_3: { mode: 1, projectiles: ['projectile_chr_clemnt_s3'], uses: [] },
    // held loops of a skill and a passive: one prefab loops, the other is a one-shot (index.json looping false)
    skchr_once_1: { mode: null, projectiles: [], uses: [
      { role: 'loop', keys: ['once_buff'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner' },
      { role: 'loop', keys: ['once_loop'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner' },
    ] },
    skchr_once_2: { mode: null, projectiles: [], uses: [
      { role: 'loop', keys: ['oncep_buff'], from: 'PassiveBuffAbility._buffs', node: 'sk', on: 'owner' },
      { role: 'loop', keys: ['oncep_loop'], from: 'PassiveBuffAbility._buffs', node: 'sk', on: 'owner' },
    ] },
  };
  const unit = (modes, sk, skin = null) => ({ kind: 'char', skin, modes, skills: Object.fromEntries(sk.map((s) => [s, skills[s]])), startEffect: null, deadEffect: null });
  return {
    units: {
      char_100_foo: unit([
        { name: 'Default', attack: { class: 'MeleeAttack', cast: [melee('foo_atk_start')], hit: [{ effects: ['foo_atk_hit'], directionType: 0 }] } },
        { name: 'S2', attack: { class: 'RangedAttack', projectileKey: 'proj_foo', cast: [melee('foo_s2_mode_cast', 4)] } },
        { name: 'S3', attack: { class: 'MeleeAttack', cast: [melee('foo_s3_mode_cast')] } },
      ], ['skchr_foo_1', 'skchr_foo_2', 'skchr_foo_3'], 'char_100_foo'),
      char_200_bar: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], ['skchr_bar_1']),
      char_469_indigo: unit([
        { name: 'Default', attack: { class: 'MultiChargeRangedAttack', projectileKey: 'projectile_chr_indigo', cast: [] } },
      ], ['skchr_indigo_1'], 'char_469_indigo'),
      char_4231_clemnt: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }, { name: 'S3', attack: { class: 'MeleeAttack', cast: [] } }], ['skchr_clemnt_3']),
      char_300_qux: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [melee('qux_mode_cast', 4)], hit: [] } }, { name: 'S2', attack: { class: 'MeleeAttack', cast: [] } }], ['skchr_qux_1']),
      char_500_once: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], ['skchr_once_1']),
      char_510_oncep: unit([{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], ['skchr_once_2']),
      enemy_1: { kind: 'enemy', modes: [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], skills: {} },
    },
    skills,
    projectiles: {
      proj_foo: { main: 'foo_trail', onHit: ['foo_phit'], effects: ['foo_trail', 'foo_phit'], movement: { class: 'AdvancedMovement' } },
      proj_foo_s2: { main: 'foo_s2_trail', onHit: ['foo_s2_phit'], effects: ['foo_s2_trail', 'foo_s2_phit'], movement: { class: 'AdvancedMovement' } },
      projectile_chr_indigo: { main: 'indigo_attack_01_trail', onHit: ['indigo_attack_01_hit'], effects: ['indigo_attack_01_trail', 'indigo_attack_01_hit'], movement: { class: 'AdvancedMovement' } },
      projectile_chr_indigo_s1: { main: 'indigo_attack_01_trail', onHit: [], effects: ['indigo_attack_01_trail'] },
      projectile_chr_indigo_s2: { main: 'indigo_attack_01_trail', onHit: [], effects: ['indigo_attack_01_trail'] },
      projectile_chr_clemnt_s3: { main: null, onReached: ['clemnt_skill_03_mark_all_01'], effects: ['clemnt_skill_03_mark_all_01'] },
      proj_qux_s1: { main: 'qux_s1_trail', onHit: [], effects: ['qux_s1_trail'] },
      proj_qux_s1_2: { main: 'qux_s1_trail', onHit: [], effects: ['qux_s1_trail'] },
    },
    skins: {
      char_100_foo: { points: { HitPoint: { all: { pos: [0, 0.2, -0.25] } }, Muzzle: { all: { pos: [0.3, 0.3, -0.3] } } } },
      char_469_indigo: { points: { MuzzlePoint: { all: { pos: [0.3, 0.3, -0.3] } }, SpecialPoint0: { all: { pos: [0, 0.6, -0.5] } },
        SpecialPoint1: { all: { pos: [-0.4, 0.5, -0.4] } }, SpecialPoint2: { all: { pos: [0.4, 0.5, -0.4] } }, SpecialPoint3: { all: { pos: [0, 0.8, -0.7] } } } },
    },
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: { char: 'g_die', enemy: 'g_die' }, birth: {}, status: { stun: 'buff_stun', burn: 'buff_burn' } },
    prefabs,
  };
}

/** Our data records of the fixture's units (render/app.js ctx.lookupDef). */
const RECS = {
  char_100_foo: { charId: 'char_100_foo', skills: [
    { skillId: 'skchr_foo_1', index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 20, bb: {} },
    { skillId: 'skchr_foo_2', index: 1, skillType: 'AUTO', durationType: 'NONE', duration: 0, bb: { duration: 3 } },
    { skillId: 'skchr_foo_3', index: 2, skillType: 'MANUAL', durationType: 'NONE', duration: 15, bb: {} },
  ] },
  char_200_bar: { charId: 'char_200_bar', skill: { skillId: 'skchr_bar_1', index: 0, skillType: 'PASSIVE', durationType: 'NONE', duration: -1, bb: {} } },
  char_469_indigo: { charId: 'char_469_indigo', skill: { skillId: 'skchr_indigo_1', index: 0, skillType: 'MANUAL', duration: 20, bb: {} } },
  char_4231_clemnt: { charId: 'char_4231_clemnt', skill: { skillId: 'skchr_clemnt_3', index: 2, skillType: 'MANUAL', durationType: 'AMMO', duration: 0, bb: { projectile_life_time: 5 } } },
  char_300_qux: { charId: 'char_300_qux', skill: { skillId: 'skchr_qux_1', index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 10, bb: {} } },
  char_500_once: { charId: 'char_500_once', skill: { skillId: 'skchr_once_1', index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 20, bb: {} } },
  char_510_oncep: { charId: 'char_510_oncep', skill: { skillId: 'skchr_once_2', index: 0, skillType: 'PASSIVE', durationType: 'NONE', duration: -1, bb: {} } },
};

function fakeOfx(index, { active = true } = {}) {
  const spawned = [];
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [],
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 2 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = { key, place, opts, stopped: false, done: false, get alive() { return !this.stopped && !this.done; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  return { ofx, spawned, handles };
}

async function setup(o = {}) {
  const index = makeIndex();
  const f = fakeOfx(index, o);
  const views = new Map();
  const w = new FxWiring(f.ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, o2 = {}) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x, y: 10, z: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0, sp: 0, spMax: 10, energy: null, dir: enemy ? undefined : 'RIGHT',
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: o2.skill ?? 0 }, ...o2.v };
    views.set(id, v);
    return v;
  };
  /** One frame of the field view: sync after the sample, then the clock. */
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); f.ofx.time += dt; };
  return { ...f, w, views, view, frame, index };
}

const live = (handles, key) => handles.filter((h) => h.key === key && h.alive);

describe('skill events', () => {
  test('on: start and range play, the loop starts (held); off: the loops stop, end plays; the official layer shows it', async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    frame();
    assert.equal(w.skill(u, true), true, 'the official layer shows this skill: no procedural burst');
    for (const k of ['foo_s1_begin', 'foo_s1_range', 'foo_s1_range_l', 'foo_s1_buff']) assert.ok(spawned.includes(k), k);
    assert.equal(live(handles, 'foo_s1_buff').length, 1, 'a buff the plan lists twice loops once');
    assert.equal(handles.find((h) => h.key === 'foo_s1_buff').opts.loop, true, 'a held loop is never dropped');
    u.flags = SKILL;
    frame(); frame();
    assert.equal(spawned.filter((k) => k === 'foo_s1_buff').length, 1, 'the snapshot flag starts nothing twice');
    w.skill(u, false);
    u.flags = 0;
    assert.equal(live(handles, 'foo_s1_buff').length, 0, 'the loop stops (with its own fade)');
    assert.equal(live(handles, 'foo_s1_range_l').length, 0, 'a looping range is held for the skill');
    assert.ok(spawned.includes('foo_s1_end'));
  });

  test('a view built mid-battle starts the loops from UF.SKILL (no start one-shots) and stops them when the flag clears', async () => {
    const { spawned, handles, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0, v: { flags: SKILL } });
    frame();
    assert.deepEqual(spawned.filter((k) => k.startsWith('foo_s1')).sort(), ['foo_s1_buff', 'foo_s1_range_l']);
    u.flags = 0;
    frame();
    assert.equal(live(handles, 'foo_s1_buff').length, 0);
  });

  test('death, leak and retreat stop the loops; a view that left the field does too', async () => {
    const { w, handles, view, views, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    w.skill(u, true);
    w.death(u);
    assert.equal(live(handles, 'foo_s1_buff').length, 0, 'death');
    const b = view(2, 'char_100_foo', 6, { skill: 0 });
    w.skill(b, true);
    views.delete(2);
    frame();
    assert.equal(live(handles, 'foo_s1_buff').length, 0, 'gone from the views');
  });

  test('ready: sp ≥ spMax with the skill off loops the ready effect; the skill start stops it', async () => {
    const { w, handles, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    u.sp = 9; frame();
    assert.equal(live(handles, 'foo_s1_ready').length, 0);
    u.sp = 10; frame();
    assert.equal(live(handles, 'foo_s1_ready').length, 1);
    frame();
    assert.equal(handles.filter((h) => h.key === 'foo_s1_ready').length, 1, 'once');
    w.skill(u, true);
    assert.equal(live(handles, 'foo_s1_ready').length, 0);
  });

  test('a passive loops while deployed (start one-shots once per deployment); a death ends it, the next deploy starts it again', async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const u = view(1, 'char_200_bar', 5);
    // the sim: 'skill' 1 (a passive without a duration: its 0.5 s clip window), then 'deploy'
    assert.equal(w.skill(u, true), true);
    w.deploy(u);
    assert.deepEqual(spawned.filter((k) => k.startsWith('bar_')), ['bar_buff', 'bar_birth']);
    w.skill(u, false);
    frame(); frame();
    assert.equal(live(handles, 'bar_buff').length, 1, 'the clip window ends, the passive stays');
    w.death(u);
    assert.equal(live(handles, 'bar_buff').length, 0);
    w.deploy(u);
    assert.equal(live(handles, 'bar_buff').length, 1);
    assert.equal(spawned.filter((k) => k === 'bar_birth').length, 2);
  });

  test('a PASSIVE skill its kit runs as a timed one (UF.SKILL seen) ends with its skill 0', async () => {
    const { w, handles, view, frame } = await setup();
    const u = view(1, 'char_200_bar', 5);
    w.skill(u, true);
    u.flags = SKILL;
    frame();
    w.skill(u, false);
    u.flags = 0;
    frame(); frame();
    assert.equal(live(handles, 'bar_buff').length, 0);
  });

  test('an instant skill whose kit sends no attack between 1 and 0 plays its attack cast once', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 1 });
    frame();
    w.skill(u, true);
    w.skill(u, false);
    assert.deepEqual(spawned.filter((k) => k.startsWith('foo_s2_cast')), ['foo_s2_cast_start', 'foo_s2_cast_spell']);
    // with its attack in between, the attack plays them (not the fallback)
    frame();
    const t = view(2, 'enemy_1', 6);
    w.skill(u, true);
    w.attack(u, t, 'none', 1);
    w.skill(u, false);
    assert.equal(spawned.filter((k) => k === 'foo_s2_cast_start').length, 2);
  });

  test('with the layer off nothing plays and the procedural effects stay', async () => {
    const { w, spawned, view, frame } = await setup({ active: false });
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    frame();
    assert.equal(w.skill(u, true), false);
    assert.equal(w.simFx('aoe', 5, 10, { id: 1, skill: 'x' }), false);
    w.skill(u, false);
    assert.deepEqual(spawned, []);
  });
});

describe('attacks while the skill is on', () => {
  test('the mode comes from the plan (modeName); without a plan the old S<n> rule; off → Default', async () => {
    const { w, view } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 2 });   // skchr_foo_3: mode S3 (index 2), not S<skillIndex + 1> by accident
    const unit = w.unitOf(u);
    assert.equal(w.mode(unit, u).name, 'Default');
    w.skill(u, true);
    assert.equal(w.mode(unit, u).name, 'S3');
    assert.equal(w.mode(unit, u, false).name, 'Default', 'the look-ahead wins');
    const s1 = view(2, 'char_100_foo', 5, { skill: 0 });
    w.skill(s1, true);
    assert.equal(w.mode(unit, s1).name, 'S2', 'skchr_foo_1: mode 1 = S2');
    // a unit without a plan (no record, no skill of that name in the index): the old rule by the flag
    const anon = { id: 9, x: 5, y: 10, z: 0, flags: SKILL, alive: true, info: { id: 9, spine: 'char_300_qux', defId: 'nobody', kind: 'op', side: 'ally', skillIndex: 1 } };
    assert.equal(w.mode(w.unitOf(anon), anon).name, 'S2');
    anon.flags = 0;
    assert.equal(w.mode(w.unitOf(anon), anon).name, 'Default');
  });

  test("the skill's own attack ability replaces the mode's rows: cast phases with the wind-up, aim on the target, its projectile", async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 1 });
    const t = view(2, 'enemy_1', 8);
    frame();
    // the look-ahead saw the skill's 1 queued before this 'atk': the wind-up plays the skill's ON_CAST_START rows (the
    // aim on the target: castTarget rows start with the cast, like the index's)
    assert.equal(w.castStart(u, t, 'none', { skip: 0, left: 0.5, skillOn: true }), true);
    assert.deepEqual(spawned, ['foo_s2_cast_start', 'foo_s2_aim']);
    w.skill(u, true);
    w.attack(u, t, 'none', 0.2, true);
    assert.ok(spawned.includes('foo_s2_cast_spell'), 'the ON_SPELL_ON row at the strike');
    assert.equal(spawned.filter((k) => k === 'foo_s2_cast_start' || k === 'foo_s2_aim').length, 2, 'the wound-up rows are not played twice');
    assert.ok(!spawned.includes('foo_atk_start') && !spawned.includes('foo_s2_mode_cast'), "the mode's rows are replaced");
    assert.equal(handles.find((h) => h.key === 'foo_s2_aim').place.pos[0], t.x - 10, 'aim plays on the target');
    // off: the next attack (a later frame) is the Default mode's again
    w.skill(u, false);
    frame();
    w.attack(u, t, 'none', 1, false);
    assert.equal(spawned.at(-1), 'foo_atk_start');
  });

  test('one attack on several targets (an atk per target in one frame) casts once; its target rows play on each', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 1 });
    const a = view(2, 'enemy_1', 6), b = view(3, 'enemy_1', 7);
    frame();
    w.skill(u, true);
    w.attack(u, a, 'none', 1);
    w.attack(u, b, 'none', 1);
    assert.equal(spawned.filter((k) => k === 'foo_s2_cast_start').length, 1);
    assert.equal(spawned.filter((k) => k === 'foo_s2_aim').length, 2);
    frame();
    w.attack(u, a, 'none', 2);
    assert.equal(spawned.filter((k) => k === 'foo_s2_cast_start').length, 2, 'the next attack casts again');
  });

  test("a ranged skill attack flies the skill's projectile (named after the skill: _s1 before _s1_2); a blow of another kind keeps the mode's rows", async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_300_qux', 5, { skill: 0 });
    const t = view(2, 'enemy_1', 8);
    frame();
    w.skill(u, true);
    w.attack(u, t, 'arrow', 1);
    assert.deepEqual(spawned, ['qux_s1_cast', 'qux_s1_trail']);
    frame();
    w.attack(u, t, 'none', 2);
    assert.deepEqual(spawned.slice(2), ['qux_mode_cast'], "a melee blow is no ranged ability's: the mode's rows");
  });

  test('hit groups: the k-th damage on the target in one frame plays group k; a later frame does not replay them', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 1 });
    const t = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    w.attack(u, t, 'none', 1);
    assert.equal(w.damage(t, 'phys', u, 1.1), true);
    assert.equal(w.damage(t, 'phys', u, 1.1), true);
    assert.equal(w.damage(t, 'phys', u, 1.1), true);
    assert.deepEqual(spawned.filter((k) => /^foo_s2_h\d/.test(k)), ['foo_s2_h1', 'foo_s2_h2', 'foo_s2_h2'], 'past the last group: the last again');
    assert.ok(!spawned.includes('g_hit'), 'no generic hit beside the groups');
    w.damage(t, 'phys', u, 1.3);   // a later frame (a DoT): not a hit of the blow
    assert.equal(spawned.filter((k) => /^foo_s2_h\d/.test(k)).length, 3);
  });

  test("`each` rows join the mode's attack while a skill without an ability of its own is on", async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    const t = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    w.attack(u, t, 'arrow', 1);
    assert.ok(spawned.includes('foo_s2_mode_cast') && spawned.includes('foo_trail'), "the S2 mode's cast and projectile");
    w.damage(t, 'phys', u, 1.1);
    assert.ok(spawned.includes('foo_each_hit'), "the skill's each.hit on the hit");
  });

  test("a buff of the skill's attack loops on its target for the buff's duration; a status loop of the same key takes over", async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 1 });
    const t = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    w.attack(u, t, 'none', 1);
    w.damage(t, 'phys', u, 1.1);
    assert.equal(live(handles, 'foo_s2_burn').length, 1, 'the attack-borne buff (blackboard duration 3 s)');
    assert.equal(live(handles, 'buff_stun').length, 1);
    w.skill(u, false);
    // the sim reports the stun: the status loop takes over (never two)
    w.status(t, 'stun', true);
    assert.equal(live(handles, 'buff_stun').length, 1);
    assert.equal(handles.filter((h) => h.key === 'buff_stun')[0].stopped, true, "the skill's own copy stopped");
    ofx.time += 3.1;
    frame();
    assert.equal(live(handles, 'foo_s2_burn').length, 0, 'gone after its duration');
    assert.equal(spawned.filter((k) => k === 'foo_s2_burn').length, 1);
  });

  test('trigger: damage on the owner while the skill is on (once a frame); not while off', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    frame();
    w.damage(u, 'phys', null, 1);
    assert.ok(!spawned.includes('foo_s1_trig'));
    w.skill(u, true);
    w.damage(u, 'phys', null, 1);
    w.damage(u, 'phys', null, 1);
    assert.equal(spawned.filter((k) => k === 'foo_s1_trig').length, 1);
    frame();
    w.damage(u, 'phys', null, 1.1);
    assert.equal(spawned.filter((k) => k === 'foo_s1_trig').length, 2);
  });
});

describe('the 秘术师 charge (b.snap energy)', () => {
  test('stores light the slots; the attack releases them beside its own shot (n + 1 flights, none doubled); death dims', async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const u = view(1, 'char_469_indigo', 5);
    const t = view(2, 'enemy_1', 8);
    u.energy = [0, 3]; frame();
    u.energy = [1, 3]; frame();
    assert.deepEqual(spawned, ['indigo_attack_charge_01_start', 'indigo_attack_charge_02']);
    u.energy = [2, 3]; frame();
    assert.equal(live(handles, 'indigo_attack_charge_03').length, 1);
    const before = spawned.filter((k) => k === 'indigo_attack_01_trail').length;
    w.attack(u, t, 'bolt', 1);
    const flights = spawned.filter((k) => k === 'indigo_attack_01_trail').length - before;
    assert.equal(flights, 3, 'the shot from the muzzle + one per stored energy');
    const trails = handles.filter((h) => h.key === 'indigo_attack_01_trail');
    assert.notDeepEqual(trails[1].place.pos, trails[0].place.pos, 'the stored ones leave their slots, not the muzzle');
    assert.equal(live(handles, 'indigo_attack_charge_02').length + live(handles, 'indigo_attack_charge_03').length, 0, 'released: dark');
    // the snapshot still read 2 this frame: ignored (the next store takes an attack interval)
    frame();
    assert.equal(live(handles, 'indigo_attack_charge_02').length, 0);
    u.energy = [0, 3]; ofx.time += 1; frame();
    u.energy = [1, 3]; frame();
    assert.equal(live(handles, 'indigo_attack_charge_02').length, 1);
    w.death(u);
    assert.equal(live(handles, 'indigo_attack_charge_02').length, 0);
  });

  test('works with 设置「秘术师能量」 off: the readout rides in every snapshot (the view reads v.energy, not the setting)', async () => {
    const { handles, view, frame } = await setup();
    const u = view(1, 'char_469_indigo', 5);
    u.energy = [3, 3]; frame();
    assert.equal(live(handles, 'indigo_attack_charge_04').length, 1);
  });

  test('chargeSource takes the index\'s own export when it has the table\'s shape', () => {
    const idx = makeIndex();
    assert.equal(chargeSource(idx, 'char_469_indigo').cap, 3);
    idx.units.char_469_indigo.charge = { cap: 2, slots: [{ spell: ['Indigo_Attack_Charge_02'], cast: [], mount: 6 }], projectiles: { Default: 'PROJECTILE_CHR_INDIGO' } };
    const p = chargePlan(idx, 'char_469_indigo');
    assert.equal(p.cap, 2);
    assert.deepEqual(p.byCount[1], ['indigo_attack_charge_02']);
    assert.equal(p.onRelease.projectiles.Default, 'projectile_chr_indigo');
    assert.deepEqual(p.onRelease.mountTypes, [6]);
    idx.units.char_469_indigo.charge = { junk: true };
    assert.equal(chargePlan(idx, 'char_469_indigo').cap, 3, 'a malformed export falls back to the table');
  });
});

describe('kit fx the official effects stand for', () => {
  test("a cast flash on the owner in the frame of the official skill start; a skill-tagged one while its loops play; not elsewhere", async () => {
    const { w, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    frame();
    w.skill(u, true);
    assert.equal(w.simFx('aoe', 5, 10, { id: 1, radius: 0.5, skill: 'foo:start' }), true, 'the start flash');
    assert.equal(w.simFx('dp', 5, 10, { id: 1, n: 3 }), false, 'a game fact stays');
    assert.equal(w.simFx('aoe', 9, 10, { id: 1, skill: 'foo:far' }), false, 'away from the owner stays');
    frame();
    assert.equal(w.simFx('aoe', 5, 10, { id: 1 }), false, 'a later untagged flash stays');
    assert.equal(w.simFx('buff', 5, 10, { id: 1, skill: 'foo:tick' }), true, 'a tagged one while the official loops play');
    w.skill(u, false);
    assert.equal(w.simFx('buff', 5, 10, { id: 1, skill: 'foo:tick' }), false);
  });

  test("a skill's pulse: its buff tick plays on the owner for the kit's own fx of that moment", async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 2 });
    frame();
    w.skill(u, true);
    frame();
    assert.equal(w.simFx('aoe', 5, 10, { id: 1, skill: 'foo:pulse' }), true);
    assert.equal(spawned.at(-1), 'foo_s3_tick');
  });

  test('FX_BINDINGS: 克莱门莎 S3 — the lock plays the skill projectile\'s reached mark at the tile, held for projectile_life_time; her blasts there are covered', async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const c = view(1, 'char_4231_clemnt', 5, { skill: 2 });
    const e = view(2, 'enemy_1', 8);
    frame();
    w.skill(c, true);
    assert.equal(w.simFx('lock', 8, 10, { id: 2, src: 1, dur: 0.5 }), true);
    assert.equal(spawned.at(-1), 'clemnt_skill_03_mark_all_01');
    assert.equal(handles.at(-1).place.pos[0], e.x - 10);
    assert.equal(w.simFx('blast', 8, 10, { id: 1, r: 1.5 }), true, 'the strike at the marked tile');
    assert.equal(w.simFx('blast', 3, 10, { id: 1, r: 1.5 }), false, 'another tile: procedural');
    ofx.time += 5.1; w.tick();
    assert.equal(live(handles, 'clemnt_skill_03_mark_all_01').length, 0, 'cleared with the projectile');
    frame();
    assert.equal(w.simFx('blast', 8, 10, { id: 1, r: 1.5 }), false);
  });
});

describe('frames, tiers and preloading', () => {
  test('a tier switch (the effects cleared) restarts what runs, without the start one-shots', async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const u = view(1, 'char_100_foo', 5, { skill: 0 });
    frame();
    w.skill(u, true);
    for (const h of handles) h.stop();   // OfficialFx.setTier → clear()
    ofx.tier = 'lite'; ofx.lite = true;
    frame();
    assert.equal(live(handles, 'foo_s1_buff').length, 1);
    assert.equal(spawned.filter((k) => k === 'foo_s1_begin').length, 1);
  });

  test("a held loop whose prefab does not loop plays once at the start, for its own life — never again on a tier switch or a view built mid-battle", async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const u = view(1, 'char_500_once', 5);
    frame();
    w.skill(u, true);
    u.flags = SKILL;
    assert.equal(handles.find((h) => h.key === 'once_buff').opts.loop, false, 'a one-shot prefab: no loop');
    assert.equal(handles.find((h) => h.key === 'once_loop').opts.loop, true);
    handles.find((h) => h.key === 'once_buff').done = true;   // its life is over
    frame(); frame();
    assert.equal(spawned.filter((k) => k === 'once_buff').length, 1, 'not restarted');
    for (const h of handles) h.stop();   // OfficialFx.setTier → clear()
    ofx.tier = 'lite'; ofx.lite = true;
    frame();
    assert.equal(live(handles, 'once_loop').length, 1, 'the looping prefab starts again');
    assert.equal(spawned.filter((k) => k === 'once_buff').length, 1, 'the one-shot one does not');
    const m = view(2, 'char_500_once', 6, { v: { flags: SKILL } });   // a view built mid-battle
    frame();
    assert.equal(spawned.filter((k) => k === 'once_loop').length, 3);
    assert.equal(spawned.filter((k) => k === 'once_buff').length, 1, 'its start is over');
    w.skill(m, false); m.flags = 0;
    // a passive: both at the deploy, only the looping one after a tier switch
    const p = view(3, 'char_510_oncep', 7);
    w.deploy(p); frame();
    assert.deepEqual(['oncep_buff', 'oncep_loop'].map((k) => spawned.filter((x) => x === k).length), [1, 1]);
    for (const h of handles) h.stop();
    ofx.tier = 'full'; ofx.lite = false;
    frame();
    assert.deepEqual(['oncep_buff', 'oncep_loop'].map((k) => spawned.filter((x) => x === k).length), [1, 2]);
  });

  test('keysFor preloads the plans, the skills\' projectiles, the charge and the bindings', async () => {
    const { w, view } = await setup();
    const views = [view(1, 'char_100_foo', 5, { skill: 1 }), view(2, 'char_469_indigo', 6), view(3, 'char_4231_clemnt', 7, { skill: 2 })];
    const keys = w.keysFor(views);
    for (const k of ['foo_s2_cast_start', 'foo_s2_h2', 'foo_s2_trail', 'foo_s2_phit', 'indigo_attack_charge_05', 'indigo_attack_charge_01_start', 'clemnt_skill_03_mark_all_01']) assert.ok(keys.includes(k), k);
  });
});

describe('skills.js helpers of Phase 3b', () => {
  const idx = makeIndex();
  test('event names, cast phases, the skill projectile, targets, durations, the one-call resolver, bindings', () => {
    assert.deepEqual(['ON_CAST_START', 'ON_SPELL_ON', 4, 'nope', null].map(eventNum), [2, 4, 4, null, null]);
    assert.deepEqual([{ startEvent: 'ON_CAST_START' }, { startEvent: 4 }, { event: 'ON_ABILITY_START' }, { event: 'ON_BEFORE_ATTACK' }, {}].map(castPhase), ['start', 'strike', 'start', 'strike', 'start']);
    assert.equal(skillProjectile(idx, { projectiles: ['a_s2_2', 'a_s2', 'a_s1s2'], skillId: 'skchr_a_2' }), 'a_s2');
    assert.equal(skillProjectile(idx, { projectiles: ['b_one'], skillId: 'skchr_b_1' }), 'b_one');
    assert.equal(skillProjectile(idx, { projectiles: [], skillId: 'x' }), null);
    const t = targetsOf(idx, skillPlan(idx, 'char_100_foo', 'skchr_foo_2'));
    assert.deepEqual([t.hit.map((e) => e.key), t.status.length, t.none.length], [['foo_s2_burn', 'buff_stun'], 0, 0]);
    assert.deepEqual([{ bb: { duration: 3 } }, { bb: { bleed_duration: 2 } }, { bb: { 'x.duration': 4 } }, { bb: { max_duration: 9 } }, {}].map(buffDuration), [3, 2, 4, null, null]);
    const r = planFor(idx, { info: { kind: 'op', side: 'ally', defId: 'char_100_foo', spine: 'char_100_foo', skillIndex: 1 }, rec: RECS.char_100_foo });
    assert.deepEqual([r.skillId, r.plan.kind, r.srec.bb.duration], ['skchr_foo_2', 'instant', 3]);
    assert.deepEqual(skillPlan(idx, 'char_100_foo', 'skchr_foo_3').pulse.map((e) => [e.key, e.at, e.reason]), [['foo_s3_tick', 'owner', 'tick']]);
    assert.deepEqual(bindingKeys(idx, 'skchr_clemnt_3'), ['clemnt_skill_03_mark_all_01']);
    assert.equal(FX_BINDINGS.skchr_clemnt_3.lock.owner, 'src');
    assert.ok(FLASH.has('blast') && !FLASH.has('reticle'));
  });
});
