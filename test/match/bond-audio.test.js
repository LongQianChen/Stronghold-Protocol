import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { BOND_LAYER_CAP, PHASE } from '../../shared/constants.js';

const cues = h => h.sent.filter(([, msg]) => msg.t === 'm.layer');
function prep(t) {
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  h.sent.length = 0;
  return h;
}

test('prep gains unicast the actual increase once, even for an inactive bond', t => {
  const h = prep(t), p = h.ps('p_0');
  assert.equal(p.bonds.sargonShip?.active ?? false, false);
  assert.equal(p.addLayers('sargonShip', 3), 3);
  assert.deepEqual(cues(h), [['p_0', { t: 'm.layer', playerId: 'p_0', bondId: 'sargonShip', add: 3 }]]);
  assert.equal(h.bc.some(msg => msg.t === 'm.layer'), false);
  p.layers.sargonShip = BOND_LAYER_CAP - 1;
  p.addLayers('sargonShip', 10);
  assert.equal(cues(h).at(-1)[1].add, 1);
  const n = cues(h).length;
  for (const v of [1, 0, -2, NaN, Infinity]) p.addLayers('sargonShip', v);
  p.addLayers('not-a-bond', 2);
  p.addLayers('kjeragShip', 2, { requireActive: true });
  assert.equal(cues(h).length, n);
});

test('only live prep phases emit, never settlement/backfill or resynchronization views', t => {
  const h = prep(t), p = h.ps('p_0');
  for (const phase of Object.values(PHASE)) {
    h.m.phase = phase; h.sent.length = 0;
    p.addLayers('sargonShip', 1);
    assert.equal(cues(h).length, [PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(phase) ? 1 : 0, phase);
  }
  h.m.phase = PHASE.PREP; h.sent.length = 0;
  p.recompute(); p.privateView(); h.m.publicView();
  assert.equal(cues(h).length, 0);
});
