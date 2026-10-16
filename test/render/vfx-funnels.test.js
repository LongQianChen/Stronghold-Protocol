// test/render/vfx-funnels.test.js — the 驭械术士's floating units (浮游单元, DESIGN §33.18) through render/vfx/funnels.js,
// funnelfx.js and the wiring on a synthetic version-3 index shaped like the client's (round 46): the plan (mode
// attacks' units with their FunnelEffectEmitter loops and hit groups, a general funnel shot with its cast and its
// passive look, a skill's own shot, the dispersed units of a Whitw2Skill3FunnelRangedAttack); home loops that follow
// the Special point where the model draws its bone (mounts.js, DESIGN §32.14.36); an attached attack (the units leave, each lands with its damage after the body hit,
// then comes back); several targets of one attack; a funnel shot from its mount; remote units on the kit's 'drone' fx
// (the hit groups in turn, the overload, the return, the skill's end); the dispersed units ('drones', 'droneLock',
// latch, hits, a lost target, the skill's end, the release without its fx); the kit fx the units stand for (the
// procedural pillar and reticle skipped) and the old look without the effects; a late prefab placed by its summary
// (its FollowMountPoint from the first frame, its rotation once loaded).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { funnelPlan, projectileHits, planKeys, initialCount } from '../../public/js/render/vfx/funnels.js';
import { RETURN_S, LUNGE_S } from '../../public/js/render/vfx/funnelfx.js';
import { mountPoint, SKELETON_TILT } from '../../public/js/render/vfx/mounts.js';

const SKILL = 16;
const P = (o) => ({ looping: false, ...o });
// prefab summaries (index.json prefabs[key]: spawn / follow as the extractor writes them)
const PREFABS = {
  w_tok_1: P({ follow: 5, looping: true }), w_tok_2: P({ follow: 6, looping: true }), w_tok_3: P({ follow: 8, looping: true }),
  w_end_1: P({ follow: 5, spawn: 8 }), w_end_2: P({ follow: 6, spawn: 9 }), w_end_3: P({ follow: 8, spawn: 10 }),
  w_hit_1: P({ spawn: 2 }), w_hit_2: P({ spawn: 2 }), w_hit_3: P({ spawn: 2 }), w_body_trail: P({}), w_body_hit: P({ spawn: 2 }),
  w_trail: P({ looping: true }), w_mark1: P({ spawn: 2, looping: true }), w_mark2: P({ spawn: 7, looping: true }), w_start: P({ spawn: 5, looping: true }),
  u_tok: P({ follow: 6, looping: true }), u_over: P({ follow: 6, looping: true }), u_show: P({ follow: 6 }), u_hide: P({ follow: 6 }),
  u_hit_l: P({ spawn: 2, looping: true }), u_hit_r: P({ spawn: 2, looping: true }), u_hit_lo: P({ spawn: 2, looping: true }), u_hit_ro: P({ spawn: 2, looping: true }),
  u_trail: P({ looping: true }), u_fhit: P({ spawn: 2 }), u_body: P({ looping: true }),
  i_def: P({ follow: 5, looping: true }), i_f1: P({ follow: 5, looping: true }), i_f2: P({ follow: 6, looping: true }), i_b1: P({ follow: 5, looping: true }),
  i_b2: P({ follow: 6, looping: true }), i_show1: P({ follow: 5 }), i_show2: P({ follow: 6 }), i_hide1: P({ follow: 5 }), i_hide2: P({ follow: 6 }),
  i_hl1: P({ spawn: 2, looping: true }), i_hl2: P({ spawn: 2, looping: true }), i_hr1: P({ spawn: 2, looping: true }), i_hr2: P({ spawn: 2, looping: true }),
  i_cast: P({ follow: 5 }), i_trail: P({ looping: true }), i_fhit: P({ spawn: 2 }),
  d_drone: P({ follow: 5, looping: true }), d_trail: P({ looping: true }), d_trail2: P({ looping: true }),
  late_tok: P({ follow: 6, spawn: 0, looping: true }), late_fx: P({ spawn: 0 }),
};

const em = (idle, appear, disappear, o = {}) => ({ class: 'FunnelEffectEmitter', useIdleBackEffect: 0, idleEffect: idle ? [idle] : [], idleBackEffect: [], appearEffect: [appear], disappearEffect: [disappear], useOverloadEffect: 0, overloadIdleEffect: [], ...o });
const seq = (groups, o = {}) => ({ class: 'SequenceEffectBehaviour', fields: { _effectGroups: groups.map((g) => ({ effectsWhenHit: g })), ...o } });
const attach = (o = {}) => ({ class: 'AttachToTarget', fields: { _mountPointType: 1, _checkReached: 1, ...o } });
const flightP = (main, onHit = []) => ({ main, movement: { class: 'AdvancedMovement' }, behaviours: [], onHit, effects: [main, ...onHit] });

