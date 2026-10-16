import meta from './meta.js';
import { buildOperator } from './operator.js';
import { dslExample } from '../dslExamples.js';
// server/studio/templates/dsl.js — the template 「数据插件里的 DSL」 (server/studio/templates/index.js): a content plugin
// with one operator whose kit is a DSL spec, and one prep spec. No target: the ids are the plugin's own namespace.
// [ASSUMED] The example operator is a passive +50% attack, and the prep file sets round-1 income to 15 (DESIGN §32.7).

/** JSON the studio and the tool write (two spaces, a final newline). @param {unknown} value */
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** A compact operator whose kit is DSL. The spec names this plugin; the builder still stamps the record. @param {string} id */
function operator(id) {
  const ns = id.replace(/-/g, '_');
  return {
    op: 1,
    charId: `char_x_${ns}_caster`,
    name: 'Demo caster',
    profession: 'CASTER',
    subProfessionId: 'corecaster',
    position: 'RANGED',
    rarity: 3,
    as: 'both',
    chess: { tier: 1, bonds: ['deputShip'] },
    forms: {
      normal: { stats: { maxHp: 2000, atk: 200, def: 50, bat: 1.2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
      elite: { stats: { maxHp: 3000, atk: 300, def: 80, bat: 1.2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
    },
    skills: [{ skillId: `skx_${ns}_caster_1`, name: 'Cast', duration: 10, spCost: 10, initSp: 10, default: true }],
    trait: { desc: 'Ranged arts' },
    kit: { dsl: { dsl: 1, pluginId: id, skill: { kind: 'passive', mods: { atkPct: 0.5 } } } },
    art: { ref: 'char_199_yak' },
  };
}

/** A prep spec. [ASSUMED] A manifest dsl file must carry meta, and the key is effect:<this plugin id>:<local>. @param {string} id */
function income(id) {
  return {
    dsl: 1,
    pluginId: id,
    meta: {
      key: `effect:${id}:income`,
      on: [{ when: 'income', if: { round: 1 }, do: [{ funds: { amount: 15, setIncome: true } }] }],
    },
  };
}

export default {
  id: 'dsl', class: 'content', kinds: [], slots: () => [], overlay: () => ({}),
  build(args) {
    const { id, options } = args;
    const example = options.example || 'demo';
    if (example === 'demo') {
      const rec = operator(id);
      if (options.dsl !== undefined) rec.kit.dsl = options.dsl;
      return { manifest: { scope: ['room'], permissions: ['data.add', 'dsl'],
        operators: [`operators/${id.replaceAll('-', '_')}.json`], dsl: ['dsl/income.json'] },
      files: { [`operators/${id.replaceAll('-', '_')}.json`]: json(rec), 'dsl/income.json': json(income(id)) } };
    }
    const start = dslExample(example, id);
    if (start.spec.meta) return meta.build(args);
    const made = buildOperator({ ...args, target: { key: start.charId || 'char_102_texas' },
      options: { ...options, kitSource: 'dsl', dsl: options.dsl !== undefined ? options.dsl : start.spec } });
    made.manifest.dsl = ['dsl/income.json'];
    made.files['dsl/income.json'] = json(income(id));
    return made;
  },
};
