// Awaiting game data must never let an obsolete loadout overwrite a later edit/reset.
// These are controlled readiness inputs; the real screen route is the same prepare/flush path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../public/js/store.js';
import { installLoadoutSync, SYNC_DEBOUNCE_MS, RETRY_MS } from '../../public/js/ui/loadoutSync.js';
import { cultivationCharIds } from '../../shared/protocol.js';

const CHESS = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url)));
const BACKUPS = JSON.parse(readFileSync(new URL('../../data/backups.json', import.meta.url)));
const INSIDE = 'chess_char_1_01_a';
const CHAR = CHESS[INSIDE].charId;
const ENTRIES = { [INSIDE]: { skill: 0 } };
const OPS = { [CHAR]: { potential: 1 } };
const IDS = cultivationCharIds(CHESS, BACKUPS);
const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function waitingData() {
  const started = deferred(), result = deferred();
  return { started: started.promise, ...result, ready() { started.resolve(); return result.promise; } };
}
function harness({ chess = async () => CHESS, backups = async () => BACKUPS } = {}) {
  const listeners = new Map(), pending = new Map();
  let time = 0, timerId = 0;
  const timers = {
    setTimeout(fn, ms) { const id = ++timerId; pending.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      time += ms;
      for (const [id, task] of [...pending]) if (task.at <= time) { pending.delete(id); task.fn(); await ticks(); }
      await ticks();
    },
  };
  const net = {
    status: 'online', sent: [], failures: [],
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    emit(name, msg = {}) { listeners.get(name)?.(msg); },
    async request(t, fields) {
      net.sent.push({ t, ...fields });
      const code = net.failures.shift();
      if (code) throw Object.assign(new Error(code), { code });
      return { t: 'ok' };
    },
  };
  const target = createStore({ entries: ENTRIES, ops: OPS, open: true, sync: 'idle' });
  const sync = installLoadoutSync({ net, timers, target, getChessReady: chess, getBackupsReady: backups,
    lookupChess: (id) => CHESS[id], operatorIds: () => IDS });
  return { net, timers, target, ...sync };
}
const empty = { t: 'room.loadout', entries: {}, ops: {} };

test('sync: a reset supersedes the old loadout awaiting backups, even after the reset was accepted', async (t) => {
  const wait = waitingData(), h = harness({ backups: wait.ready });
  t.after(h.dispose);
  const old = h.flush();
  await wait.started;
  // The screen resets ops and entries separately, then the debounced flush sends the empty configuration.
  h.target.set({ ops: {} });
  h.target.set({ entries: {} });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent, [empty]);
  assert.equal(h.target.get().sync, 'synced');
  wait.resolve(BACKUPS);
  await old;
  assert.deepEqual(h.net.sent, [empty], 'the late old skill must never go back to the server');
  assert.deepEqual(h.target.get().entries, {});
  assert.deepEqual(h.target.get().ops, {});
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: a later nonempty edit wins while the old backups preparation is waiting', async (t) => {
  const wait = waitingData(); let calls = 0;
  const h = harness({ backups: () => ++calls === 1 ? wait.ready() : Promise.resolve(BACKUPS) });
  t.after(h.dispose);
  const old = h.flush();
  await wait.started;
  h.target.set({ entries: { [INSIDE]: { skill: 0, module: 'none' } }, ops: { [CHAR]: { potential: 2 } } });
  await h.flush();
  wait.resolve(BACKUPS);
  await old;
  assert.deepEqual(h.net.sent, [{ t: 'room.loadout', entries: { [INSIDE]: { skill: 0, module: 'none' } }, ops: { [CHAR]: { potential: 2 } } }]);
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: an edit invalidates preparation before its debounce runs', async (t) => {
  const wait = waitingData(), h = harness({ backups: wait.ready });
  t.after(h.dispose);
  const old = h.flush();
  await wait.started;
  h.target.set({ entries: {}, ops: {} });
  wait.resolve(BACKUPS);
  await old;
  assert.deepEqual(h.net.sent, [], 'no stale message during the new edit debounce');
  assert.equal(h.target.get().sync, 'pending');
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent, [empty]);
  assert.equal(h.target.get().sync, 'synced');
});

for (const failure of ['missing', 'rejected']) test(`sync: obsolete ${failure} data does not replace the accepted reset status`, async (t) => {
  const wait = waitingData(), h = harness({ backups: wait.ready });
  t.after(h.dispose);
  t.mock.method(console, 'warn', () => {});
  const old = h.flush();
  await wait.started;
  h.target.set({ entries: {}, ops: {} });
  await h.flush();
  if (failure === 'missing') wait.resolve(null); else wait.reject(new Error('download failed'));
  await old;
  assert.deepEqual(h.net.sent, [empty]);
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: welcome invalidates preparation from the earlier session', async (t) => {
  const wait = waitingData(); let calls = 0;
  const h = harness({ backups: () => ++calls === 1 ? wait.ready() : Promise.resolve(BACKUPS) });
  t.after(h.dispose);
  const old = h.flush();
  await wait.started;
  h.net.emit('welcome');
  await h.timers.advance(50);
  assert.equal(h.target.get().sync, 'synced');
  wait.resolve(null);
  await old;
  assert.deepEqual(h.net.sent, [{ t: 'room.loadout', entries: ENTRIES, ops: OPS }]);
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: an obsolete result does not swallow the newest reset RATE retry', async (t) => {
  const wait = waitingData(), h = harness({ backups: wait.ready });
  t.after(h.dispose);
  const old = h.flush();
  await wait.started;
  h.target.set({ entries: {}, ops: {} });
  h.net.failures.push('RATE');
  await h.flush();
  assert.equal(h.target.get().sync, 'pending');
  wait.resolve(BACKUPS);
  await old;
  assert.equal(h.target.get().sync, 'pending');
  await h.timers.advance(RETRY_MS);
  assert.deepEqual(h.net.sent, [empty, empty]);
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: a current missing-data preparation remains an error and can be retried', async (t) => {
  let missing = true;
  const h = harness({ backups: async () => missing ? null : BACKUPS });
  t.after(h.dispose);
  await h.flush();
  assert.deepEqual(h.net.sent, []);
  assert.equal(h.target.get().sync, 'error');
  missing = false;
  await h.flush();
  assert.deepEqual(h.net.sent, [{ t: 'room.loadout', entries: ENTRIES, ops: OPS }]);
  assert.equal(h.target.get().sync, 'synced');
});

test('sync: unrelated screen state changes do not cancel a current preparation', async (t) => {
  const wait = waitingData(), h = harness({ backups: wait.ready });
  t.after(h.dispose);
  const current = h.flush();
  await wait.started;
  h.target.set({ sel: INSIDE });
  wait.resolve(BACKUPS);
  await current;
  assert.deepEqual(h.net.sent, [{ t: 'room.loadout', entries: ENTRIES, ops: OPS }]);
  assert.equal(h.target.get().sync, 'synced');
});
