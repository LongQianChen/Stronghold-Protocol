// Five starting points from PLUGIN-DSL §7 and the official-kit comparison tests.
import { clone } from './gameData.js';
import { StudioError } from './files.js';
const SKGOAT = {
  dsl: 1, pluginId: 'rewrite-skgoat',
  skill: { kind: 'duration', mods: { atkPct: { bb: 'atk' } } },
};
const INSIDE = {
  dsl: 1, pluginId: 'rewrite-inside',
  skill: {
    kind: 'ammo', ammo: { bb: 'attack@trigger_time' },
    mods: { atkPct: { bb: 'atk' }, batPct: { batMod: { bb: 'base_attack_time' } }, taunt: -1 },
    targeting: { priority: 'ranged' },
  },
};
const TEXAS = {
  dsl: 1, pluginId: 'rewrite-texas',
  skill: {
    kind: 'instant',
    targeting: { rangeGrid: 'skill', noRangeExtend: true },
    on: { start: [
      { dp: { amount: { bb: 'cost' }, fx: true } },
      { fx: { kind: 'aoe', radius: 2, skill: 'swordRain' } },
      { damage: {
        target: 'enemiesInRange', times: 2, type: 'arts', isSkill: true, tags: ['skill'],
        amount: { mul: [{ stat: 'atk' }, { bb: 'atk_scale' }] },
        then: [{ status: { target: 'target', key: 'stun', duration: { bb: 'stun' } } }],
      } },
    ] },
  },
  talents: [{ when: 'battleStart', do: [{ dp: { amount: { talent: [0, 'cost'] }, fx: false } }] }],
};
const KAZEMA = {
  dsl: 1, pluginId: 'rewrite-kazema',
  skill: {
    kind: 'duration', mods: { atkPct: { bb: 'atk' } },
    on: { start: [
      { damage: { target: 'self', lose: true, minRemain: 1, amount: { mul: [{ stat: 'hp' }, { bb: 'hp_ratio' }] } } },
      { spawnToken: {
        token: { override: true, match: ['shadow', 'doll'], fallback: 'token_10022_kazema_shadow' },
        tile: 'around', mem: 'doll', fx: true,
      } },
      { fx: { kind: 'aoe', at: 'lastSpawn', radius: 1.5, skill: 'origami' } },
      { damage: {
        target: { enemiesInRadius: 1, at: 'lastSpawn', shape: 'chebyshev', includeStealth: true },
        from: 'lastSpawn', type: 'arts', isSkill: true, canDodge: false, tags: ['talent'],
        amount: { mul: [{ stat: 'atk', of: 'lastSpawn' }, { talent: [0, 'damage_scale'] }] },
      } },
    ] },
  },
};

const LMLEE = { dsl: 1, meta: { on: [1, 2, 3].map(round => ({ when: 'income', if: { round }, do: [{ funds: { amount: round === 3 ? 15 : 0, setIncome: true } }] })) } };
const EXAMPLES = { demo: ['char_199_yak', { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.5 } } }], skgoat: ['char_183_skgoat', SKGOAT], inside: ['char_498_inside', INSIDE], texas: ['char_102_texas', TEXAS], kazema: ['char_4016_kazema', KAZEMA], lmlee: [null, LMLEE] };
export function dslExample(name, id) {
  if (!Object.hasOwn(EXAMPLES, name)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'unknown DSL example' });
  const [charId, base] = EXAMPLES[name];
  const spec = { ...clone(base), pluginId: id };
  if (spec.meta) spec.meta.key = `effect:${id}:income`;
  return { charId, spec };
}
