// User playtest #5 item 6 — "有两个吹风的风道确实做出来了，但是吹风机的贴图丢失了，反而在关底吹风机的贴图又出现了":
// act2autochess_m01 (战场#05(下半) 源石流发生装置) has 8 blowers (trap_013_blower, dir DOWN): the normal field's on the
// separator row 13 (cols 5 / 9, the partner's 13 / 17) blowing into rows 12–10, the boss field's on row 6 (cols 5 / 9 /
// 11 / 15) blowing into rows 5–3. The 3D board's normal / 联防 area stopped at row 12, so the normal field's blowers
// were never built (their airflow streaks — Pixi — still showed), while the boss field's were (the Final Assault view
// and — facing away, under the bench on the row-6 wall — the normal view).
// Now: the normal / 联防 areas take the separator row 13, and every active device standing on a built tile is drawn
// (render/board3d/layout.js stageDevices; the 2D board render/tiles.js _stageDevices follows the same rule — it used to
// drop an edge-wall device blowing away from the field, so the row-6 machines under the bench now show there too, as
// the user confirmed for the official normal rounds: "吹风机原版道中也该有", playtest #5 follow-up).
// Audit: for every stage and view the 3D board and the 2D board draw the same devices, and every active device is
// drawn exactly in the views whose area holds its tile.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, stageDevices, classifyStage, AREAS } from '../../public/js/render/board3d/layout.js';
import { boardArea, bandFor, fieldRows, viewKind } from '../../public/js/render/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const M01 = stages.act2autochess_m01;

const devicesIn3d = (st, vk) => buildBoard(st, { area: boardArea(vk) }).devices.map((d) => `${d.kind}@${d.r},${d.c}`).sort();
const blowersIn3d = (st, vk) => buildBoard(st, { area: boardArea(vk) }).devices.filter((d) => d.kind === 'blower').map((d) => `${d.r},${d.c}`).sort();

/**
 * Inside the 3D area of a view (the 2D board also shows the partner's half of rows 9–12 as a display in the own views,
 * with its devices; the 3D board builds cols 0–10 there — plus the pen block, whose front wall holds the partner's
 * blower (13,13) in the pen view).
 */
const inArea = (vk) => (k) => {
  const [r, c] = k.split('@').pop().split(',').map(Number);
  return boardArea(vk).some((a) => r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1);
};

/** The 2D board's device list for a view kind, within that view's 3D area (external mode: no Pixi meshes needed). */
async function devicesIn2d(st, vk) {
  const { installFakePixi } = await import('./fakepixi.js');
  const fake = installFakePixi();
  try {
    const P = globalThis.PIXI;
    P.BLEND_MODES = { ADD: 1, NORMAL: 0 };
    const { TileField } = await import('../../public/js/render/tiles.js');
    const layers = { ground: new P.Container(), overlay: new P.Container(), props: new P.Container(), anim: new P.Container() };
    for (const l of Object.values(layers)) l.addChild = function (...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return kids[0]; };
    const f = new TileField(layers);
    f.setExternal(true);
    f.setView(bandFor(vk), null, fieldRows(vk));
    f.setStage(st);
    const out = f._stageDevices().map((d) => `${d.role}@${d.pos[0]},${d.pos[1]}`).filter(inArea(vk)).sort();
    const flow = f.blowers.map((b) => `${b.row},${b.col}`).filter(inArea(vk)).sort();
    f.destroy();
    return { devices: out, flow };
  } finally {
    fake.restore();
  }
}

const VIEWS = ['prep', 'normal', 'unite', 'bossPrep', 'boss', 'pen'];

