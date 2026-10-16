// test/render/drag.test.js — drop target resolution, the pointer state machine (no DOM, fake timers) and the tile a
// dragged unit is drawn standing on (dragStandTile; the harness's 100 px grid stands in for the camera's tile pick).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GEO } from '../../shared/constants.js';
import { tileSlot, pieceSlot, pieceTile, resolveDrop, isLegal, sameSlot, createDragController, dragStandTile } from '../../public/js/render/drag.js';

describe('slots & targets', () => {
  test('tileSlot classifies hand, temp, board and everything else', () => {
    assert.deepEqual(tileSlot({ row: 7, col: 0 }), { area: 'hand', idx: 0 });
    assert.deepEqual(tileSlot({ row: 7, col: 9 }), { area: 'hand', idx: 9 });
    assert.equal(tileSlot({ row: 7, col: 10 }), null);
    assert.deepEqual(tileSlot({ row: 8, col: 4 }), { area: 'temp', idx: 0 });
    assert.deepEqual(tileSlot({ row: 8, col: 8 }), { area: 'temp', idx: 4 });
    assert.equal(tileSlot({ row: 8, col: 3 }), null);
    assert.deepEqual(tileSlot({ row: 9, col: 2 }), { area: 'board', row: 9, col: 2 });
    assert.deepEqual(tileSlot({ row: 12, col: 10 }), { area: 'board', row: 12, col: 10 });
    assert.equal(tileSlot({ row: 12, col: 11 }), null, 'partner half is not ours');
    assert.equal(tileSlot({ row: 9, col: 1 }), null);
    assert.equal(tileSlot({ row: 13, col: 5 }), null);
    assert.equal(tileSlot({ row: 3, col: 5 }), null, 'boss field is not a prep target');
    assert.equal(tileSlot(null), null);
    assert.equal(tileSlot({ row: 9.5, col: 3 }), null);
  });

  test('pieceSlot / pieceTile for hand, temp, board', () => {
    assert.deepEqual(pieceSlot({ uid: 1, area: 'hand', idx: 3 }), { area: 'hand', idx: 3 });
    assert.deepEqual(pieceTile({ uid: 1, area: 'hand', idx: 3 }), { row: GEO.HAND_ROW, col: 3 });
    assert.deepEqual(pieceSlot({ uid: 1, area: 'temp', idx: 2 }), { area: 'temp', idx: 2 });
    assert.deepEqual(pieceTile({ uid: 1, area: 'temp', idx: 2 }), { row: GEO.TEMP_ROW, col: GEO.TEMP_C0 + 2 });
    assert.deepEqual(pieceSlot({ uid: 1, area: 'board', row: 10, col: 4 }), { area: 'board', row: 10, col: 4 });
    assert.deepEqual(pieceTile({ uid: 1, row: 10, col: 4 }), { row: 10, col: 4 });
    assert.equal(pieceSlot(null), null);
    assert.equal(pieceTile({ uid: 1 }), null);
    assert.ok(sameSlot({ area: 'hand', idx: 1 }, { area: 'hand', idx: 1 }));
    assert.ok(!sameSlot({ area: 'hand', idx: 1 }, { area: 'board', row: 1, col: 1 }));
  });

  test('resolveDrop: board, hand, outside, cancel cases', () => {
    const piece = { uid: 5, area: 'hand', idx: 2 };
    const from = pieceSlot(piece);
    const base = { piece, from, overCanvas: true, clientX: 10, clientY: 20 };
    assert.deepEqual(resolveDrop({ ...base, tile: { row: 10, col: 5 } }), { kind: 'drop', target: { area: 'board', row: 10, col: 5 } });
    assert.deepEqual(resolveDrop({ ...base, tile: { row: 7, col: 6 } }), { kind: 'drop', target: { area: 'hand', idx: 6 } });
    assert.equal(resolveDrop({ ...base, tile: { row: 7, col: 2 } }).reason, 'same');
    assert.equal(resolveDrop({ ...base, tile: { row: 8, col: 5 } }).reason, 'temp');
    assert.equal(resolveDrop({ ...base, tile: { row: 15, col: 9 } }).reason, 'notTarget');
    assert.deepEqual(resolveDrop({ ...base, tile: null }), { kind: 'drop', target: { area: 'outside', clientX: 10, clientY: 20 } });
    assert.deepEqual(resolveDrop({ ...base, tile: { row: 10, col: 5 }, overCanvas: false }).target.area, 'outside');
    const canPlace = (p, r, c) => !(r === 10 && c === 5);
    assert.equal(resolveDrop({ ...base, tile: { row: 10, col: 5 }, canPlace }).reason, 'illegal');
    assert.equal(resolveDrop({ ...base, tile: { row: 10, col: 6 }, canPlace }).kind, 'drop');
    // hand targets ask canPlace with (HAND_ROW, idx)
    const seen = [];
    resolveDrop({ ...base, tile: { row: 7, col: 8 }, canPlace: (p, r, c, t) => { seen.push([r, c, t.area]); return true; } });
    assert.deepEqual(seen, [[GEO.HAND_ROW, 8, 'hand']]);
  });

  test('isLegal: throwing callback ⇒ illegal; no callback ⇒ legal; temp/outside never', () => {
    assert.equal(isLegal(() => { throw new Error('x'); }, {}, { area: 'board', row: 9, col: 3 }), false);
    assert.equal(isLegal(null, {}, { area: 'board', row: 9, col: 3 }), true);
    assert.equal(isLegal(null, {}, { area: 'temp', idx: 0 }), false);
    assert.equal(isLegal(null, {}, null), false);
  });
});

