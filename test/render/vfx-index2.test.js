// test/render/vfx-index2.test.js — the official effects on index.json version 2 (DESIGN §33.12 / §33.15, 0.3.0 Phase 3c)
// through render/vfx/wiring.js and render/vfx/skillfx.js on a synthetic version-2 index: MultiHit hit groups of a mode
// attack (min(k, last), an empty group, loop, random, once, the plain rows on every hit), UberAnimation replace groups
// (in turn for loopType 1, by the model's animation else), sub-abilities (Random, Parallel, Selectable by the attack's
// kind), a blocked enemy's combat, an enemy's form → its mode, InCertainMode / VigilWolf rows, an enemy's skill window
// (the 'cast' slot, the snapshot's SKILL window of a single-skill enemy, its end, its attack rows, its mode copies), a
// summon's only skill, the 秘术师 charge from the index's groups, skinShift off for version 2, skills.js's v2 fields
// (indexed groups, rootClass kind, prefab placement), preloading.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring, pickAttacks, seedOf } from '../../public/js/render/vfx/wiring.js';
import { pickGroup, formMode } from '../../public/js/render/vfx/skillfx.js';
import { skillPlan, hitGroups, chargeFromIndex, chargePlan, chargeSource, CHARGE_EMITTERS, resolveSkill } from '../../public/js/render/vfx/skills.js';
import { skinShift, setIndexVersion } from '../../public/js/render/vfx/mounts.js';