function makeIndex() {
  return {
    format: 'fx-index', version: 3,
    units: {
      // 荒芜拉普兰德-like: three attached units in Default and S1, six-less S2 units without a home loop, S3 dispersed
      char_901_wolf: {
        kind: 'char', skin: 'char_901_wolf', talentKeys: { base: {} },
        modes: [
          { name: 'Default', attack: { class: 'MultiFunnelsNormalAttack', projectileKey: 'p_body', mount: 'MUZZLE', cast: [], hit: [],
            abilities: [1, 2, 3].map((i) => ({ class: 'MultiFunnelNormalAttack', projectileKey: `p_f${i}`, mount: i === 2 ? 'SPECIAL_1' : 'SPECIAL_0', node: `Default/Funnel${i}`,
              emitters: [em(`w_tok_${i}`, `w_end_${i}`, `w_end_${i}`, { setActiveFalseWhenPause: 1 })] })) } },
          { name: 'S1', attack: { class: 'MultiFunnelRemoteAttack', projectileKey: 'p_body', cast: [], hit: [],
            abilities: [1, 2, 3].map((i) => ({ class: 'RangedAttack', projectileKey: `p_s1_${i}`, mount: 'MUZZLE', node: `S1/S1Funnel${i}`, emitters: [em(`w_tok_${i}`, `w_end_${i}`, `w_end_${i}`)] })) } },
          { name: 'S2', attack: { class: 'MultiFunnelRemoteAttack', projectileKey: 'p_body', cast: [], hit: [],
            abilities: [1, 2, 3].map((i) => ({ class: 'RangedAttack', projectileKey: `p_s2_${i}`, mount: 'MUZZLE', node: `S2/S2Funnel${i}` })) } },
          { name: 'S3', attack: { class: 'RangedAttack', projectileKey: 'p_body', cast: [], hit: [] } },
        ],
        abilities: [{ kind: 'general', name: 'WolvesDispersed', node: 'S3/WolvesDispersed', class: 'Whitw2Skill3FunnelRangedAttack', modes: ['S3'], when: null,
          projectiles: ['p_s3_1', 'p_s3_1_attach', 'p_s3_2', 'p_s3_2_attach'],
          uses: [{ role: 'loop', keys: ['w_start'], from: 'BuffToOwner._buffs', on: 'owner', life: { type: 'LIMITED', time: 3, key: 'fixed_duration' } }],
          abilities: [{ class: 'RangedAttack', projectileKey: '' }] }],
        skills: {
          skchr_wolf_1: { rootClass: 'ToggleSkill', mode: 1, uses: [] },
          skchr_wolf_2: { rootClass: 'CastSkill', mode: 2, uses: [] },
          skchr_wolf_3: { rootClass: 'CastSkill', mode: 3, uses: [] },
        },
      },
      // 洛洛-like: a funnel shot in Default with its passive look; one remote unit in S2 (an overload look and hits)
      char_902_uav: {
        kind: 'char', skin: 'char_902_uav', talentKeys: { base: {} },
        modes: [
          { name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'p_rbody', cast: [], hit: [] } },
          { name: 'S2', attack: { class: 'MultiFunnelRemoteAttack', projectileKey: 'p_rbody', cast: [], hit: [],
            abilities: [{ class: 'RangedAttack', projectileKey: 'p_rs2', mount: 'MUZZLE', node: 'S2/S2Funnel',
              emitters: [em('u_tok', 'u_show', 'u_hide', { useOverloadEffect: 1, overloadIdleEffect: ['u_over'] })] }] } },
        ],
        abilities: [
          { kind: 'general', name: 'Effect', node: 'Default/GeneralAbilities/Effect', class: 'PassiveBuffAbility', modes: ['Default'], when: 'passive',
            uses: [{ role: 'loop', keys: ['u_tok'], from: 'PassiveBuffAbility._buffs', on: 'owner', node: 'Default/GeneralAbilities/Effect', life: { type: 'INFINITY' } }] },
          { kind: 'general', name: 'Funnel', node: 'Default/GeneralAbilities/Funnel', class: 'MultiFunnelNormalAttack', modes: ['Default'], when: null,
            triggers: [{ event: 'ON_ABILITY_CAST_ON_TARGET', action: 'TriggerAbility', name: 'Funnel' }], projectiles: ['p_rfun'], uses: [],
            abilities: [{ class: 'MultiFunnelNormalAttack', projectileKey: 'p_rfun', mount: 'SPECIAL_1', node: 'Default/GeneralAbilities/Funnel' }] },
        ],
        skills: { skchr_uav_2: { rootClass: 'CastSkillWithSuspendable', mode: 1, uses: [] } },
      },
      // 耶拉-like: two remote units in S2 (back loops), a funnel shot with a cast on her token
      char_903_ice: {
        kind: 'char', skin: 'char_903_ice', talentKeys: { base: {} },
        modes: [
          { name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'p_ibody', cast: [], hit: [] } },
          { name: 'S2', attack: { class: 'MultiFunnelRemoteAttack', projectileKey: 'p_ibody', cast: [], hit: [],
            abilities: [1, 2].map((i) => ({ class: 'RangedAttack', projectileKey: `p_is2_${i}`, mount: 'MUZZLE', node: `S2/Funnel_${i - 1}`,
              emitters: [em(`i_f${i}`, `i_show${i}`, `i_hide${i}`, { useIdleBackEffect: 1, idleBackEffect: [`i_b${i}`] })] })) } },
        ],
        abilities: [
          { kind: 'general', name: 'Effect', node: 'Default/Effect', class: 'PassiveBuffAbility', modes: ['Default'], when: 'passive',
            uses: [{ role: 'loop', keys: ['i_def'], from: 'PassiveBuffAbility._buffs', on: 'owner', node: 'Default/Effect', life: { type: 'INFINITY' } }] },
          { kind: 'general', name: 'Funnel', node: 'Default/Body/Funnel', class: 'MultiFunnelNormalAttack', modes: ['Default'], when: null, projectiles: ['p_ifun'],
            uses: [{ role: 'loop', keys: ['i_cast'], from: 'UberEffectEmitter._castEffects', node: 'Default/Body/Funnel', ability: 'MultiFunnelNormalAttack', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: false, list: 'cast' }],
            abilities: [{ class: 'MultiFunnelNormalAttack', projectileKey: 'p_ifun', mount: 'SPECIAL_0' }] },
        ],
        skills: { skchr_ice_2: { rootClass: 'CastSkill', mode: 1, uses: [] } },
      },
      // 至简-like: a funnel shot, a skill whose own funnel ability shoots from another point
      char_904_dro: {
        kind: 'char', skin: 'char_904_dro', talentKeys: { base: {} },
        modes: [{ name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'p_dbody', cast: [], hit: [] } }],
        abilities: [
          { kind: 'general', name: 'Effect', node: 'Default/GeneralAbilities/Effect', class: 'PassiveBuffAbility', modes: ['Default'], when: 'passive',
            uses: [{ role: 'loop', keys: ['d_drone'], from: 'PassiveBuffAbility._buffs', on: 'owner', node: 'Default/GeneralAbilities/Effect', life: { type: 'INFINITY' } }] },
          { kind: 'general', name: 'Funnel', node: 'Default/GeneralAbilities/Funnel', class: 'MultiFunnelNormalAttack', modes: ['Default'], when: null, projectiles: ['p_dfun'], uses: [],
            abilities: [{ class: 'MultiFunnelNormalAttack', projectileKey: 'p_dfun', mount: 'SPECIAL_0' }] },
        ],
        skills: { skchr_dro_2: { rootClass: 'ReplacementSkillFixed', mode: null, uses: [],
          abilities: [{ class: 'MultiRangedAttack', projectileKey: 'p_dbody', mount: 'MUZZLE' }, { node: 'Funnel_s2', class: 'MultiFunnelNormalAttack', projectileKey: 'p_dfun2', mount: 'SPECIAL_2' }] } },
      },
      enemy_905_dummy: { kind: 'enemy', modes: [{ name: 'Default', attack: null, combat: null }], skills: {} },
    },
    projectiles: {
      p_body: flightP('w_body_trail', ['w_body_hit']),
      ...Object.fromEntries([1, 2, 3].map((i) => [`p_f${i}`, { main: null, movement: null, onHit: [`w_hit_${i}`], effects: [`w_hit_${i}`],
        behaviours: [attach({ _delayAfterReached: 1, _delayTime: 0.5 }), { class: 'EffectBehaviour', fields: { _effectsWhenHit: [`w_hit_${i}`] } }] }])),
      ...Object.fromEntries([1, 2, 3].map((i) => [`p_s1_${i}`, { main: null, movement: null, onHit: [], effects: [`w_hit_${i}`], behaviours: [attach({ _immediatelyReach: 1 }), seq([[`w_hit_${i}`]])] }])),
      ...Object.fromEntries([1, 2, 3].map((i) => [`p_s2_${i}`, { main: null, movement: null, onHit: [], effects: [`w_hit_${i}`], behaviours: [attach({ _keepUpdate: 1 }), seq([[`w_hit_${i}`]])] }])),
      ...Object.fromEntries([1, 2].map((i) => [`p_s3_${i}`, { main: 'w_trail', movement: { class: 'GroupedMovement' }, onHit: [], effects: ['w_trail', 'w_mark1'],
        behaviours: [{ class: 'GroupedMovement', fields: {} },
          { class: 'HoveringInPlaceMovement', fields: { _speed: 1, _radius: 1.25 } },
          { class: 'AdvancedMovement', fields: { _speed: 2, _useDynamicSpeed: 1, _deltaSpeedPerSec: 1, _finalSpeed: 4 } },
          { class: 'AdvancedMovement', fields: { _awayFromSourceAsDirection: 1, _speed: 0.1, _useDynamicSpeed: 1, _deltaSpeedPerSec: 1.9, _finalSpeed: 2 } },
          { class: 'MovementSwitchControllerForWhitw2', fields: { _traceTargetBuff: { overrideEffectKey: 'w_mark1' }, _randomOffsetMin: [-0.75, -0.75, 0], _randomOffsetMax: [0.75, 0.75, 0] } }] }])),
      ...Object.fromEntries([1, 2].map((i) => [`p_s3_${i}_attach`, { main: null, movement: null, onHit: [], effects: [`w_hit_${i}`, 'w_mark2'],
        behaviours: [{ class: 'SimpleProjectile', fields: { _actionController: { _extraBuffsInTheEnd: [{ overrideEffectKey: 'w_mark2' }] } } }, attach({ _immediatelyReach: 1, _followTarget: 1 }), seq([[`w_hit_${i}`]])] }])),
      p_rbody: flightP('u_body'),
      p_rfun: flightP('u_trail', ['u_fhit']),
      p_rs2: { main: null, movement: null, onHit: [], effects: ['u_hit_l', 'u_hit_r', 'u_hit_lo', 'u_hit_ro'],
        behaviours: [seq([['u_hit_l'], ['u_hit_r']], { _enableOverloadEffect: 1, _overloadGroups: [{ effectsWhenHit: ['u_hit_lo'] }, { effectsWhenHit: ['u_hit_ro'] }] }), attach()] },
      p_ibody: flightP('u_body'),
      p_ifun: flightP('i_trail', ['i_fhit']),
      p_is2_1: { main: null, movement: null, onHit: [], effects: ['i_hl1', 'i_hl2'], behaviours: [attach(), seq([['i_hl1'], ['i_hl2']])] },
      p_is2_2: { main: null, movement: null, onHit: [], effects: ['i_hr1', 'i_hr2'], behaviours: [attach(), seq([['i_hr1'], ['i_hr2']])] },
      p_dbody: flightP('u_body'),
      p_dfun: flightP('d_trail'),
      p_dfun2: flightP('d_trail2'),
    },
    skills: {},
    skins: Object.fromEntries(['char_901_wolf', 'char_902_uav', 'char_903_ice', 'char_904_dro'].map((k) => [k, { points: {
      HitPoint: { all: { pos: [0, 0.232, -0.25], bone: null } },
      Muzzle: { front: { pos: [0.1, 0.3, -0.3], bone: 'F_Muzzle' }, back: { pos: [0.1, 0.3, -0.3], bone: 'B_Muzzle' } },
      SpecialPoint0: { front: { pos: [-0.5, 0.35, -0.32], bone: 'F_Funnel_1' }, back: { pos: [-0.5, 0.35, -0.32], bone: 'B_Funnel_1' } },
      SpecialPoint1: { front: { pos: [0.3, 0.3, -0.29], bone: 'F_Funnel_2' }, back: { pos: [0.3, 0.3, -0.29], bone: 'B_Funnel_2' } },
      SpecialPoint2: { front: { pos: [-0.35, 0.71, -0.53], bone: 'F_Funnel_3' }, back: { pos: [-0.35, 0.71, -0.53], bone: 'B_Funnel_3' } },
    } }])),
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_hit', heal: 'g_hit' }, die: {}, birth: {}, status: {} },
    prefabs: PREFABS,
  };
}