/** Harness: pieces at canvas points, tiles from a simple 100px grid (col = x/100, row = 12 - y/100). */
function harness(opts = {}) {
  const events = [];
  const timers = new Map();
  let nextTimer = 1;
  const pieces = opts.pieces || [
    { uid: 1, area: 'hand', idx: 0, x: 50, y: 550 },     // tile (7,0)
    { uid: 2, area: 'board', row: 10, col: 4, x: 450, y: 250 },
    { uid: 3, area: 'hand', idx: 1, x: 150, y: 550, draggable: false },
  ];
  const c = createDragController({
    hitPiece: (x, y) => pieces.find((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 40) || null,
    pickTile: (x, y) => (x < 0 || y < 0 || x >= 2100 ? null : { row: 12 - Math.floor(y / 100), col: Math.floor(x / 100) }),
    isOverCanvas: (cx, cy) => !(opts.domCover && cy > 900),
    canPlace: opts.canPlace,
    emit: (name, p) => events.push([name, p]),
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const ev = (type, x, y, extra = {}) => c[type]({ pointerId: 1, pointerType: 'mouse', button: 0, x, y, clientX: x, clientY: y, ...extra });
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  const names = () => events.map((e) => e[0]).filter((n) => n !== 'pieceDragMove' && n !== 'tileHover');
  return { c, events, ev, fire, names, timers };
}

describe('drag controller', () => {
  test('click without movement emits pieceClick (not a drag)', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 52, 551);
    h.ev('pointerUp', 52, 551);
    assert.deepEqual(h.names(), ['pieceClick']);
    assert.equal(h.events[0][1].uid, 1);
    assert.equal(h.events[0][1].detail, false);
  });

  test('drag hand → board emits start, moves, drop with board target, end', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 70, 540);
    assert.ok(h.c.dragging);
    h.ev('pointerMove', 350, 250);
    h.ev('pointerUp', 350, 250);
    assert.deepEqual(h.names(), ['pieceDragStart', 'pieceDrop', 'pieceDragEnd']);
    const drop = h.events.find((e) => e[0] === 'pieceDrop')[1];
    assert.deepEqual(drop.target, { area: 'board', row: 10, col: 3 });
    assert.deepEqual(drop.from, { area: 'hand', idx: 0 });
    const moves = h.events.filter((e) => e[0] === 'pieceDragMove');
    assert.ok(moves.length >= 2);
    assert.equal(moves[moves.length - 1][1].legal, true);
    assert.ok(h.events.some((e) => e[0] === 'tileHover' && e[1] && e[1].row === 10 && e[1].col === 3));
    assert.equal(h.c.dragging, false);
  });

  test('illegal tile (canPlace false) cancels; legality shown during the move', () => {
    const h = harness({ canPlace: (p, r, c) => c !== 3 });
    h.c.setEditable(true);
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 350, 250);
    const mv = h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.equal(mv.legal, false);
    assert.deepEqual(mv.target, { area: 'board', row: 10, col: 3 });
    h.ev('pointerUp', 350, 250);
    assert.deepEqual(h.names(), ['pieceDragStart', 'pieceDragEnd']);
    assert.equal(h.events.pop()[1].cancelled, true);
  });

  test('release over DOM covering the canvas ⇒ outside target with client coords', () => {
    const h = harness({ domCover: true });
    h.c.setEditable(true);
    h.ev('pointerDown', 450, 250);
    h.ev('pointerMove', 470, 950);
    h.ev('pointerUp', 470, 950);
    const drop = h.events.find((e) => e[0] === 'pieceDrop')[1];
    assert.deepEqual(drop.target, { area: 'outside', clientX: 470, clientY: 950 });
    assert.deepEqual(drop.from, { area: 'board', row: 10, col: 4 });
  });

  test('not editable: press+move does not drag; release gives no click; hover still works', () => {
    const h = harness();
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 300, 300);
    h.ev('pointerUp', 300, 300);
    assert.deepEqual(h.names(), []);
    h.ev('pointerMove', 450, 250);
    assert.deepEqual(h.names(), ['pieceHover']);
    assert.equal(h.events.find((e) => e[0] === 'pieceHover')[1].uid, 2);
    h.ev('pointerMove', 1000, 250);
    assert.equal(h.events.filter((e) => e[0] === 'pieceHover').pop()[1].uid, null);
  });

  test('non-draggable pieces never start a drag', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 150, 550);
    h.ev('pointerMove', 400, 300);
    h.ev('pointerUp', 400, 300);
    assert.deepEqual(h.names(), []);
  });

  test('right click ⇒ pieceClick(detail) + pieceDetail, no drag', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 450, 250, { button: 2 });
    assert.deepEqual(h.names(), ['pieceClick', 'pieceDetail']);
    assert.equal(h.events[0][1].detail, true);
    h.ev('pointerMove', 600, 300);
    assert.equal(h.c.dragging, false);
  });

  test('touch long-press ⇒ detail; the later release is not a click', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 450, 250, { pointerType: 'touch' });
    h.fire();
    h.ev('pointerUp', 450, 250, { pointerType: 'touch' });
    assert.deepEqual(h.names(), ['pieceClick', 'pieceDetail']);
    assert.equal(h.events[0][1].detail, true);
  });

  test('touch drag cancels the long-press timer and uses a larger threshold', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 450, 250, { pointerType: 'touch' });
    h.ev('pointerMove', 457, 250, { pointerType: 'touch' });
    assert.equal(h.c.dragging, false, 'below touch threshold');
    h.ev('pointerMove', 470, 250, { pointerType: 'touch' });
    assert.equal(h.c.dragging, true);
    assert.equal(h.timers.size, 0, 'long-press timer cleared');
    h.ev('pointerUp', 550, 350, { pointerType: 'touch' });
    assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'board', row: 9, col: 5 });
  });

  test('setEditable(false) during a drag cancels it; pointerCancel cancels; other pointers ignored', () => {
    const h = harness();
    h.c.setEditable(true);
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 300, 300);
    h.c.setEditable(false);
    assert.equal(h.c.dragging, false);
    assert.deepEqual(h.names(), ['pieceDragStart', 'pieceDragEnd']);
    h.c.setEditable(true);
    h.ev('pointerDown', 50, 550);
    h.ev('pointerMove', 300, 300, { pointerId: 2 });
    assert.equal(h.c.dragging, false, 'second pointer ignored');
    h.ev('pointerMove', 300, 300);
    h.c.pointerCancel({ pointerId: 1 });
    assert.equal(h.c.dragging, false);
    assert.equal(h.events.filter((e) => e[0] === 'pieceDrop').length, 0);
  });

  // user playtest #4 item 1: everything is judged at the pointer — the tile under it is the target (tileHover, legality,
  // the drop) for a mouse and a finger alike (v2.2 lifted a touch drag's target 0.6 tile above the finger)
  test('the target, tileHover, legality and the drop are the tile under the pointer (mouse and touch)', () => {
    for (const pointerType of ['mouse', 'touch']) {
      const h = harness({ canPlace: (p, r) => r !== 11 });
      h.c.setEditable(true);
      h.ev('pointerDown', 50, 550, { pointerType });
      h.ev('pointerMove', 450, 350, { pointerType });
      let mv = h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
      assert.deepEqual([mv.x, mv.y, mv.target, mv.legal], [450, 350, { area: 'board', row: 9, col: 4 }, true], pointerType);
      assert.ok(h.events.some((e) => e[0] === 'tileHover' && e[1] && e[1].row === 9 && e[1].col === 4), `${pointerType}: tileHover = the target`);
      h.ev('pointerMove', 450, 150, { pointerType });
      mv = h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
      assert.deepEqual([mv.target, mv.legal], [{ area: 'board', row: 11, col: 4 }, false], `${pointerType}: row 11 under the pointer is illegal`);
      h.ev('pointerMove', 450, 350, { pointerType });
      h.ev('pointerUp', 450, 350, { pointerType });
      assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'board', row: 9, col: 4 }, pointerType);
    }
  });

  test('presses and hover pick the piece at the pointer (the view\'s hitPiece: the piece on the tile there)', () => {
    const asked = [];
    const pieces = [{ uid: 1, area: 'hand', idx: 0, x: 50, y: 550 }];
    const c = createDragController({
      hitPiece: (x, y) => { asked.push([x, y]); return pieces.find((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 40) || null; },
      pickTile: (x, y) => ({ row: 12 - Math.floor(y / 100), col: Math.floor(x / 100) }),
      emit: () => {},
    });
    const ev = (type, x, y, pointerType = 'mouse') => c[type]({ pointerId: 1, pointerType, button: 0, x, y, clientX: x, clientY: y });
    c.setEditable(true);
    ev('pointerMove', 60, 560);
    ev('pointerDown', 55, 545, 'touch');
    assert.deepEqual(asked, [[60, 560], [55, 545]], 'hover and press ask at the pointer itself');
    ev('pointerMove', 355, 255, 'touch');
    ev('pointerUp', 355, 255, 'touch');
    assert.equal(asked.length, 2, 'a drag asks no hit-test');
  });

  // on a phone the bench is the lowest canvas row and the shop bar (DOM) sits right under it: a release with the finger
  // on the shop bar is 'outside' (the piece goes back); on the bench slot above it, it lands there
  test('DOM cover is judged at the pointer: a touch release over the shop bar is outside, on the bench it lands', () => {
    const h = harness({ domCover: true });
    h.c.setEditable(true);
    h.ev('pointerDown', 450, 250, { pointerType: 'touch' });
    h.ev('pointerMove', 250, 550, { pointerType: 'touch' });
    let mv = h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.deepEqual([mv.target, mv.legal], [{ area: 'hand', idx: 2 }, true]);
    h.ev('pointerUp', 250, 550, { pointerType: 'touch' });
    assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'hand', idx: 2 });
    h.events.length = 0;
    h.ev('pointerDown', 450, 250, { pointerType: 'touch' });
    h.ev('pointerMove', 250, 950, { pointerType: 'touch' });
    mv = h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.equal(mv.target, null, 'the finger on the DOM: no target');
    assert.ok(h.events.some((e) => e[0] === 'tileHover' && e[1] === null), 'no tile lit');
    h.ev('pointerUp', 250, 950, { pointerType: 'touch' });
    assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'outside', clientX: 250, clientY: 950 });
  });

  // GitHub #602 (PR #646): picking a piece up zooms the board to the shop-collapsed camera while the pointer may stand
  // still — refresh() judges the drag again at the last pointer, so the target, tileHover and the dragged piece follow
  test('refresh(): a still pointer over a moving camera gets the tile now under it; no-op unless dragging', () => {
    let shift = 0; // the "camera": the tile under a canvas point moves by `shift` columns
    const events = [];
    const pieces = [{ uid: 1, area: 'hand', idx: 0, x: 50, y: 550 }];
    const c = createDragController({
      hitPiece: (x, y) => pieces.find((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 40) || null,
      pickTile: (x, y) => ({ row: 12 - Math.floor(y / 100), col: Math.floor(x / 100) + shift }),
      emit: (name, p) => events.push([name, p]),
    });
    const ev = (type, x, y) => c[type]({ pointerId: 1, pointerType: 'touch', button: 0, x, y, clientX: x, clientY: y });
    c.refresh();
    assert.equal(events.length, 0, 'nothing to judge before a drag');
    c.setEditable(true);
    ev('pointerDown', 50, 550);
    c.refresh();
    assert.equal(events.filter((e) => e[0] === 'pieceDragMove').length, 0, 'a press is not a drag yet');
    ev('pointerMove', 450, 350);
    let mv = events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.deepEqual([mv.x, mv.y, mv.target], [450, 350, { area: 'board', row: 9, col: 4 }]);
    shift = 1; // the zoom moved the board under the finger
    c.refresh();
    mv = events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.deepEqual([mv.x, mv.y, mv.target], [450, 350, { area: 'board', row: 9, col: 5 }], 'the same pointer, the tile under it now');
    assert.deepEqual(events.filter((e) => e[0] === 'tileHover').pop()[1], { row: 9, col: 5, area: 'board', idx: undefined });
    ev('pointerUp', 450, 350);
    assert.deepEqual(events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'board', row: 9, col: 5 });
    const n = events.length;
    c.refresh();
    assert.equal(events.length, n, 'after the drop: no-op');
  });

  test('a throwing listener or hit-test never breaks the controller', () => {
    const c = createDragController({
      hitPiece: () => { throw new Error('boom'); },
      pickTile: () => { throw new Error('boom'); },
      emit: () => { throw new Error('listener'); },
    });
    c.setEditable(true);
    const orig = console.error; console.error = () => {};
    try {
      assert.equal(c.pointerDown({ pointerId: 1, x: 1, y: 1, button: 0 }), false);
      c.pointerMove({ pointerId: 1, x: 5, y: 5 });
      c.pointerUp({ pointerId: 1, x: 5, y: 5 });
      c.pointerLeave({});
      c.reset();
    } finally { console.error = orig; }
  });
});