const SKILL_ANIM = 3, BLOCKED = 1;
const row = (k, o = {}) => ({ effects: [k], directionType: 0, oneshot: 1, startEvent: 2, endEvent: 3, ...o });
const LOOPING = new Set(['roar_loop', 'tok_loop', 'ind_02', 'ind_03', 'ind_04', 'ind_05']);
const KEYS = ['mh_cast', 'mh_hit_1', 'mh_hit_3', 'mh_plain', 'lp_1', 'lp_2', 'rd_1', 'rd_2', 'rd_3', 'once_1', 'once_2', 'an_1', 'an_2', 'b0_a', 'b0_b',
  'b0_c', 'gra_cast', 'grb_cast', 'par_m', 'par_r', 'par_trail', 'sel_r', 'sel_trail', 'sel_m', 'en_shot', 'en_trail', 'en_combat_cast', 'en_combat_hit',
  'en_reborn_hit', 'roar_start', 'roar_loop', 'roar_end', 'bash_cast', 'bash_reborn', 'two_a', 'two_b', 'icm_hit', 'wolf_plain', 'wolf_buff',
  'tok_loop', 'ind_start', 'ind_02', 'ind_03', 'ind_04', 'ind_05', 'ind_trail', 'med_cast', 'med_hit', 'kb_1', 'kb_2', 'kb_base', 'skb_1', 'skb_base', 'g_hit', 'g_enemy', 'g_heal', 'g_die'];

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), ...(k === 'ind_02' ? { spawn: 9, follow: 6 } : {}) }]));
  const mhEm = (o) => ({ class: 'MultiHitUberEffectEmitter', useRandomHitEffect: 0, useLoopHitEffect: 0, keepBaseHitEffect: 0, oncePerTarget: 0, ...o });
  const melee = (cast, hit, extra = {}) => ({ class: 'MeleeAttack', cast, hit, ...extra });
  const unit = (kind, modes, skills = {}, extra = {}) => ({ kind, modes, skills, startEffect: null, deadEffect: null, ...extra });
  return {
    format: 'fx-index', version: 2,
    units: {
      // a MultiHit attack: 3 groups (the 2nd empty) and a plain emitter's row on every hit
      char_500_mh: unit('char', [{ name: 'Default', attack: melee([row('mh_cast', { emitter: 0 })], [
        row('mh_hit_1', { group: 0, emitter: 0 }), row('mh_hit_3', { group: 2, emitter: 0 }), row('mh_plain', { emitter: 1 })],
      { class: 'MultiMeleeAttack', emitters: [mhEm({ groups: { hitGroups: 3 } }), { class: 'UberEffectEmitter' }] }) }]),
      char_501_loop: unit('char', [{ name: 'Default', attack: melee([], [row('lp_1', { group: 0, emitter: 0 }), row('lp_2', { group: 1, emitter: 0 })],
        { emitters: [mhEm({ useLoopHitEffect: 1, groups: { hitGroups: 2 } })] }) }]),
      char_502_rand: unit('char', [{ name: 'Default', attack: melee([], [row('rd_1', { group: 0, emitter: 0 }), row('rd_2', { group: 1, emitter: 0 }), row('rd_3', { group: 2, emitter: 0 })],
        { emitters: [mhEm({ useRandomHitEffect: 1, groups: { hitGroups: 3 } })] }) }]),
      char_505_once: unit('char', [{ name: 'Default', attack: melee([], [row('once_1', { group: 0, emitter: 0 }), row('once_2', { group: 1, emitter: 0 })],
        { emitters: [mhEm({ oncePerTarget: 1, groups: { hitGroups: 2 } })] }) }]),
      // UberAnimation (index v3 resolved the LoopType): 0 LOOP plays the groups in turn, 1 RANDOM a seeded pick
      char_503_anim: unit('char', [{ name: 'Default', attack: melee([
        row('an_1', { group: 0, anim: 'Attack_1', emitter: 0 }), row('an_2', { group: 1, anim: 'Attack_2', emitter: 0 }),
        row('b0_a', { group: 0, anim: 'A', emitter: 1 }), row('b0_b', { group: 1, anim: 'B', emitter: 1 }), row('b0_c', { group: 2, anim: 'C', emitter: 1 })], [],
      { emitters: [{ class: 'UberAnimationEffectEmitter', sourceAnimKey: 'Attack', loopType: 0, loopTypeName: 'LOOP', replaceAnims: ['Attack_1', 'Attack_2'] },
        { class: 'UberAnimationEffectEmitter', sourceAnimKey: 'Attack', loopType: 1, loopTypeName: 'RANDOM', replaceAnims: ['A', 'B', 'C'] }] }) }]),
      // a MultiHit emitter's own rows without a group: given way to its groups, kept with keepBaseHitEffect
      char_508_kb0: unit('char', [{ name: 'Default', attack: melee([], [row('kb_1', { group: 0, emitter: 0 }), row('kb_2', { group: 1, emitter: 0 }), row('kb_base', { emitter: 0 })],
        { emitters: [mhEm({ groups: { hitGroups: 2 } })] }) }]),
      char_509_kb1: unit('char', [{ name: 'Default', attack: melee([], [row('kb_1', { group: 0, emitter: 0 }), row('kb_2', { group: 1, emitter: 0 }), row('kb_base', { emitter: 0 })],
        { emitters: [mhEm({ keepBaseHitEffect: 1, groups: { hitGroups: 2 } })] }) }]),
      // a heal with hit rows of its own, an attack with none
      char_506_med: unit('char', [{ name: 'Default', attack: { class: 'HealAttack', cast: [row('med_cast')], hit: [row('med_hit')] } }]),
      char_507_plain: unit('char', [{ name: 'Default', attack: melee([], []) }]),
      // group abilities
      char_504_grp: unit('char', [
        { name: 'Default', attack: { class: 'AbilityRandomGroup', cast: [], hit: [], abilities: [melee([row('gra_cast')], []), melee([row('grb_cast')], [])] } },
        { name: 'S1', attack: { class: 'AbilityParallelGroup', cast: [], hit: [], abilities: [melee([row('par_m')], []), { class: 'RangedAttack', projectileKey: 'proj_par', cast: [row('par_r')], hit: [] }] } },
        { name: 'S2', attack: { class: 'AbilitySelectableGroup', cast: [], hit: [], abilities: [{ class: 'RangedAttack', projectileKey: 'proj_sel', cast: [row('sel_r')], hit: [] }, melee([row('sel_m')], [])] } },
      ], { skills: { skchr_grp_1: { mode: 1, uses: [], rootClass: 'CastSkill' }, skchr_grp_2: { mode: 2, uses: [], rootClass: 'CastSkill' } } }),
      // an enemy: a ranged attack, a melee combat, a Reborn mode; a single-skill enemy's window, an attack skill held in two modes
      enemy_600_blk: unit('enemy', [
        { name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'proj_en', cast: [row('en_shot')], hit: [] }, combat: melee([row('en_combat_cast')], [row('en_combat_hit')]) },
        { name: 'Reborn', attack: null, combat: melee([], [row('en_reborn_hit')]) },
      ], {
        roar: { rootClass: 'EnemySkill', rootAbility: 'EmptyAnimatedAbility', inModes: ['Default'], uses: [
          { role: 'start', keys: ['roar_start'], from: 'EnemySkill._beginEffect', node: 'Roar' },
          { role: 'loop', keys: ['roar_loop'], from: 'BuffDuringSkill._buffs', node: 'Roar', on: 'owner' },
          { role: 'end', keys: ['roar_end'], from: 'EnemySkill._endEffect', node: 'Roar' },
        ] },
      }),
      enemy_603_bash: unit('enemy', [{ name: 'Default', attack: null, combat: melee([], [row('en_combat_hit')]) }, { name: 'Reborn', attack: null, combat: melee([], [row('en_reborn_hit')]) }], {
        bash: { rootClass: 'EnemySkill', rootAbility: 'MeleeAttack', inModes: ['Reborn', 'Default'], uses: [
          { role: 'start', keys: ['bash_cast'], from: 'UberEffectEmitter._castEffects', node: 'Bash', ability: 'MeleeAttack', startEvent: 'ON_SPELL_ON', oneshot: true, list: 'cast', mode: 'Default' },
          { role: 'start', keys: ['bash_reborn'], from: 'UberEffectEmitter._castEffects', node: 'Bash', ability: 'MeleeAttack', startEvent: 'ON_SPELL_ON', oneshot: true, list: 'cast', mode: 'Reborn' },
        ] },
      }),
      enemy_601_two: unit('enemy', [{ name: 'Default', attack: null, combat: melee([], []) }], {
        one: { rootClass: 'EnemySkill', uses: [{ role: 'start', keys: ['two_a'], from: 'EnemySkill._beginEffect', node: 'One' }] },
        two: { rootClass: 'EnemySkill', uses: [{ role: 'start', keys: ['two_b'], from: 'EnemySkill._beginEffect', node: 'Two' }] },
      }),
      // an emitter bound to a mode and a VigilWolf row bound to a buff
      enemy_602_icm: unit('enemy', [
        { name: 'Default', attack: null, combat: melee([], [row('icm_hit', { emitter: 0 }), row('wolf_plain', { emitter: 1 }), row('wolf_buff', { emitter: 1, field: '_vigilWolfCastEffects', buffKey: 'x_enhance' })],
          { emitters: [{ class: 'UberEffectEmitterInCertainMode', activeMode: 1 }, { class: 'VigilWolfEffectEmitter' }] }) },
        { name: 'M2', attack: null, combat: melee([], [row('icm_hit', { emitter: 0 })], { emitters: [{ class: 'UberEffectEmitterInCertainMode', activeMode: 1 }] }) },
      ]),
      token_700_tok: unit('token', [{ name: 'Default', attack: null }], { sktok_tok: { rootClass: 'CastTokenSkill', uses: [{ role: 'loop', keys: ['tok_loop'], from: 'BuffDuringSkill._buffs', node: 'Tok', on: 'owner' }] } }),
      // the 秘术师's chargeable group as index v2 writes it
      char_469_indigo: unit('char', [{ name: 'Default', attack: { class: 'MultiChargeRangedAttack', projectileKey: 'proj_ind', cast: [], charge: { group: 0, ability: 0 } } }], {}, {
        charge: [{ node: 'Trait/ChargableAttackGroup', class: 'AbilityChargeableGroup', maxChargeTimes: 3,
          emitters: [{ class: 'MultiChargeUberEffectEmitter', chargeEffectGroups: ['ind_02', 'ind_03', 'ind_04', 'ind_05'].map((k) => [row(k, { startEvent: 4 })]) }],
          abilities: [{ node: 'Trait/ChargableAttackGroup/ChargeAttackDefault', class: 'ChargeRangedAttack', modes: ['Default', 'Default_T1'], projectileKey: 'proj_ind',
            mountPointForProjectiles: [6, 8, 9, 5], mounts: ['SPECIAL_1', 'SPECIAL_2', 'SPECIAL_3', 'SPECIAL_0'],
            emitters: [{ class: 'MultiChargeUberEffectEmitter', chargeEffectGroups: [0, 1, 2, 3].map(() => [row('ind_start', { startEvent: 2 })]) }] },
          { node: 'Trait/ChargableAttackGroup/ChargeAttackS1', class: 'ChargeRangedAttack', modes: ['S1'], projectileKey: 'PROJ_IND_S1', mountPointForProjectiles: [6, 8, 9, 5], emitters: [] }] }],
      }),
    },
    skills: {
      skchr_grp_1: { mode: 1, uses: [], rootClass: 'CastSkill' }, skchr_grp_2: { mode: 2, uses: [], rootClass: 'CastSkill' },
      sktok_tok: { rootClass: 'CastTokenSkill', uses: [{ role: 'loop', keys: ['tok_loop'], from: 'BuffDuringSkill._buffs', node: 'Tok', on: 'owner' }] },
      skchr_rep_1: { rootClass: 'ReplacementSkill', uses: [] },
      skchr_kb_1: { rootClass: 'CastSkill', uses: [
        { role: 'hit', keys: ['skb_1'], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'sk', ability: 'MultiMeleeAttack', list: 'hit', group: 0, groups: 1 },
        { role: 'hit', keys: ['skb_base'], from: 'MultiHitUberEffectEmitter._hitEffects', node: 'sk', ability: 'MultiMeleeAttack', list: 'hit' },
        { role: 'hit', keys: ['mh_plain'], from: 'UberEffectEmitter._hitEffects', node: 'sk', ability: 'MultiMeleeAttack', list: 'hit' },
      ] },
      skchr_v2_1: { rootClass: 'CastSkill', uses: [
        { role: 'hit', keys: ['mh_hit_1'], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'sk', ability: 'MultiMeleeAttack', list: 'hit', group: 0, groups: 3, useLoopHitEffect: 1 },
        { role: 'hit', keys: ['mh_hit_3'], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'sk', ability: 'MultiMeleeAttack', list: 'hit', group: 2, groups: 3, useLoopHitEffect: 1 },
        { role: 'loop', keys: ['ind_02'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner' },
      ] },
    },
    projectiles: {
      proj_par: { main: 'par_trail', effects: ['par_trail'] }, proj_sel: { main: 'sel_trail', effects: ['sel_trail'] }, proj_en: { main: 'en_trail', effects: ['en_trail'] },
      proj_ind: { main: 'ind_trail', effects: ['ind_trail'] }, proj_ind_s1: { main: 'ind_trail', effects: ['ind_trail'] },
    },
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: { char: 'g_die', enemy: 'g_die' }, birth: {}, status: {} },
    prefabs,
  };
}