const RECS = {
  char_901_wolf: { charId: 'char_901_wolf', dmgType: 'arts', skills: [
    { index: 0, skillId: 'skchr_wolf_1', desc: '被动效果：浮游单元+1\n主动触发可以在下列状态和初始状态间切换', bb: { atk: 0.23, 'attack@cnt': 0 }, duration: -1 },
    { index: 1, skillId: 'skchr_wolf_2', desc: '浮游单元+3', bb: { 'attack@cnt': 2 }, duration: 18 },
    { index: 2, skillId: 'skchr_wolf_3', desc: '浮游单元+2', bb: { 'attack@cnt': 1, 'attack@times': 1.3 }, duration: 40 },
  ] },
  char_902_uav: { charId: 'char_902_uav', skills: [{ index: 1, skillId: 'skchr_uav_2', bb: { 'attack@cnt': 0 }, duration: 40 }] },
  char_903_ice: { charId: 'char_903_ice', skills: [{ index: 1, skillId: 'skchr_ice_2', bb: { 'attack@cnt': 1 }, duration: 25 }] },
  char_904_dro: { charId: 'char_904_dro', skills: [{ index: 1, skillId: 'skchr_dro_2', bb: { atk_scale: 1.6, ct: 3 }, duration: 0 }] },
};

/**
 * A view's drawn model as render/units.js UnitView.boneOffset reads it (render/vfx/mounts.js follows a BoneFollower
 * point there, DESIGN §32.14.36): `bones` name → { x (tiles right of the feet, before the facing), up (tiles up the
 * model), angle }, drawn with sign `flip`.
 */
