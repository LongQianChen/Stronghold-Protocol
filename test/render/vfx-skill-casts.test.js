// test/render/vfx-skill-casts.test.js — round 46's skill-plan fixes (history §32.14.43, DESIGN §33.16) on a synthetic
// index and a fake effects layer: a buff template's facing variants are one effect picked by the owner's facing (仇白 S2,
// R7); a lasting skill's own cast at its start is no normal attack (缄默德克萨斯 S2's appear strike, R8); the kit's hits of
// a skill without an attack event, the final attack at the skill's end, an instant attack of another kind, a
// ReplacementSkill's attack after its 0, a kit fx bound to a plan attack (R13).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { skillPlan, dirFamilies, planKeys } from '../../public/js/render/vfx/skills.js';

const KEYS = ['wind', 'wind_up', 'wind_down', 'wind_left', 'aura_back', 'aura_front', 'other_buff', 'appear_dome', 'appear_dome_02',
  's2_mode_cast', 's2_mode_hit', 'def_cast', 'def_hit', 'nova_cast', 'nova_hit', 'mend_cast', 'mend_hit', 'fin_cast', 'fin_hit', 'beam_cast',
  'beam_aim', 'beam_hit', 'rep_cast', 'rep_hit', 'slash_cast', 'end_cast', 'end_hit', 'g_hit', 'g_heal', 'g_enemy'];