describe('#6 act2 m01 blowers in every view', () => {
  test('repro: the normal / prep view builds the own field\'s row-13 blowers (cols 5, 9) above the wind lanes', () => {
    // (plus the boss field's row-6 machines on the wall under the bench, as in v2.3 — they blow away from this field)
    assert.deepEqual(blowersIn3d(M01, 'normal'), ['13,5', '13,9', '6,5', '6,9'], 'normal');
    // the prep view builds the enemy pen's block too (the maintainer's decision of 2026-10-15: the pen shows in 休整期),
    // whose front wall holds the partner's (13,13) — as the pen view always did
    assert.deepEqual(blowersIn3d(M01, 'prep'), ['13,13', '13,5', '13,9', '6,5', '6,9'], 'prep');
  });

  test('联防 builds both halves\' row-13 blowers; the Final Assault builds the four row-6 blowers', () => {
    // (the partner's row-6 machines (6,11) / (6,15) stand off the island: row 7–8 are '#' right of col 9 in 联防)
    assert.deepEqual(blowersIn3d(M01, 'unite'), ['13,13', '13,17', '13,5', '13,9', '6,5', '6,9']);
    for (const vk of ['boss', 'bossPrep', viewKind('hidden'), viewKind('prep', { rect: { r0: 0, r1: 5, c0: 0, c1: 10 } })]) {
      assert.deepEqual(blowersIn3d(M01, vk), ['6,11', '6,15', '6,5', '6,9'], vk);
    }
  });

  test('the blower machines stand on the separator blocks; the row-13 ones blow onto the field below them', () => {
    // the battle view's area: the field alone (the prep view adds the pen block, see the repro above)
    const b = buildBoard(M01, { area: boardArea('normal') });
    for (const d of b.devices.filter((x) => x.kind === 'blower')) {
      const t = b.grid[d.r][d.c];
      assert.equal(t.glyph, 'X');
      assert.ok(t.drawn && d.z0 === t.h && t.h > 0, 'on top of the drawn separator block');
      assert.equal(d.dir, 'DOWN');
      // row 13: onto the built field's lanes (rows 12–10); row 6: into the boss field, which this view does not build
      const onto = d.rangeTiles.slice(1).map(([r, c]) => !!b.grid[r][c].content);
      assert.deepEqual(onto, d.r === 13 ? [true, true, true] : [false, false, false], `${d.r},${d.c}`);
    }
    // the separator row is built along the field's top edge (the pen rows 14–18 are not, in battle)
    const rows = new Set(b.grid.flat().filter((t) => t.drawn).map((t) => t.r));
    assert.ok(rows.has(13) && !rows.has(14) && !rows.has(5), [...rows].join());
    // the prep view builds the pen rows too
    const p = new Set(buildBoard(M01, { area: boardArea('prep') }).grid.flat().filter((t) => t.drawn).map((t) => t.r));
    assert.ok(p.has(13) && p.has(14) && p.has(18) && !p.has(5), [...p].join());
  });

  test('the 2D board draws the same blowers and airflow per view', async () => {
    for (const vk of VIEWS) {
      const d2 = await devicesIn2d(M01, vk);
      assert.deepEqual(d2.flow, blowersIn3d(M01, vk), `${vk}: airflow streaks = built blowers`);
    }
  });
});

describe('#6 audit: every device of every stage is drawn in the views of the field it belongs to', () => {
  test('3D board = 2D board for every stage and view', async () => {
    for (const [id, st] of Object.entries(stages)) {
      for (const vk of VIEWS) {
        const d3 = devicesIn3d(st, vk);
        const d2 = (await devicesIn2d(st, vk)).devices;
        assert.deepEqual(d3, d2, `${id} ${vk}`);
      }
    }
  });

  test('every active device standing on the built island of a view is drawn — every field device and every device acting on the field among them', () => {
    const KINDS = new Set(['crate', 'platform', 'mound', 'blower', 'turret', 'waterPlatform', 'bush', 'sealedFloor']);
    const inRect = (r, c, R) => r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1;
    // the fields inside their separator walls (normal / 联防: rows 7–12; boss: rows 0–5)
    const INNER = { prep: { r0: 7, r1: 12, c0: 0, c1: 10 }, unite: { r0: 7, r1: 12, c0: 0, c1: 20 }, boss: { r0: 0, r1: 5, c0: 0, c1: 20 } };
    for (const [id, st] of Object.entries(stages)) {
      for (const [vk, F] of Object.entries(INNER)) {
        const b = buildBoard(st, { area: boardArea(vk) });
        const built = new Set(b.devices.map((d) => `${d.kind}@${d.r},${d.c}`));
        for (const d of st.devices || []) {
          if (!KINDS.has(d.role) || !(typeof d.active === 'boolean' ? d.active : !d.hidden)) continue;
          const [r, c] = d.pos;
          const key = `${d.role}@${r},${c}`;
          const onIsland = boardArea(vk).some((a) => inRect(r, c, a)) && !!b.grid[r]?.[c]?.drawn;
          const acts = (d.rangeTiles || []).some(([rr, cc]) => (rr !== r || cc !== c) && inRect(rr, cc, F) && b.grid[rr]?.[cc]?.content);
          assert.equal(built.has(key), onIsland, `${id} ${vk}: ${key} (${d.alias || d.key}) drawn iff on the built island`);
          if (inRect(r, c, F) || acts) assert.ok(built.has(key), `${id} ${vk}: ${key} of this field drawn`);
        }
      }
    }
  });

  test('stageDevices keeps every active device on a drawn tile', () => {
    const blowers = (area) => stageDevices(M01, classifyStage(M01, area)).filter((d) => d.kind === 'blower').map((d) => `${d.r},${d.c}`).sort();
    assert.deepEqual(blowers(AREAS.boss), ['6,11', '6,15', '6,5', '6,9']);
    assert.deepEqual(blowers(AREAS.normal), ['13,13', '13,5', '13,9', '6,5', '6,9'], 'the pen block\'s front wall holds the partner\'s (13,13)');
    assert.equal(blowers(AREAS.all).length, 8, 'the whole map: all 8');
  });
});