function boneView(bones, flip = 1) {
  return {
    bones,
    boneOffset(names, out) {
      for (const n of names) {
        const b = bones[n];
        if (b) { out.x = b.x * flip; out.up = b.up; out.angle = b.angle ?? 0; out.flip = flip; return out; }
      }
      return null;
    },
  };
}

async function setup({ active = true, missing = [] } = {}) {
  const index = makeIndex();
  const log = [];
  const handles = [];
  const absent = new Set(missing);
  const late = new Set(['late_tok', 'late_fx']);   // prefabs not loaded yet (load(k) brings one in)
  const ofx = {
    active, time: 0, lite: false, tier: 'full', timers: [], ctx: { heightAt: () => 0 },
    lib: {
      has: (k) => !!index.prefabs[k] && !absent.has(k),
      def: (k) => (index.prefabs[k] && !absent.has(k) && !late.has(k) ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn ?? 0,
        follow: Number.isInteger(index.prefabs[k].follow) ? { mount: index.prefabs[k].follow } : null, stats: {} } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = { key, place, opts, stopped: false, effect: null, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      log.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x: o.x ?? 5, y: o.y ?? 5, z: 0, visFacing: 1, isEnemy: enemy, alive: true, flags: 0, anim: 0, hp: 100, maxHp: 100, dir: enemy ? undefined : 'RIGHT',
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: o.skill ?? 0 }, ...o.v };
    views.set(id, v);
    return v;
  };
  const frame = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { w.sync(views.values()); w.tick(); ofx.time += dt; } };
  const live = (k) => handles.filter((h) => h.key === k && h.alive).length;
  const count = (k) => log.filter((x) => x === k).length;
  return { w, ofx, log, handles, view, views, frame, live, count, index, load: (k) => late.delete(k) };
}