const RECS = {
  enemy_600_blk: { skills: [{ prefabKey: 'Roar', cooldown: 10 }] },
  enemy_603_bash: { skills: [{ prefabKey: 'Bash', cooldown: 10 }] },
  enemy_601_two: { skills: [{ prefabKey: 'One' }, { prefabKey: 'Two' }] },
};

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
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x, y: 10, z: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0, anim: 0, sp: 0, spMax: 0, energy: null,
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : /^token_/.test(key) ? 'token' : 'op', skillIndex: o.skill ?? 0 }, ...o.v };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, ofx, spawned, handles, view, views, frame, index };
}

const count = (list, k) => list.filter((x) => x === k).length;

describe('mode attacks of index v2', () => {
  test('MultiHit groups: hit k plays group min(k, last) (an empty group plays nothing), a plain emitter\'s row every hit', async () => {
    const { w, spawned, view, frame } = await setup();
    const a = view(1, 'char_500_mh', 5), t = view(2, 'enemy_601_two', 6);
    frame();
    w.attack(a, t, 'none', 1);
    for (let i = 0; i < 4; i++) w.damage(t, 'phys', a, 1.1);
    assert.deepEqual(spawned.filter((k) => /^mh_hit/.test(k)), ['mh_hit_1', 'mh_hit_3', 'mh_hit_3'], 'hit 2 (the empty group) plays no group row; past the end the last again');
    assert.equal(count(spawned, 'mh_plain'), 4, 'a row without a group plays on every hit');
    assert.ok(!spawned.includes('g_hit'), 'the attack has rows of its own: no generic hit');
    w.damage(t, 'phys', a, 1.3);
    assert.equal(count(spawned, 'mh_plain'), 4, "a later frame's damage is no hit of the blow");
  });

  test('loop: k mod n; random: a seeded pick, the same at every replay; once per target: the first hit only', async () => {
    const run = async (key, n) => {
      const { w, spawned, view, frame } = await setup();
      const a = view(1, key, 5), t = view(2, 'enemy_601_two', 6);
      frame();
      w.attack(a, t, 'none', 1);
      for (let i = 0; i < n; i++) w.damage(t, 'phys', a, 1.1);
      return spawned.filter((k) => !/^g_/.test(k));
    };
    assert.deepEqual(await run('char_501_loop', 4), ['lp_1', 'lp_2', 'lp_1', 'lp_2']);
    const r1 = await run('char_502_rand', 5), r2 = await run('char_502_rand', 5);
    assert.deepEqual(r1, r2, 'deterministic');
    assert.equal(r1.length, 5);
    assert.ok(r1.every((k) => /^rd_\d$/.test(k)));
    assert.deepEqual(await run('char_505_once', 3), ['once_1']);
    assert.deepEqual([0, 1, 2, 3].map((k) => pickGroup([['a'], ['b']], k, { loop: true })[0]), ['a', 'b', 'a', 'b']);
    assert.deepEqual(pickGroup([['a'], [], ['c']], 1, {}), []);
    assert.equal(seedOf(7, 3), seedOf(7, 3));
  });

  test('UberAnimation: loopType 0 (LOOP) plays its groups in turn by attack, 1 (RANDOM) a seeded pick — the same at every replay', async () => {
    const run = async () => {
      const { w, spawned, view, frame } = await setup();
      const a = view(1, 'char_503_anim', 5), t = view(2, 'enemy_601_two', 6);
      for (let i = 0; i < 6; i++) { frame(); w.attack(a, t, 'none', i); }
      return spawned;
    };
    const s1 = await run();
    assert.deepEqual(s1.filter((k) => /^an_/.test(k)), ['an_1', 'an_2', 'an_1', 'an_2', 'an_1', 'an_2']);
    const r = s1.filter((k) => /^b0_/.test(k));
    assert.equal(r.length, 6, 'one group a attack');
    assert.ok(new Set(r).size > 1, `random over six attacks: ${r}`);
    assert.deepEqual((await run()).filter((k) => /^b0_/.test(k)), r, 'deterministic');
  });

  test('sub-abilities: a Random group a seeded pick, a Parallel group all (the shot flies its ranged one\'s projectile), a Selectable group by the attack\'s kind', async () => {
    const { w, spawned, view, frame } = await setup();
    const a = view(1, 'char_504_grp', 5), t = view(2, 'enemy_601_two', 8);
    frame(); w.attack(a, t, 'none', 1);
    assert.equal(spawned.filter((k) => /^gr[ab]_cast$/.test(k)).length, 1, 'one of the random group');
    const p = view(3, 'char_504_grp', 5, { skill: 0 });
    w.skill(p, true);
    frame(); w.attack(p, t, 'arrow', 2);
    assert.ok(spawned.includes('par_m') && spawned.includes('par_r') && spawned.includes('par_trail'), String(spawned));
    const s = view(4, 'char_504_grp', 5, { skill: 1 });
    w.skill(s, true);
    frame(); w.attack(s, t, 'arrow', 3);
    assert.ok(spawned.includes('sel_r') && spawned.includes('sel_trail') && !spawned.includes('sel_m'), 'a shot: the ranged one');
    frame(); w.attack(s, t, 'none', 4);
    assert.ok(spawned.includes('sel_m'), 'a blow: the melee one');
    const kinds = pickAttacks({ class: 'AbilityRandomGroup', abilities: [{ class: 'RangedAttack' }, { class: 'MeleeAttack' }, { class: 'MeleeAttack', n: 2 }] }, { ranged: false }, 5);
    assert.ok(kinds.length === 2 && kinds[1].class === 'MeleeAttack', 'the pick is among the melee ones');
  });

  test("an enemy's combat: its blocked melee blow; its shot when free; a form naming a mode (Reborn) fights in it", async () => {
    const { w, spawned, view, frame } = await setup();
    const e = view(1, 'enemy_600_blk', 6), o = view(2, 'char_500_mh', 4);
    frame(); w.attack(e, o, 'arrow', 1);
    assert.ok(spawned.includes('en_shot') && spawned.includes('en_trail'));
    e.flags = BLOCKED;
    frame(); w.attack(e, o, 'none', 2);
    assert.ok(spawned.includes('en_combat_cast'));
    w.damage(o, 'phys', e, 2.1);
    assert.equal(spawned.at(-1), 'en_combat_hit');
    e.form = 'form2';
    assert.equal(formMode(w.idx.units.enemy_600_blk, 'form2'), 'Reborn');
    frame(); w.attack(e, o, 'none', 3);
    w.damage(o, 'phys', e, 3.1);
    assert.equal(spawned.at(-1), 'en_reborn_hit', 'the Reborn mode has only a combat: played for any blow');
  });

  test("a MultiHit emitter's own rows without a group give way to its groups, unless it keeps them (keepBaseHitEffect)", async () => {
    const run = async (key) => {
      const { w, spawned, view, frame } = await setup();
      const a = view(1, key, 5), t = view(2, 'enemy_601_two', 6);
      frame(); w.attack(a, t, 'none', 1);
      for (let i = 0; i < 2; i++) w.damage(t, 'phys', a, 1.1);
      return spawned.filter((k) => /^kb_/.test(k));
    };
    assert.deepEqual(await run('char_508_kb0'), ['kb_1', 'kb_2']);
    assert.deepEqual(await run('char_509_kb1'), ['kb_base', 'kb_1', 'kb_base', 'kb_2']);
    const p = skillPlan(makeIndex(), null, 'skchr_kb_1');
    assert.deepEqual(p.attacks[0].hit.map((g) => g.map((e) => e.key)), [['skb_1', 'mh_plain']], "a skill's: the same (another emitter's rows stay)");
  });

  test("a heal's own hit rows land on its 'heal' event; a heal without rows of its own plays the generic heal", async () => {
    const { w, spawned, view, frame } = await setup();
    const med = view(1, 'char_506_med', 5), ally = view(2, 'char_500_mh', 6), plain = view(3, 'char_507_plain', 5);
    frame(); w.attack(med, ally, 'none', 1);
    assert.equal(w.heal(ally, 1), true);
    assert.deepEqual(spawned, ['med_cast', 'med_hit']);
    frame(); w.attack(plain, ally, 'none', 2);
    w.heal(ally, 2);
    assert.equal(spawned.at(-1), 'g_heal');
  });

  test('an emitter bound to a mode plays in it only; a row bound to a buff of its owner never', async () => {
    const { w, spawned, view, frame } = await setup();
    const e = view(1, 'enemy_602_icm', 6, { v: { flags: BLOCKED } }), o = view(2, 'char_500_mh', 4);
    frame(); w.attack(e, o, 'none', 1); w.damage(o, 'phys', e, 1.1);
    assert.deepEqual(spawned.filter((k) => !/^g_/.test(k)), ['wolf_plain'], 'mode 0: not the activeMode 1 emitter; never the buff-bound row');
  });
});

