// Preparation counts and converted battle memberships through the actual browser simulation loader.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { Grid } from '../../server/sim/grid.js';
import { GEO } from '../../shared/constants.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SIM_E2E === '1' && existsSync(CHROME);
const raw = getData({ log: { info() {}, warn() {}, error() {} } });
const gd = new GameData(raw, 'mode_multi_hard');
const grid = new Grid(getDefaultSource().getStage('act1autochess_m01'), GEO.NORMAL_RECT);
function fixture(ids, items) {
  const taken = new Set(), board = new Map(), units = [];
  ids.forEach((id, i) => {
    const c = raw.chess[id];
    let tile;
    for (let r = 9; r <= 12 && !tile; r++) for (let col = 2; col <= 10 && !tile; col++) {
      if (!taken.has(`${r},${col}`) && grid.canStand(r, col, { ranged: c.position === 'RANGED' })) tile = [r, col];
    }
    assert.ok(tile, id); taken.add(tile.join(','));
    const its = i === ids.length - 1 ? items : [];
    board.set(tile.join(','), { uid: i + 1, kind: 'chess', id, items: its.map(id => ({ id })) });
    units.push({ uid: i + 1, chessId: id, row: tile[0], col: tile[1], items: its });
  });
  const bonds = computeBonds(gd, { board, hand: [], layers: {} });
  return { spec: buildBattleSpec({ battleId: 'morph', fieldId: 'n:p1', kind: 'normal', modeId: 'mode_multi_hard',
    seed: 29, stageId: 'act1autochess_m01', timeLimit: 10, flags: { dpInit: 999 },
    players: [{ playerId: 'p1', bonds, units }],
  }), bonds, uid: ids.length };
}

describe('converted bonds in the actual browser battle', { skip: !enabled }, () => {
  let srv, browser, page;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const P = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage(); await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  async function inspect(f) {
    return page.evaluate(async ({ spec, uid }) => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { spec: S, ds } = await loadBrowserSim();
      const { unitBonds, isMember } = await import('/sim/content/support/index.js');
      const b = S.createBattleFromSpec(spec, ds, { quiet: true, recordEvents: false });
      for (let i = 0; i < 30; i++) b.step();
      const u = b.allyUnits.find(u => u.kind === 'op' && u.uid === uid);
      return { own: unitBonds(u), members: Object.keys(spec.players[0].bonds).filter(id => isMember(b, u, id)),
        yan: b.getPlayer('p1').bonds.yanShip, atk: u.s.atk, baseAtk: u.base.atk,
        yanyou: b.allyUnits.filter(u => u.alive && u.mem.bondYan).length, errors: b.errors };
    }, f);
  }
  for (const mu of ['chess_char_6_11_a', 'chess_char_6_11_b']) test(`7 Yan plus converted ${mu}: nine Yan really summons two 炎佑`, async () => {
    const seven = Object.values(raw.chess).filter(c => c.visible && !c.isGolden && c.bonds.includes('yanShip')).slice(0, 7).map(c => c.chessId);
    const f = fixture([...seven, mu], ['chess_item_6_09_e_a', 'chess_item_3_04_e_a']);
    assert.equal(f.bonds.yanShip.count, 9);
    const out = await inspect(f);
    assert.equal(out.yan.count, 9); assert.equal(out.yan.tier, 3);
    assert.ok(out.own.includes('yanShip')); assert.ok(out.atk > out.baseAtk);
    assert.equal(out.yanyou, 2); assert.deepEqual(out.errors, []);
  });
  test('all 36 normal/advanced conversion item pairings retain battle membership', async () => {
    const grants = Object.values(raw.items).filter(r => r.giveBondId);
    assert.equal(grants.length, 36);
    for (const it of grants) {
      const id = it.giveBondId;
      const two = Object.values(raw.chess).filter(c => c.visible && !c.isGolden && c.bonds.includes(id) && !c.bonds.includes('maniShip')).slice(0, 2).map(c => c.chessId);
      const outsider = Object.values(raw.chess).find(c => c.visible && !c.isGolden && c.tier <= 2 && !c.bonds.includes(id) && !c.bonds.includes('maniShip'));
      const f = fixture([...two, outsider.chessId], [it.id, it.isGolden ? 'chess_item_6_09_e_b' : 'chess_item_6_09_e_a']);
      const out = await inspect(f);
      assert.ok(out.own.includes(id) && out.members.includes(id), `${it.id}: ${JSON.stringify(out)}`);
      assert.deepEqual(out.errors, []);
    }
  });
});
