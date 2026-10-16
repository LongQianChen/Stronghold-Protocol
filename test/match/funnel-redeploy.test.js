// Real production Match + Battle, legal normal intents from an empty board. Seed 8 fixes the shop/wave route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { makeMatch } from './harness.js';

test('Rockrock killed by a real enemy and automatically revived by Ermengard starts the same target at init', () => {
  const observed = [];
  class ObservedBattle extends Battle {
    constructor(opts) {
      super(opts);
      const log = { round: opts.round, deaths: [], deploys: [], firstHits: [], hits: [] };
      observed.push(log);
      const seen = new Set(), launches = new Map();
      this.on('death', c => {
        if (c.unit.defId === 'chess_char_2_10_a') log.deaths.push({ t: this.time, seq: c.unit.deploySeq,
          target: c.unit.trait.funnelTarget, scale: c.unit.trait.funnelScale, reason: c.reason });
      }, { priority: 1000 });
      this.on('death', c => {
        if (c.unit.defId === 'chess_char_2_10_a') log.deaths.at(-1).revivedBy = c.revivedBy;
      }, { priority: -1000 });
      this.on('deploy', c => {
        if (c.unit.defId === 'chess_char_2_10_a') log.deploys.push({ seq: c.unit.deploySeq,
          target: c.unit.trait.funnelTarget, scale: c.unit.trait.funnelScale });
      }, { priority: -1000 });
      this.on('attack', c => {
        if (c.attacker.defId !== 'chess_char_2_10_a') return;
        // This unmodified Rockrock route has no nested attack callback. The attack hook follows its shot creation.
        launches.set(this._attackSeq, { t: this.time, seq: c.attacker.deploySeq });
      });
      this.on('damaged', c => {
        const u = c.source;
        const launch = launches.get(c.dmg?.attackId);
        if (u?.defId === 'chess_char_2_10_a' && launch) log.hits.push({ t: this.time, seq: launch.seq });
        if (u?.defId !== 'chess_char_2_10_a' || seen.has(u.deploySeq) || launch?.seq !== u.deploySeq) return;
        seen.add(u.deploySeq);
        log.firstHits.push({ t: this.time, launchAt: launch.t, seq: u.deploySeq, target: c.target.id,
          scale: u.trait.funnelScale, hpBefore: c.target.hp + c.amount });
      });
    }
  }
  const h = makeMatch({ mode: 'solo', seed: 8 });
  h.m.BattleClass = ObservedBattle; // read-only observers, no combat state writes
  const p = h.ps('p_0'), act = msg => assert.deepEqual(h.m.handle('p_0', msg), { ok: true });
  try {
    h.start().toPrep(1, { band: 'band_ermengard' });
    act({ t: 'g.buy', slot: 0 });
    act({ t: 'g.move', uid: p.hand.find(x => x?.id === 'chess_char_1_09_a').uid,
      to: { area: 'board', row: 12, col: 6 }, dir: 'RIGHT' });
    h.toPrep(2, { band: 'band_ermengard' });
    act({ t: 'g.levelUp' });
    h.toPrep(5, { band: 'band_ermengard' });
    assert.equal(p.shop.slots[3].id, 'chess_char_2_10_a');
    act({ t: 'g.buy', slot: 3 });
    act({ t: 'g.move', uid: p.hand.find(x => x?.id === 'chess_char_2_10_a').uid,
      to: { area: 'board', row: 12, col: 8 }, dir: 'RIGHT' });
    h.toPrep(7, { band: 'band_ermengard' });
    const log = observed.find(x => x.round === 6);
    assert.ok(log?.deaths.length > 0);
    // a drone launched before the knockout still lands and steps the new ramp (professions.js installFunnel), so a pair
    // with such a landing from the knockout's tick to the fresh drone's hit says nothing about the reset
    const stale = (d, hit) => log.hits.some(x => x.seq <= d.seq && x.t >= d.t && x.t <= hit.t);
    const paired = log.deaths.map(d => ({ death: d, hit: log.firstHits.find(x => x.seq > d.seq) }))
      .filter(x => x.hit && x.death.target === x.hit.target && x.death.scale > 0.2 && !stale(x.death, x.hit));
    assert.ok(paired.length > 0, JSON.stringify(log));
    for (const { death, hit } of paired) {
      assert.equal(death.reason, 'killed');
      assert.equal(death.revivedBy, 'band');
      assert.ok(hit.launchAt >= death.t, 'fresh attack after the knockout and revival');
      assert.ok(hit.hpBefore > 0, 'the same enemy was alive when the fresh drone hit');
      const deploy = log.deploys.find(x => x.seq === hit.seq);
      assert.equal(deploy.target, null);
      assert.ok(Math.abs(deploy.scale - 0.2) < 1e-8);
      assert.ok(Math.abs(hit.scale - 0.2) < 1e-8, JSON.stringify({ death, hit }));
    }
    assert.deepEqual(h.logs.error, []);
    h.invariants();
  } finally { h.m.dispose(); }
});