describe('enemy and summon skills of index v2', () => {
  test("a single-skill enemy's window: the snapshot's SKILL opens it (start, held loop), its end stops it; death too", async () => {
    const { w, spawned, handles, view, frame, ofx } = await setup();
    const e = view(1, 'enemy_600_blk', 6);
    frame();
    e.anim = SKILL_ANIM; frame();
    assert.deepEqual(spawned, ['roar_start', 'roar_loop']);
    frame(); frame();
    assert.equal(spawned.length, 2, 'once per window');
    e.anim = 0; frame();
    assert.ok(handles.find((h) => h.key === 'roar_loop').alive, 'the grace: a snapshot behind the start does not end it');
    ofx.time += 0.4; frame();
    assert.ok(!handles.find((h) => h.key === 'roar_loop').alive);
    assert.equal(spawned.at(-1), 'roar_end');
    e.anim = SKILL_ANIM; frame();
    w.death(e);
    assert.ok(!handles.filter((h) => h.key === 'roar_loop').some((h) => h.alive), 'death ends the window');
  });

  test("the 'cast' slot names the skill (a two-skill enemy has no window without it); attacks in the window use the skill's rows; a form's mode picks its copy", async () => {
    const { w, spawned, view, frame } = await setup();
    const two = view(1, 'enemy_601_two', 6);
    frame(); two.anim = SKILL_ANIM; frame();
    assert.ok(!spawned.includes('two_a') && !spawned.includes('two_b'), 'which of two? no guess');
    assert.equal(w.enemyCast(two, 1), true);
    assert.equal(spawned.at(-1), 'two_b');
    const b = view(2, 'enemy_603_bash', 6, { v: { flags: BLOCKED } }), o = view(3, 'char_500_mh', 5);
    frame(); w.enemyCast(b, 0);
    assert.equal(w.skills.state(b).plan?.skillId, 'bash', 'the window is open (its rows are attack rows: nothing draws at its start)');
    frame(); w.attack(b, o, 'none', 1);
    assert.ok(spawned.includes('bash_cast') && !spawned.includes('bash_reborn'), 'the Default copy');
    b.form = 'reborn';
    frame(); w.enemyCast(b, 0); frame(); w.attack(b, o, 'none', 2);
    assert.ok(spawned.includes('bash_reborn'), 'the Reborn copy');
  });

  test("a summon's skill: its record's, else the only one its unit has; it plays like an operator's", async () => {
    const { w, spawned, view, frame, index } = await setup();
    assert.equal(resolveSkill(index, { info: { kind: 'token', side: 'ally', defId: 'token_700_tok', spine: 'token_700_tok' } }).via, 'only');
    const t = view(1, 'token_700_tok', 5);
    frame();
    assert.equal(w.skill(t, true), true);
    assert.ok(spawned.includes('tok_loop'));
  });
});