const LOOPING = new Set(['wind', 'wind_up', 'wind_down', 'wind_left', 'other_buff']);
const blow = (k, ev = 2) => ({ effects: [k], oneshot: 1, startEvent: ev, endEvent: 3, directionType: 0 });
const cast = (k, node, ability, extra = {}) => ({ role: 'start', keys: [k], from: 'UberEffectEmitter._castEffects', node, ability, startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast', ...extra });
const hit = (k, node, ability, extra = {}) => ({ role: 'hit', keys: [k], from: 'UberEffectEmitter._hitEffects', node, ability, endEvent: 'ON_CAST_END', oneshot: true, list: 'hit', ...extra });
const wind = (k) => ({ role: 'loop', keys: [k], from: 'BuffToOwner._buffs → template t[sword_wind_effect]', event: 'ON_BUFF_START', action: 'CreateBuff', on: 'owner', buff: 'b[sword_wind_effect]', node: 'split' });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const skills = {
    // 仇白 S2: four branches of one template (the plain key is RIGHT), and an unrelated buff of the same skill
    skchr_wind_2: { mode: 1, rootAbility: 'AbilitySequenceGroup', projectiles: [], uses: [wind('wind_up'), wind('wind_down'), wind('wind'), wind('wind_left'),
      { role: 'loop', keys: ['other_buff'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner', buff: 'x' },
      hit('nova_hit', 'split', 'MeleeAttack')] },
    // 缄默德克萨斯 S2: a passive appear skill whose sequence's MeleeAttack is the appear strike; the mode S2 attacks
    skchr_appear_2: { mode: 1, rootClass: 'MultiAppearSkill', rootAbility: 'AbilitySequenceGroup', projectiles: [], uses: [
      cast('appear_dome', 'Damage', 'MeleeAttack'), cast('appear_dome_02', 'Damage', 'MeleeAttack')] },
    // an instant CastSkill whose kit deals the damage (no 'atk'): a melee ability's cast and hit
    skchr_nova_1: { mode: null, rootClass: 'CastSkill', rootAbility: 'MeleeAttack', projectiles: [], uses: [cast('nova_cast', 'sk', 'MeleeAttack'), hit('nova_hit', 'sk', 'MeleeAttack')] },
    // an instant CastSkill heal of the kit's
    skchr_mend_2: { mode: null, rootClass: 'CastSkill', rootAbility: 'Heal', projectiles: [], uses: [cast('mend_cast', 'sk', 'Heal'), hit('mend_hit', 'sk', 'Heal')] },
    // a lasting skill with a final attack at its end
    skchr_fin_3: { mode: 2, rootClass: 'CastSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], uses: [
      { role: 'end', keys: ['fin_cast'], from: 'UberEffectEmitter._castEffects', node: 'FinalAttack', ability: 'MeleeAttack', startEvent: 'ON_SPELL_ON', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
      hit('fin_hit', 'FinalAttack', 'MeleeAttack')] },
    // an instant ReplacementSkill whose MeleeAttack the sim makes a 'beam': cast, aim and hit
    skchr_beam_1: { mode: null, rootClass: 'ReplacementSkillFixed', rootAbility: 'MeleeAttack', projectiles: [], uses: [
      cast('beam_cast', 'sk', 'MeleeAttack'), hit('beam_aim', 'sk', 'MeleeAttack', { list: 'castTarget', from: 'UberEffectEmitter._castTargetEffects' }), hit('beam_hit', 'sk', 'MeleeAttack')] },
    // an instant ReplacementSkill heal whose replaced attack comes after the skill's 0
    skchr_rep_1: { mode: null, rootClass: 'ReplacementSkill', rootAbility: 'Heal', projectiles: [], uses: [cast('rep_cast', 'sk', 'Heal'), hit('rep_hit', 'sk', 'Heal')] },
    // 锏 S3: the kit's 'slash' fx is the Damage ability (FX_BINDINGS), the finale its EndAttack
    skchr_blkkgt_3: { mode: null, rootClass: 'CastSkill', rootAbility: 'AbilitySequenceGroup', projectiles: [], uses: [
      cast('end_cast', 'EndAttack', 'RangedAttack'), hit('end_hit', 'EndAttack', 'RangedAttack'), cast('slash_cast', 'Damage', 'MultiMeleeAttack')] },
  };
  const modes = [
    { name: 'Default', attack: { class: 'MeleeAttack', cast: [blow('def_cast')], hit: [{ effects: ['def_hit'], directionType: 0 }] } },
    { name: 'S2', attack: { class: 'MultiMeleeAttack', cast: [blow('s2_mode_cast')], hit: [{ effects: ['s2_mode_hit'], directionType: 0 }] } },
    { name: 'S3', attack: { class: 'MeleeAttack', cast: [], hit: [] } },
  ];
  const unit = (sk) => ({ kind: 'char', modes, skills: Object.fromEntries(sk.map((s) => [s, skills[s]])), startEffect: null, deadEffect: null });
  return {
    units: {
      char_1_wind: unit(['skchr_wind_2']), char_2_appear: unit(['skchr_appear_2']), char_3_nova: unit(['skchr_nova_1']),
      char_4_mend: unit(['skchr_mend_2']), char_5_fin: unit(['skchr_fin_3']), char_6_beam: unit(['skchr_beam_1']), char_7_rep: unit(['skchr_rep_1']),
      char_4116_blkkgt: unit(['skchr_blkkgt_3']),
      enemy_1: { kind: 'enemy', modes: [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], skills: {} },
    },
    skills, projectiles: {}, skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: {}, birth: {}, status: {} },
    prefabs,
  };
}

const rec = (charId, skillId, o = {}) => ({ charId, skill: { skillId, index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 0, bb: {}, ...o } });
const RECS = {
  char_1_wind: rec('char_1_wind', 'skchr_wind_2', { duration: 5 }),
  char_2_appear: rec('char_2_appear', 'skchr_appear_2', { skillType: 'PASSIVE', duration: 10 }),
  char_3_nova: rec('char_3_nova', 'skchr_nova_1'),
  char_4_mend: rec('char_4_mend', 'skchr_mend_2'),
  char_5_fin: rec('char_5_fin', 'skchr_fin_3', { duration: 10 }),
  char_6_beam: rec('char_6_beam', 'skchr_beam_1'),
  char_7_rep: rec('char_7_rep', 'skchr_rep_1'),
  char_4116_blkkgt: rec('char_4116_blkkgt', 'skchr_blkkgt_3'),
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
    const v = { id, x, y: 10, z: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0, sp: 0, spMax: 10, energy: null, dir: enemy ? undefined : (o.dir || 'RIGHT'),
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: 0 } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, spawned, handles, view, frame, index };
}

const count = (spawned, k) => spawned.filter((x) => x === k).length;

describe('a buff template\'s facing variants (R7)', () => {
  test('dirFamilies: one use with slots UP / RIGHT / DOWN / LEFT (a missing facing plays the plain key, else _front)', () => {
    const out = dirFamilies([wind('wind_up'), wind('wind_down'), wind('wind'), wind('wind_left'), { ...wind('other_buff'), buff: 'x' }]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0].slots, ['wind_up', 'wind', 'wind_down', 'wind_left']);
    assert.equal(out[0].keys[0], 'wind');
    assert.equal(out[0].directionType, 5);
    const ab = dirFamilies([wind('aura_back'), wind('aura_front')]);
    assert.deepEqual(ab[0].slots, ['aura_back', 'aura_front', 'aura_front', 'aura_front']);
    // emitter rows, other templates and lone keys stay as they are
    const keep = [cast('wind_up', 'n', 'MeleeAttack'), cast('wind_down', 'n', 'MeleeAttack'), wind('wind_up'), { ...wind('wind_down'), from: 'other template' }];
    assert.deepEqual(dirFamilies(keep), keep);
  });

  test('the plan holds one loop with every variant; a unit plays the one of its deploy direction only', async () => {
    const { index, w, spawned, handles, view, frame } = await setup();
    const p = skillPlan(index, 'char_1_wind', 'skchr_wind_2', { rec: RECS.char_1_wind.skill });
    assert.deepEqual(p.loop.map((e) => e.key), ['wind', 'other_buff']);
    assert.ok(['wind_up', 'wind_down', 'wind_left', 'wind'].every((k) => planKeys(p).includes(k)), 'every variant preloads');
    for (const [id, dir, key] of [[1, 'RIGHT', 'wind'], [2, 'UP', 'wind_up'], [3, 'DOWN', 'wind_down'], [4, 'LEFT', 'wind_left']]) {
      const u = view(id, 'char_1_wind', 5, { dir });
      frame();
      spawned.length = 0;
      w.skill(u, true);
      assert.deepEqual(spawned.filter((k) => k.startsWith('wind')), [key], dir);
      assert.equal(handles.filter((h) => h.key === key && h.alive && h.opts.loop).length >= 1, true, `${dir}: held for the skill`);
    }
  });
});