// The official deploy drag (the owner's recording of 2026-10-09; the report in PR #403): the dragged unit is drawn
// standing on the tile under the pointer while that is a legal target, and held under the pointer elsewhere. The tile
// is the drag target itself, so the pick, tileHover, the highlight and the drop stay the pointer's tile.
describe('the tile a dragged unit stands on (dragStandTile)', () => {
  test('a legal board tile or bench slot is stood on; an illegal tile, a temp slot, no target hold it under the pointer', () => {
    assert.deepEqual(dragStandTile({ target: { area: 'board', row: 10, col: 3 }, legal: true }), { row: 10, col: 3, bench: false });
    assert.deepEqual(dragStandTile({ target: { area: 'hand', idx: 6 }, legal: true }), { row: GEO.HAND_ROW, col: 6, bench: true });
    assert.equal(dragStandTile({ target: { area: 'board', row: 10, col: 3 }, legal: false }), null, 'an illegal tile');
    assert.equal(dragStandTile({ target: { area: 'hand', idx: 6 }, legal: false }), null, 'the own bench slot / an illegal slot');
    assert.equal(dragStandTile({ target: { area: 'temp', idx: 1 }, legal: true }), null, 'a temp slot is never a target');
    assert.equal(dragStandTile({ target: { area: 'outside', clientX: 1, clientY: 2 }, legal: true }), null);
    assert.equal(dragStandTile({ target: null, legal: false }), null, 'off the grid, over the shop bar');
    assert.equal(dragStandTile({ target: { area: 'board', row: 10, col: 3 }, legal: 1 }), null, 'legal must be true');
    assert.equal(dragStandTile({ target: { area: 'board', row: 9.5, col: 3 }, legal: true }), null);
    assert.equal(dragStandTile({ target: { area: 'hand' }, legal: true }), null);
    assert.equal(dragStandTile(null), null);
    assert.equal(dragStandTile(undefined), null);
    assert.deepEqual(dragStandTile({ target: { area: 'hand', idx: 2 }, legal: true }, { HAND_ROW: 3 }), { row: 3, col: 2, bench: true }, 'geo is a parameter');
  });

  test('over the drag path: one tile while the pointer moves inside it, the next legal tile at once, none where no drop lands (mouse and touch)', () => {
    for (const pointerType of ['mouse', 'touch']) {
      const h = harness({ domCover: true, canPlace: (p, r, c) => !(r === 11 && c === 4) });
      h.c.setEditable(true);
      const stand = () => dragStandTile(h.events.filter((e) => e[0] === 'pieceDragMove').pop()[1]);
      const at = (x, y) => { h.ev('pointerMove', x, y, { pointerType }); return stand(); };
      h.ev('pointerDown', 50, 550, { pointerType });
      assert.equal(at(50, 530), null, `${pointerType}: on its own bench slot (no target) it is held under the pointer`);
      assert.ok(h.c.dragging);
      // the pointer anywhere on (9,4) (x 400–499, y 300–399 in the harness grid): the unit stands on (9,4) the whole time
      const inside = [[410, 390], [450, 350], [495, 305], [402, 301]].map(([x, y]) => at(x, y));
      assert.deepEqual(inside, Array(4).fill({ row: 9, col: 4, bench: false }), `${pointerType}: moving inside the tile leaves it there`);
      assert.deepEqual(at(450, 299), { row: 10, col: 4, bench: false }, `${pointerType}: the next tile takes it at once`);
      assert.equal(at(450, 150), null, `${pointerType}: an illegal tile (11,4)`);
      assert.equal(at(550, 450), null, `${pointerType}: a temp slot`);
      assert.deepEqual(at(250, 550), { row: GEO.HAND_ROW, col: 2, bench: true }, `${pointerType}: another bench slot`);
      assert.equal(at(250, 950), null, `${pointerType}: over the shop bar (DOM over the canvas)`);
      assert.equal(at(-20, 300), null, `${pointerType}: off the grid`);
      assert.deepEqual(at(350, 250), { row: 10, col: 3, bench: false });
      h.ev('pointerUp', 350, 250, { pointerType });
      assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'board', row: 10, col: 3 }, `${pointerType}: dropped on the tile it stood on`);
      // a board piece lifts on its own tile (a legal drop: the direction wheel re-orients it in place)
      h.events.length = 0;
      h.ev('pointerDown', 450, 250, { pointerType });
      assert.deepEqual(at(470, 230), { row: 10, col: 4, bench: false }, `${pointerType}: a board piece stands on its own tile`);
      h.ev('pointerUp', 470, 230, { pointerType });
      assert.deepEqual(h.events.find((e) => e[0] === 'pieceDrop')[1].target, { area: 'board', row: 10, col: 4 });
    }
  });
});
