// Community report of 2026-10-14: 娜仁图亚 【见者有份】 never offered an equip above the current shop level.
// The blackboard (preparation_start_add_special_goods_every_n_round, pool_equip_narant) names no tier. Until 0.3.0 the
// pool was maxTier 'shopLevel'. Same shape as 凯瑟琳: every shop-eligible equip, uniform [ASSUMED].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';

test('娜仁图亚 见者有份: an even round at shop level 1 can offer every shop tier, never a shop-excluded item', () => {
  assert.equal(DATA.choices.pools.pool_equip_narant.maxTier, undefined, 'no shop-level cap in the data');
  assert.equal(DATA.choices.pools.pool_equip_narant.rule, 'shopEligible');
  const tiers = new Map();
  for (let seed = 1; seed <= 16; seed++) {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed, fake: true }).start();
    h.toPrep(2, { band: 'band_narant' });
    const ps = h.ps('p_0');
    assert.equal(ps.shop.level, 1, `seed ${seed}: round 2 has not levelled the shop`);
    const offer = ps.offers.find((o) => (o.slots ?? []).some((s) => s && s.kind === 'item'));
    assert.ok(offer, `seed ${seed}: even-round offer`);
    const ids = (offer.slots ?? []).filter((s) => s && s.kind === 'item').map((s) => s.id);
    assert.equal(ids.length, 2, `seed ${seed}: two equips`);
    assert.equal(new Set(ids).size, 2, `seed ${seed}: two different equips`);
    for (const id of ids) {
      const rec = h.m.gd.item(id);
      assert.ok(rec && rec.itemType === 'EQUIP' && !rec.shopExcluded, `seed ${seed}: ${id} is a shop equip`);
      tiers.set(rec.tier, (tiers.get(rec.tier) || 0) + 1);
    }
    h.m.dispose();
  }
  assert.ok([...tiers.keys()].some((t) => t > 1), `an equip above shop level 1 — saw ${JSON.stringify([...tiers])}`);
  assert.ok(tiers.has(6), `tier VI among them — saw ${JSON.stringify([...tiers])}`);
});