describe('a lasting skill\'s own cast at its start (R8)', () => {
  test('the appear strike plays once at the passive\'s start; the attacks while on are the mode\'s, with its hits', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_2_appear', 5);
    const t = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    w.deploy(u);
    assert.equal(count(spawned, 'appear_dome'), 1);
    assert.equal(count(spawned, 'appear_dome_02'), 1);
    for (let i = 0; i < 3; i++) {
      frame();
      w.attack(u, t, 'none', i + 1);
      w.damage(t, 'arts', u, i + 1);
    }
    assert.equal(count(spawned, 'appear_dome'), 1, 'never again on an attack');
    assert.equal(count(spawned, 's2_mode_cast'), 3, 'the S2 mode casts');
    assert.equal(count(spawned, 's2_mode_hit'), 3, 'and hits (not the generic hit)');
    assert.equal(count(spawned, 'g_hit'), 0);
  });
});

describe('kit hits of a skill without an attack event (R13)', () => {
  test('an instant CastSkill: its cast once, its hit on every enemy the kit damaged between 1 and 0 (not a claimed one)', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_3_nova', 5);
    const a = view(2, 'enemy_1', 6), b = view(3, 'enemy_1', 7), c = view(4, 'enemy_1', 8);
    const mate = view(5, 'char_2_appear', 4);
    frame();
    // another unit's blow waits on c: its damage is that blow's
    w.attack(mate, c, 'none', 1);
    w.skill(u, true);
    w.damage(a, 'arts', null, 1);
    w.damage(b, 'arts', null, 1);
    w.damage(b, 'arts', null, 1);
    w.damage(c, 'phys', null, 1);
    w.damage(mate, 'phys', null, 1);   // the owner's side: no hit of its damage
    w.skill(u, false);
    assert.equal(count(spawned, 'nova_cast'), 1);
    assert.equal(count(spawned, 'nova_hit'), 3, 'a once, b twice (every HP hit of a plain attack)');
    frame();
    assert.equal(count(spawned, 'nova_hit'), 3, 'nothing more at the frame\'s end');
    // a later frame's damage is no hit of it
    w.damage(a, 'arts', null, 2);
    frame();
    assert.equal(count(spawned, 'nova_hit'), 3);
  });

  test('a kit heal between 1 and 0 is the heal ability\'s hit; the normal heal after the 0 stays the attack\'s', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_4_mend', 5);
    const pat = view(2, 'char_2_appear', 6);
    frame();
    w.skill(u, true);
    w.heal(pat, 1);
    w.skill(u, false);
    assert.equal(count(spawned, 'mend_cast'), 1);
    assert.equal(count(spawned, 'mend_hit'), 1);
    w.attack(u, pat, 'orb', 1);
    frame();
    assert.equal(count(spawned, 'mend_cast'), 1, 'the attack after a CastSkill\'s 0 is a normal one');
  });

  test('the final attack of a lasting skill: its rows at the 0, its hit on what that frame damaged', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_5_fin', 5);
    const a = view(2, 'enemy_1', 6), b = view(3, 'enemy_1', 7);
    const t = view(4, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    frame();
    // attacks while on use the mode (S3), never the final attack
    w.attack(u, t, 'none', 1);
    w.damage(t, 'phys', u, 1);
    assert.equal(count(spawned, 'fin_cast'), 0);
    assert.equal(count(spawned, 'fin_hit'), 0);
    frame();
    w.damage(a, 'arts', null, 2);
    w.damage(b, 'arts', null, 2);
    w.skill(u, false);
    assert.equal(count(spawned, 'fin_cast'), 1);
    assert.equal(count(spawned, 'fin_hit'), 2);
  });

  test('an instant attack of another kind in the activation frame is the skill\'s (cast, aim, hit)', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_6_beam', 5);
    const t = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    w.attack(u, t, 'beam', 1);
    w.damage(t, 'arts', null, 1);
    w.skill(u, false);
    frame();
    assert.deepEqual(['beam_cast', 'beam_aim', 'beam_hit'].map((k) => count(spawned, k)), [1, 1, 1]);
    assert.equal(count(spawned, 'def_cast'), 0, 'not the mode\'s');
    // outside the activation a beam is a normal attack
    frame();
    w.attack(u, t, 'beam', 2);
    assert.equal(count(spawned, 'beam_cast'), 1);
  });

  test('a ReplacementSkill\'s attack right after its 0 carries the skill (no fallback twice); without one the fallback plays', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_7_rep', 5);
    const pat = view(2, 'char_2_appear', 6);
    frame();
    w.skill(u, true);
    w.skill(u, false);
    w.attack(u, pat, 'none', 1);
    w.heal(pat, 1);
    frame();
    assert.equal(count(spawned, 'rep_cast'), 1);
    assert.equal(count(spawned, 'rep_hit'), 1);
    frame();
    w.skill(u, true);
    w.skill(u, false);
    assert.equal(count(spawned, 'rep_cast'), 1, 'the fallback waits for the frame\'s end');
    frame();
    assert.equal(count(spawned, 'rep_cast'), 2);
  });

  test('a kit fx bound to a plan attack (锏 S3\'s slash): its rows on the owner, the finale at the 0', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_4116_blkkgt', 5);
    const a = view(2, 'enemy_1', 6);
    frame();
    w.skill(u, true);
    frame();
    assert.equal(w.simFx('slash', 5, 10, { id: 1, n: 1 }), true, 'the procedural slash is skipped');
    w.damage(a, 'phys', null, 1);
    frame();
    assert.equal(count(spawned, 'slash_cast'), 1);
    w.damage(a, 'phys', null, 2);
    w.skill(u, false);
    assert.equal(count(spawned, 'end_cast'), 1);
    assert.equal(count(spawned, 'end_hit'), 1);
  });
});
