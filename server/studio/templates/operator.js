import { officialOperator, clone, jsonText, localId } from '../gameData.js';
import { officialKit } from '../../sim/content/index.js';
import { StudioError } from '../files.js';

export function operatorRecord({ id, name, target, options = {}, data }) {
  const source = options.kitRef || target?.key || 'char_102_texas';
  const { normal, elite } = officialOperator(data, source);
  const ns = localId(id);
  const kind = options.kitSource || 'ref';
  if (!['ref', 'spec', 'dsl'].includes(kind)) throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'kit', detail: 'choose ref, spec or dsl' });
  const skills = rec => kind === 'ref'
    ? (rec.skills?.length ? rec.skills : [rec.skill]).filter(Boolean).map(s => ({ ...clone(s), default: s.skillId === rec.skill?.skillId }))
    : [{ ...clone(rec.skill || {}), skillId: `skx_${ns}_one`, default: true, ...(options.skillName ? { name: options.skillName } : {}) }];
  const form = (rec, which) => ({ stats: { ...clone(rec.stats), ...(options.stats || {}), ...(options[which] || {}) },
    rangeGrid: clone(rec.rangeGrid || [[0, 0], [0, 1]]), skills: skills(rec),
    trait: clone(rec.trait || {}), talents: clone(rec.talents || []) });
  return {
    op: 1, charId: `char_x_${ns}_one`, name: options.operatorName || name || id,
    profession: options.profession || normal.profession, subProfessionId: options.subProfessionId || normal.subProfessionId,
    position: options.position || normal.position, rarity: options.rarity ?? normal.rarity ?? 5,
    as: 'chess', chess: { tier: options.tier ?? normal.tier ?? 1, bonds: options.bonds || normal.bonds || [data.config.economy.fallbackBondId] },
    forms: { normal: form(normal, 'normal'), elite: form(elite, 'elite') },
    skills: skills(normal), kit: kind === 'ref' ? { ref: officialKit(source) ? source : normal.baseId || normal.chessId } : kind === 'spec'
      ? { spec: options.spec !== undefined ? options.spec : { kind: 'duration', duration: 10, mods: { atkPct: 0.5 } } }
      : { dsl: options.dsl !== undefined ? options.dsl : { dsl: 1, pluginId: id, talents: [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.5 } } }] }] } },
    art: { ref: options.artRef || source },
  };
}

export function buildOperator(args) {
  const record = operatorRecord(args);
  return { manifest: { scope: ['room'], permissions: ['data.add', ...(record.kit.dsl ? ['dsl'] : [])], operators: ['data/operator.json'] },
    files: { 'data/operator.json': jsonText(record) } };
}

export default { id: 'operator', class: 'content', kinds: ['operator'], slots: () => [], overlay: () => ({}), build: buildOperator };
