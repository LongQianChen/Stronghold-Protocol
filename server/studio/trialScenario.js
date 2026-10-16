// Studio-only scenarios, not official rules and never imported by the game simulation.
import { buildBattleSpec } from '../sim/spec.js';
import { spawnsFromTemplate } from '../sim/simdata.js';
import { StudioError } from './files.js';

export function chooseOperator(data, id) {
  if (id && data.chess[id]) return data.chess[id];
  if (id) {
    const r = Object.values(data.chess).find(r => r.charId === id && !r.isGolden && !r.isDiy);
    if (r) return r;
    throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: id });
  }
  return Object.values(data.chess).find(r => r.charId === 'char_102_texas' && !r.isGolden);
}

export function baselineOperator(data, record) {
  if (data.chess[record.chessId]) return data.chess[record.chessId];
  const keys = [record.kitRef, record.assets?.spine, record.assets?.avatar];
  return Object.values(data.chess).find(r => !r.isGolden && keys.includes(r.charId)) || chooseOperator(data);
}

export async function trialScenario(request, data, operator, opponent) {
  const scenario = request.scenario || 'dummy';
  if (scenario.startsWith('golden:')) {
    const [, family, id] = scenario.split(':');
    if (!['roster', 'bonds', 'fields', 'standins', 'diy'].includes(family)) throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
    let golden;
    try { golden = await import('../../tools/golden.mjs'); } catch { throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400); }
    const sc = golden.scenariosOf(family).find(s => s.id === id);
    if (!sc) throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
    return { spec: buildBattleSpec({ ...sc, battleId: sc.id, fieldId: 'studio-trial', content: 'full' }), cap: Math.min(sc.cap || sc.timeLimit || 200, 240), duel: false };
  }
  if (!['dummy', 'wave', 'duel'].includes(scenario)) throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
  const seconds = request.seconds ?? 30;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120 || (request.seed !== undefined && (!Number.isInteger(request.seed) || request.seed < 1 || request.seed > 0xffffffff))) throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
  // [ASSUMED] Synthetic test lane: deployed units stand adjacent; the dummy never moves or attacks.
  const rows = Array.from({ length: 19 }, () => '#'.repeat(21));
  for (let r = 9; r <= 12; r++) rows[r] = '##ErrrrrrrS##########';
  const stageId = 'studio-trial-lane';
  const stage = { id: stageId, name: stageId, rows, devices: [] };
  let routes = [{ motion: 'WALK', start: [10, 10], end: [10, 2], checkpoints: [] }];
  let spawns = [];
  let overrides = {};
  const units = [{ uid: 1, chessId: operator.chessId, row: 10, col: 5, dir: 'RIGHT' }];
  if (scenario === 'duel') units.push({ uid: 2, chessId: opponent.chessId, row: 10, col: 6, dir: 'LEFT' });
  else if (scenario === 'wave') {
    const key = request.wave || 'act1autochess_01';
    const wave = data.waves[key];
    if (!wave || wave.kind === 'boss') throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
    const converted = spawnsFromTemplate(wave);
    routes = converted.routes; spawns = converted.spawns; overrides = wave.overrides || {};
  } else {
    const key = 'enemy_1007_slime';
    spawns = [{ time: 0, enemyKey: key, routeIndex: 0, count: 1, interval: 0, pos: [10, 6] }];
    overrides = { [key]: { stats: { maxHp: 1000000, atk: 0, def: 0, res: 0, moveSpeed: 0 } } };
  }
  return { spec: buildBattleSpec({ fieldId: 'studio-trial', seed: request.seed || 1, kind: 'normal', modeId: 'mode_single_normal', round: 1,
    stageId, timeLimit: seconds, players: [{ playerId: 'studio', seat: 0, side: 'L', colOffset: 0, units, bonds: {} }],
    routes, spawns, enemyOverrides: overrides, flags: { dpInit: 99, dpMax: 99 } }), stage, cap: seconds, duel: scenario === 'duel' };
}