describe('the floating units of a unit (funnels.js)', () => {
  test("a mode attack's units: their FunnelEffectEmitter loops, appear / disappear, hit groups, AttachToTarget's delay; a mode without home loops", () => {
    const p = funnelPlan(makeIndex(), 'char_901_wolf');
    assert.deepEqual(Object.keys(p.modes), ['Default', 'S1', 'S2']);
    const d = p.modes.Default;
    assert.equal(d.cls, 'MultiFunnelsNormalAttack');
    assert.equal(d.body, 'p_body');
    assert.equal(d.idle, true);
    assert.deepEqual(d.funnels.map((f) => [f.idle, f.appear, f.disappear, f.mount, f.delay]), [['w_tok_1', 'w_end_1', 'w_end_1', 5, 0.5], ['w_tok_2', 'w_end_2', 'w_end_2', 6, 0.5], ['w_tok_3', 'w_end_3', 'w_end_3', 5, 0.5]]);
    assert.deepEqual(d.funnels[0].hits, [['w_hit_1']]);
    assert.deepEqual(p.modes.S1.funnels[2].hits, [['w_hit_3']], 'SequenceEffectBehaviour groups');
    assert.equal(p.modes.S2.idle, false, 'S2: no FunnelEffectEmitter, nothing at home');
    assert.deepEqual(p.general, []);
    assert.equal(p.idleNodes.size, 0);
  });

  test('dispersed units: flights and their attach hits, the trace and latched marks, the start loop, the client movements', () => {
    const d = funnelPlan(makeIndex(), 'char_901_wolf').dispersed;
    assert.deepEqual(d.modes, ['S3']);
    assert.deepEqual(d.units.map((u) => [u.flight, u.attach, u.main, u.hits]), [['p_s3_1', 'p_s3_1_attach', 'w_trail', [['w_hit_1']]], ['p_s3_2', 'p_s3_2_attach', 'w_trail', [['w_hit_2']]]]);
    assert.deepEqual(d.marks, { trace: 'w_mark1', latched: 'w_mark2' });
    assert.deepEqual(d.start, [{ key: 'w_start', s: 3 }]);
    assert.deepEqual(d.move, { spread: { v0: 0.1, acc: 1.9, max: 2 }, chase: { v0: 2, acc: 1, max: 4 }, hover: { r: 1.25, v: 1 }, offset: 0.75 });
  });

  test('a funnel shot: its projectile, mount and casts; its passive look (the idle nodes); a skill of its own; a remote unit with overload groups', () => {
    const idx = makeIndex();
    const u = funnelPlan(idx, 'char_902_uav');
    assert.deepEqual(u.general.map((g) => [g.name, g.modes, g.mount, g.projectileKey]), [['Funnel', ['Default'], 6, 'p_rfun']]);
    assert.deepEqual(u.general[0].idle, [{ key: 'u_tok', node: 'Default/GeneralAbilities/Effect', mount: 6 }]);
    assert.deepEqual([...u.idleNodes], ['Default/GeneralAbilities/Effect']);
    const f = u.modes.S2.funnels[0];
    assert.deepEqual([f.idle, f.overload, f.hits, f.overloadHits], ['u_tok', 'u_over', [['u_hit_l'], ['u_hit_r']], [['u_hit_lo'], ['u_hit_ro']]]);
    const i = funnelPlan(idx, 'char_903_ice');
    assert.deepEqual(i.general[0].cast, [{ key: 'i_cast', phase: 'start', loop: true }]);
    assert.deepEqual(i.modes.S2.funnels.map((x) => [x.idle, x.back]), [['i_f1', 'i_b1'], ['i_f2', 'i_b2']]);
    const d = funnelPlan(idx, 'char_904_dro');
    assert.deepEqual(d.skills, { skchr_dro_2: { mount: 8, projectileKey: 'p_dfun2' } });
    assert.equal(funnelPlan(idx, 'enemy_905_dummy'), null);
    assert.ok(planKeys(u, idx.projectiles).includes('u_trail') && planKeys(u, idx.projectiles).includes('u_hit_ro'));
  });

  test('projectileHits and initialCount', () => {
    assert.deepEqual(projectileHits({ onHit: ['A'], behaviours: [attach({ _delayAfterReached: 1, _delayTime: 0.5 })] }), { groups: [['a']], overload: null, delay: 0.5, attach: true, main: null });
    assert.deepEqual(projectileHits({ main: 'T', onHit: [], behaviours: [seq([['B_1'], ['C']])] }).groups, [['b_1'], ['c']]);
    assert.equal(initialCount({ desc: '被动效果：浮游单元+1\n…' }, 3), 2);
    assert.equal(initialCount({ desc: '浮游单元+2，攻击力+45%' }, 3), 1);
    assert.equal(initialCount(null, 3), 1);
    assert.equal(initialCount({ desc: '被动效果：浮游单元+4' }, 3), 3, 'capped by the units the mode has');
  });
});

