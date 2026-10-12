import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { Battle } from '../../server/sim/Battle.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const MEDICS = new Set(['char_605_cmedic', 'char_613_acmedc']);
const medics = b => b.allyUnits.filter(u => MEDICS.has(u.defId) && u.alive && !u.removed);
const clean = () => ({ leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 });
function setup(t) {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 334401, fake: true }).start().toPrep();
  t.after(() => h.m.dispose()); h.setStage('act2autochess_m01');
  for (const p of h.m.order) p.bandId = null;
  h.ps('p_0').bandId = 'band_amedic'; return h;
}
function field(h, elites = 0) {
  const opts = h.m._normalOpts(h.ps('p_1'));
  opts.players[0].units = ['chess_char_1_01_b', 'chess_char_1_02_b'].slice(0, elites)
    .map((chessId, i) => ({ uid: 100 + i, kind: 'chess', chessId, row: 10 + i, col: 4 }));
  const b = new Battle({ ...opts, data: getDefaultSource(), spawns: [], timeLimit: 300, autoFinish: false });
  b.start(); assert.equal(b.errorCount, 0); return b;
}

for (const reason of ['eliminated', 'quit']) for (const elites of [0, 2]) {
  test(`Touch team grant survives holder ${reason}, receiver elites=${elites}`, t => {
    const h = setup(t), before = field(h, elites), expected = elites ? 'char_613_acmedc' : 'char_605_cmedic';
    assert.deepEqual(medics(before).map(u => u.defId), [expected]);
    if (reason === 'quit') h.m.onLeave('p_0');
    else {
      h.ps('p_0').lp = 1;
      h.m.lastResults = new Map(h.m.order.map(p => [p.playerId, clean()]));
      h.m.lastResults.set('p_0', { ...clean(), perfect: false, leaked: [{ enemyKey: 'enemy_1422_lrsldr', counted: true }] });
      h.m.settle(null, null); h.toPrep(2); h.setStage('act2autochess_m01');
    }
    assert.equal(h.ps('p_0').alive, false);
    assert.equal(h.ps('p_1').privateView().prepMapChars.length, 1);
    const after = field(h, elites);
    assert.deepEqual(medics(after).map(u => u.defId), [expected]);
    assert.equal(after.players[0].input.contentInfo.teammates.some(p => p.playerId === 'p_0'), false,
      'retaining Touch does not revive dead teammate contexts');
    for (let i = 0; i < 30; i++) before.step();
    assert.deepEqual(medics(before).map(u => u.defId), [expected]);
    h.ps('p_0').bandId = 'band_amiya';
    assert.equal(field(h).players[0].input.contentInfo.matchBands.includes('band_amiya'), false,
      'other eliminated strategies are not retained by this exception');
  });
}

test('Touch requires a confirmed selection and does not leak to another match', t => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 334405, fake: true }).start();
  t.after(() => h.m.dispose()); h.drive(() => h.m.phase === 'BAND_DRAFT', { ready: false });
  const holder = h.m.players.get(h.m.draftTurn());
  assert.equal(h.m.bandFocus(holder, 'band_amedic').ok, true);
  assert.equal(h.m.teamMedicGranted(), false);
  assert.equal(h.m.pickBand(holder, 'band_amedic').ok, true);
  h.m.onLeave(holder.playerId); assert.equal(h.m.teamMedicGranted(), true);
  const next = makeMatch({ mode: 'coop', humans: 3, seed: 334405, fake: true }).start();
  t.after(() => next.m.dispose()); assert.equal(next.m.teamMedicGranted(), false);
});
