import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepCamera, deployFieldOf, teamFrameIds } from '../../public/js/ui/gameLogic/camera.js';
import { makeMatch } from '../match/harness.js';
import { PHASE } from '../../shared/constants.js';

for (const humans of [2, 3, 4]) test(`random ${humans}-player boss preparation: client camera, placement and partner frames match server`, () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans, seed: 31, fake: true }).start();
  try {
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 14);
    const pub = h.m.publicView();
    assert.deepEqual(pub.bossPairs, h.m.bossPairs);
    for (const p of h.m.alivePlayers()) {
      const expected = h.m.bossGroupOf(p);
      assert.equal(prepCamera(pub, p.playerId).opts.side, expected.side);
      assert.equal(deployFieldOf(pub, p.playerId), h.m.deployFieldOf(p));
      assert.deepEqual([...teamFrameIds(pub, p.playerId)], expected.players.length > 1 ? expected.players : []);
    }
    h.m.onLeave(h.m.bossPairs[0][0]);
    const after = h.m.publicView();
    for (const p of h.m.alivePlayers()) assert.equal(deployFieldOf(after, p.playerId), h.m.deployFieldOf(p));
  } finally { h.m.dispose(); }
});

test('unknown/new pairing is not guessed from seats; older servers still have their ordered fallback', () => {
  const pub = { phase: PHASE.PREP, round: 14, bossRound: 14, players: [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }] };
  assert.equal(prepCamera(pub, 'b').opts.side, 'R');
  assert.equal(prepCamera({ ...pub, bossPairs: null }, 'b').kind, 'prep');
  assert.equal(prepCamera({ ...pub, bossPairs: [['b', 'a']] }, 'b').opts.side, 'L');
  assert.deepEqual([...teamFrameIds({ ...pub, bossPairs: [['b', 'a']] }, 'a')], ['b', 'a']);
});