describe('the floating units in a battle (funnelfx.js)', () => {
  test('home: the units float on their Special points (with the point\'s rotation); the S1 passive shows two; the passive look is drawn once (TalentFx leaves it)', async () => {
    const { w, view, frame, live, handles } = await setup();
    const v = view(1, 'char_901_wolf', { skill: 2 });
    w.deploy(v); frame();
    assert.equal(live('w_tok_1'), 1);
    assert.equal(live('w_tok_2'), 0, 'S3 equipped: one unit');
    const h = handles.find((x) => x.key === 'w_tok_1');
    assert.equal(h.opts.loop, true);
    assert.equal(typeof h.opts.track, 'function', 'it follows the point');
    const at = mountPoint(w.idx.skins.char_901_wolf, 5, w.pose(v)).map((x) => +x.toFixed(3));
    assert.deepEqual(h.place.pos.map((x) => +x.toFixed(3)), at, 'on its point from the first frame (FollowMountPoint)');
    assert.equal(h.place.mountRot?.length, 4, "with the point's rotation (no `_keepOriginRotation`)");
    const fx = { anchor: [0, 0, 0] };
    h.opts.track(fx);
    assert.deepEqual(fx.anchor.map((x) => +x.toFixed(3)), at);
    const s1 = view(2, 'char_901_wolf', { skill: 0 });
    w.deploy(s1); frame();
    assert.equal(live('w_tok_1') + live('w_tok_2'), 3, 'the S1 passive "浮游单元+1": two more');
    const u = view(3, 'char_902_uav', { skill: 1 });
    w.deploy(u); frame(3);
    assert.equal(live('u_tok'), 1, 'one loop: FunnelFx draws the passive look, TalentFx does not');
  });

  test('an attached attack: the units leave, each lands with its damage after the body hit, the count grows with the hits, then they come back', async () => {
    const { w, view, frame, live, count, ofx } = await setup();
    const v = view(1, 'char_901_wolf', { skill: 2 });
    const e = view(9, 'enemy_905_dummy', { x: 7, y: 5 });
    w.deploy(v); frame();
    assert.equal(live('w_tok_1'), 1);
    assert.equal(w.attack(v, e, 'drone', 1, false), true);
    assert.equal(count('w_end_1'), 1, 'the unit leaves: its disappear');
    frame();
    assert.equal(live('w_tok_1'), 0, 'not home while out');
    assert.equal(count('w_body_trail'), 1, 'the body shot flies');
    w.damage(e, 'arts', null, 1.2);   // the body hit
    assert.equal(count('w_hit_1'), 0);
    w.damage(e, 'phys', null, 1.2);   // a blocker's blow in the same tick: not hers (her units deal arts)
    assert.equal(count('w_hit_1'), 0);
    w.damage(e, 'arts', null, 1.2);   // unit 1
    w.damage(e, 'arts', null, 1.2);   // unit 2 (a second unit joined: the talent)
    assert.equal(count('w_hit_1'), 1);
    assert.equal(count('w_hit_2'), 1);
    w.damage(e, 'arts', null, 1.3);   // another tick: not this attack's
    assert.equal(count('w_hit_3'), 0);
    ofx.time += 1 + LUNGE_S; frame();   // past the hit window (flight + 0.35 s) and the lunge
    assert.equal(live('w_tok_1'), 1, 'home again');
    assert.equal(live('w_tok_2'), 1, 'two units from now on (the hits showed them)');
    assert.ok(count('w_end_1') >= 2, 'its appear on coming back');
  });

  test('several targets of one attack (S2): the body shot at the first only, each target its unit; no home loop in that mode', async () => {
    const { w, view, frame, live, count } = await setup();
    const v = view(1, 'char_901_wolf', { skill: 1 });
    const a = view(8, 'enemy_905_dummy', { x: 7, y: 5 }), b = view(9, 'enemy_905_dummy', { x: 7, y: 6 });
    w.deploy(v); frame();
    v.flags = SKILL; w.skill(v, true); frame();
    assert.equal(live('w_tok_1'), 0, 'the units left for the hunt');
    assert.equal(w.attack(v, a, 'drone', 1, false), true);
    assert.equal(w.attack(v, b, 'drone', 1, false), true);
    assert.equal(count('w_body_trail'), 1, 'one body shot');
    w.damage(a, 'arts', null, 1.2);
    w.damage(b, 'arts', null, 1.2);
    assert.equal(count('w_hit_1'), 1);
    assert.equal(count('w_hit_2'), 1);
    w.skill(v, false); v.flags = 0; frame();
    assert.equal(live('w_tok_1'), 1, 'back home after the skill');
    assert.ok(count('w_end_1') >= 2, 'with its appear');
  });

  test('a funnel shot flies from its mount with its hit; its cast starts with the wind-up; a skill flies its own from another point', async () => {
    const { w, view, frame, count, handles } = await setup();
    const u = view(1, 'char_902_uav', { skill: 1 });
    const e = view(9, 'enemy_905_dummy', { x: 7, y: 5 });
    w.deploy(u); frame();
    w.attack(u, e, 'drone', 1, false);
    assert.equal(count('u_body'), 1, 'her own shot');
    const shot = handles.find((h) => h.key === 'u_trail');
    assert.ok(shot, 'the funnel shot');
    assert.deepEqual(shot.place.pos.map((x) => +x.toFixed(3)), mountPoint(w.idx.skins.char_902_uav, 6, w.pose(u)).map((x) => +x.toFixed(3)), 'from SPECIAL_1');
    const i = view(2, 'char_903_ice', { skill: 1 });
    w.deploy(i); frame();
    assert.equal(w.castStart(i, e, 'drone', { skip: 0, left: 0.4 }), true);
    assert.equal(count('i_cast'), 1);
    w.attack(i, e, 'drone', 2, true);
    assert.equal(count('i_cast'), 1, 'a wound-up attack does not play it twice');
    assert.equal(count('i_trail'), 1);
    const d = view(3, 'char_904_dro', { skill: 1 });
    w.deploy(d); frame();
    d.flags = SKILL; w.skill(d, true);
    w.attack(d, e, 'drone', 3, false);
    assert.equal(count('d_trail2'), 1, "the skill's own funnel shot");
    assert.equal(count('d_trail'), 0);
  });

  test("remote units: the kit's 'drone' leaves home and plays the hit groups in turn, the overload look, the return; the kit fx are not drawn procedurally", async () => {
    const { w, view, frame, live, count, ofx, handles } = await setup();
    const u = view(1, 'char_902_uav', { skill: 1 });
    view(9, 'enemy_905_dummy', { x: 7, y: 5 });   // the enemy the kit's fx lands on
    w.deploy(u); frame();
    u.flags = SKILL; w.skill(u, true); frame();
    assert.equal(live('u_tok'), 1, 'the same loop at home in S2 (kept)');
    assert.equal(w.simFx('drone', 7, 5, { id: 1 }), true, 'the light pillar is not drawn');
    assert.equal(count('u_hide'), 1);
    assert.equal(live('u_hit_l'), 1);
    frame();
    assert.equal(live('u_tok'), 0);
    const hl = handles.find((h) => h.key === 'u_hit_l');
    assert.equal(typeof hl.opts.track, 'function', 'it follows the enemy');
    w.simFx('drone', 7, 5, { id: 1 }); frame();
    assert.equal(live('u_hit_l'), 0, 'the previous hit stops');
    assert.equal(live('u_hit_r'), 1);
    assert.equal(w.simFx('overload', 5, 5, { id: 1 }), true);
    w.simFx('drone', 7, 5, { id: 1 }); frame();
    assert.equal(count('u_hit_lo'), 1, 'the overload groups');
    ofx.time += RETURN_S + 0.1; frame();
    assert.ok(count('u_show') >= 1, 'no hit for a while: it comes back');
    assert.equal(live('u_over'), 1, 'its overload look at home');
    w.skill(u, false); u.flags = 0; frame();
    assert.equal(live('u_over'), 0);
    assert.equal(live('u_tok'), 1, 'the Default look again');
    assert.equal(w.simFx('droneLock', 7, 5, { id: 9, src: 1 }), false, 'not in the skill: nothing to stand for');
  });

  test("a remote mode's own attacks: her shot only — the units neither leave with it nor take its damage for their hits", async () => {
    const { w, view, frame, live, count } = await setup();
    const u = view(1, 'char_902_uav', { skill: 1 });
    const e = view(9, 'enemy_905_dummy', { x: 7, y: 5 });
    w.deploy(u); frame();
    u.flags = SKILL; w.skill(u, true); frame();
    // her attack before the drone's first hit (the same frame): pending, then the 'drone' fx shows the mode is remote
    w.attack(u, e, 'drone', 1, false);
    assert.equal(count('u_hide'), 0, 'the drone does not leave with her attack');
    w.simFx('drone', 7, 5, { id: 1 });
    w.damage(e, 'arts', null, 1); w.damage(e, 'arts', null, 1.2); w.damage(e, 'arts', null, 1.2);
    assert.equal(count('u_hit_l'), 1, "only the 'drone' fx's hit");
    assert.equal(count('u_hit_r'), 0);
    frame();
    w.attack(u, e, 'drone', 2, false);
    w.damage(e, 'arts', null, 2.2); w.damage(e, 'arts', null, 2.2);
    assert.equal(count('u_hit_l') + count('u_hit_r'), 1, 'her later attacks: her shot only');
    assert.equal(live('u_body'), 2, 'her S2 shots fly');
  });

  test('two remote units: the k-th fx of a frame is unit k, each its own groups; the skill start shows the added unit with its appear', async () => {
    const { w, view, frame, live, count } = await setup();
    const i = view(1, 'char_903_ice', { skill: 1 });
    w.deploy(i); frame();
    assert.equal(live('i_def'), 1);
    i.flags = SKILL; w.skill(i, true); frame();
    assert.equal(live('i_def'), 0);
    assert.equal(live('i_f1') + live('i_f2'), 2, 'two units at home in S2');
    assert.equal(count('i_show1') + count('i_show2'), 2, 'shown with their appear');
    w.simFx('drone', 7, 5, { id: 1 }); w.simFx('drone', 7, 6, { id: 1 }); frame();
    assert.equal(count('i_hl1'), 1);
    assert.equal(count('i_hr2'), 1, 'unit 1 starts its sequence one group on (units in step)');
    assert.equal(count('i_hide1') + count('i_hide2'), 2);
    w.simFx('drone', 7, 5, { id: 1 }); frame();
    assert.equal(count('i_hl2'), 1, 'its next group');
    w.skill(i, false); i.flags = 0; frame();
    assert.equal(live('i_def'), 1);
    assert.equal(count('i_show1'), 2, 'unit 0 back where the Default look floats');
    assert.equal(count('i_show2'), 1, 'unit 1 has no spot there');
  });

  test("dispersed units: 'drones' releases them, 'droneLock' sends one after its enemy (trace mark), it latches (latched mark) and hits; a lost target, the skill's end", async () => {
    const { w, view, views, frame, live, count, ofx } = await setup();
    const v = view(1, 'char_901_wolf', { skill: 2 });
    const e = view(9, 'enemy_905_dummy', { x: 8, y: 5 });
    w.deploy(v); frame();
    v.flags = SKILL; w.skill(v, true);
    assert.equal(w.simFx('drones', 5, 5, { id: 1, n: 2 }), true, 'not the pillar');
    assert.equal(live('w_trail'), 2, 'two flights');
    assert.equal(count('w_start'), 1);
    assert.equal(count('w_end_1'), 1, 'the home unit leaves');
    frame(40);   // the spread (1.3 s)
    assert.equal(w.simFx('droneLock', 8, 5, { id: 9, src: 1 }), true, 'not the reticle');
    assert.equal(live('w_mark1'), 1);
    frame(90);
    assert.equal(live('w_mark2'), 1, 'latched');
    assert.equal(w.simFx('drone', 8, 5, { id: 1 }), true);
    assert.equal(count('w_hit_1') + count('w_hit_2'), 1, 'its hit on the target');
    e.alive = false; frame();
    assert.equal(live('w_mark1') + live('w_mark2'), 0, 'lost: its marks stop');
    views.delete(9);
    w.skill(v, false); v.flags = 0; frame();
    assert.equal(live('w_trail'), 0, "the skill's end");
    assert.equal(live('w_tok_1'), 1, 'home again');
    // a view that saw no 'drones' (built mid-skill): the units leave after a beat
    const s = view(2, 'char_901_wolf', { skill: 2 });
    w.deploy(s); frame();
    s.flags = SKILL; w.skill(s, true); frame(20);
    ofx.time += 0.5; frame();
    assert.equal(live('w_trail'), 2, '1 + attack@cnt units');
  });

  test('the old look without the effects: nothing official, the kit fx keep their procedural draw', async () => {
    const { w, view, frame, log } = await setup({ active: false });
    const u = view(1, 'char_902_uav', { skill: 1 });
    w.deploy(u); frame();
    u.flags = SKILL; w.skill(u, true);
    assert.equal(w.simFx('drone', 7, 5, { id: 1 }), false);
    assert.equal(w.simFx('drones', 5, 5, { id: 1, n: 1 }), false);
    assert.deepEqual(log, []);
    // effects on but the unit's hit prefabs not extracted: the pillar stays
    const m = await setup({ missing: ['u_hit_l', 'u_hit_r', 'u_hit_lo', 'u_hit_ro'] });
    const v = m.view(1, 'char_902_uav', { skill: 1 });
    m.w.deploy(v); m.frame();
    v.flags = SKILL; m.w.skill(v, true); m.frame();
    assert.equal(m.w.simFx('drone', 7, 5, { id: 1 }), false);
  });

  test("a prefab not loaded yet is placed by index.json's summary (spawn, FollowMountPoint) and takes up its rotation once loaded", async () => {
    const { w, view, handles, load } = await setup();
    const v = view(1, 'char_902_uav', { skill: 1 });
    const skin = w.idx.skins.char_902_uav;
    const at = mountPoint(skin, 6, w.pose(v)).map((x) => +x.toFixed(3));
    // the summary's FollowMountPoint (SPECIAL_1): on its point from the first frame, as a loaded one (DESIGN §32.14.36)
    const h = w.playOn('late_tok', v, { follow: true, loop: true });
    assert.ok(h);
    assert.deepEqual(h.place.pos.map((x) => +x.toFixed(3)), at, 'its FollowMountPoint, not the HitPoint');
    assert.equal(h.place.mountRot, null, 'its rotation is the descriptor\'s to say');
    const fx = { anchor: [0, 0, 0], yaw: 0, mirror: false, flipY: false, mountRot: null };
    h.opts.track(fx);
    assert.deepEqual(fx.anchor.map((x) => +x.toFixed(3)), at, 'it follows the point');
    load('late_tok');
    h.opts.track(fx);
    assert.equal(fx.mountRot?.length, 4, "loaded: the point's rotation (no `_keepOriginRotation`)");
    // the summary's spawn location without a FollowMountPoint: SPAWN 0, the feet (not the HitPoint)
    const f = w.playOn('late_fx', v, {});
    assert.deepEqual(f.place.pos.map((x) => +x.toFixed(3)), [5 - 10, 5 - 9, 0], 'spawn 0: the feet');
    assert.equal(typeof handles.at(-1).opts.track, 'function', 'its direction and pause behaviours once loaded');
  });
});