describe('index v2 data in skills.js and mounts.js', () => {
  test('the charge from the index\'s groups: slots, mounts, projectiles by mode — the transcribed table only for a version-1 index', () => {
    const idx = makeIndex();
    const src = chargeFromIndex(idx.units.char_469_indigo.charge, idx.prefabs);
    assert.equal(src.cap, 3);
    assert.deepEqual(src.slots.map((s) => [s.spell, s.cast, s.mount]), [[['ind_02'], ['ind_start'], 6], [['ind_03'], ['ind_start'], 8], [['ind_04'], ['ind_start'], 9], [['ind_05'], ['ind_start'], 5]]);
    assert.deepEqual(src.projectiles, { Default: 'proj_ind', Default_T1: 'proj_ind', S1: 'proj_ind_s1' });
    assert.deepEqual(chargeSource(idx, 'char_469_indigo'), src, "version 2: the index's groups");
    const p = chargePlan(idx, 'char_469_indigo');
    assert.deepEqual(p.byCount[2], ['ind_02', 'ind_03']);
    assert.deepEqual(p.onGain[1], ['ind_start']);
    assert.deepEqual(p.onRelease.mountTypes, [6, 8, 9, 5]);
    const v1 = { units: { char_469_indigo: { modes: [] } }, prefabs: {}, projectiles: {} };
    assert.equal(chargeSource(v1, 'char_469_indigo'), CHARGE_EMITTERS.char_469_indigo, 'version 1: the table');
  });

  test('skills: exported groups kept (an empty one too), rootClass kind, group / anim / mode copied, placement from the prefab summary', () => {
    const idx = makeIndex();
    assert.deepEqual(hitGroups([{ key: 'a', group: 0, groups: 3 }, { key: 'c', group: 2, groups: 3 }]).map((g) => g.map((r) => r.key)), [['a'], [], ['c']]);
    assert.deepEqual(hitGroups([{ key: 'h1' }, { key: 'h_range_1' }, { key: 'h2' }]).map((g) => g.map((r) => r.key)), [['h1', 'h_range_1'], ['h2']], 'version 1: the _range rule');
    const p = skillPlan(idx, null, 'skchr_v2_1');
    assert.deepEqual(p.attacks[0].hit.map((g) => g.map((e) => e.key)), [['mh_hit_1'], [], ['mh_hit_3']]);
    assert.deepEqual(p.attacks[0].hitOpts, { indexed: true, loop: true, random: false, once: false });
    assert.equal(p.attacks[0].hit[0][0].group, 0);
    assert.deepEqual([p.loop[0].point, p.loop[0].follow], ['MP_SPECIAL_1', 'SPECIAL_1']);
    assert.equal(skillPlan(idx, null, 'skchr_rep_1', { rec: { skillType: 'MANUAL', duration: 20 } }).kind, 'instant', 'a ReplacementSkill is one cast');
    assert.deepEqual(skillPlan(idx, 'enemy_603_bash', 'bash', { mode: 'Reborn' }).attacks[0].cast.map((e) => e.key), ['bash_reborn'], "a copy's rows by its mode");
    assert.deepEqual(skillPlan(idx, 'enemy_603_bash', 'bash').attacks[0].cast.map((e) => e.key), ['bash_cast']);
  });

  test('skinShift has nothing to move for an index of version 2', () => {
    const far = { points: { HitPoint: { all: { pos: [3, 3, -0.3] } } } };
    setIndexVersion(1);
    assert.ok(skinShift(far), 'version 1: the heuristic moves it back');
    setIndexVersion(2);
    assert.equal(skinShift({ points: { HitPoint: { all: { pos: [3, 3, -0.3] } } } }), null);
    setIndexVersion(1);
  });

  test('keysFor preloads combats, sub-abilities, enemy skills with their mode copies and the charge', async () => {
    const { w, view } = await setup();
    const keys = w.keysFor([view(1, 'enemy_600_blk', 6), view(2, 'char_504_grp', 5), view(3, 'enemy_603_bash', 6), view(4, 'char_469_indigo', 5)]);
    for (const k of ['en_combat_hit', 'en_reborn_hit', 'gra_cast', 'par_trail', 'sel_trail', 'roar_loop', 'bash_cast', 'bash_reborn', 'ind_02', 'ind_start']) assert.ok(keys.includes(k), k);
  });
});