describe('a floating unit on its bone (mounts.js, DESIGN §32.14.36)', () => {
  test('a home loop follows its Special point where the model draws the bone — up the plane the camera faces, mirrored for a unit facing left', async () => {
    const { w, view, frame, handles } = await setup();
    const C = Math.cos(SKELETON_TILT * Math.PI / 180), S = Math.sin(SKELETON_TILT * Math.PI / 180);
    const right = boneView({ F_Funnel_1: { x: -0.55, up: 0.75, angle: 0 } });
    const v = view(1, 'char_901_wolf', { skill: 2, v: { boneOffset: right.boneOffset.bind(right) } });
    w.deploy(v); frame();
    const h = handles.find((x) => x.key === 'w_tok_1');
    const fx = { anchor: [0, 0, 0] };
    h.opts.track(fx);
    const near = (a, b, msg) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${msg}: ${a} vs ${b}`));
    near(fx.anchor, [5 - 10 - 0.55, 5 - 9 + 0.75 * C, -0.75 * S], 'on the drawn bone');
    // the bone bobs with the clip: the unit with it
    right.bones.F_Funnel_1 = { x: -0.5, up: 0.82, angle: 0 };
    h.opts.track(fx);
    near(fx.anchor, [5 - 10 - 0.5, 5 - 9 + 0.82 * C, -0.82 * S], 'followed');
    // a unit drawn facing left: the bone mirrored
    const left = boneView({ F_Funnel_1: { x: -0.55, up: 0.75, angle: 0 } }, -1);
    const l = view(2, 'char_901_wolf', { skill: 2, v: { visFacing: -1, dir: 'LEFT', boneOffset: left.boneOffset.bind(left) } });
    w.deploy(l); frame();
    const hl = handles.filter((x) => x.key === 'w_tok_1').at(-1);
    const fl = { anchor: [0, 0, 0] };
    hl.opts.track(fl);
    near(fl.anchor, [5 - 10 + 0.55, 5 - 9 + 0.75 * C, -0.75 * S], 'mirrored');
  });
});
