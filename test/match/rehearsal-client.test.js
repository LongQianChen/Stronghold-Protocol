// The host's side of the delegated bot layout rehearsal (public/js/battle/rehearsal.js): the page runs the candidates
// in one module Worker off the main thread (the worker itself is exercised in a real browser by
// test/sim/rehearsal-worker.browser.test.js) and answers the match — the pick, or `error` when this browser cannot run
// the task, so the server rehearses at once instead of waiting for its timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRehearsal, MAX_PENDING_TASKS } from '../../public/js/battle/rehearsal.js';

/** The socket double: records sent frames and lets a test push one in. */
function fakeNet() {
  const handlers = new Map();
  const net = {
    sent: [],
    on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
    send(t, fields) { net.sent.push({ t, ...fields }); return true; },
    push(msg) { handlers.get(msg && msg.t)?.(msg); },
    /** a connection state event (`net.snapshot()`, not a `{ t }` frame): 'online' / 'reconnecting' / 'closed' … */
    status(status) { handlers.get('status')?.({ status }); },
    listeners: () => handlers.size,
  };
  return net;
}

/** A Worker double: records what the page posts, replies when the test says so. Its script is evaluated asynchronously
 *  (`ready`), like a real one — a message posted before that is lost, so the report goes out the moment the page
 *  attaches its handler (`onmessage`). */
function fakeWorker({ autoReady = true } = {}) {
  let handler = null;
  const w = {
    messages: [], terminated: false, onerror: null,
    postMessage(m) { w.messages.push(m); },
    terminate() { w.terminated = true; },
    /** answer the running task */
    reply(msg) { handler?.({ data: msg }); },
    /** the task the page posted last */
    task: () => w.messages.filter((m) => m.t === 'rehearsal').pop() || null,
  };
  Object.defineProperty(w, 'onmessage', {
    get: () => handler,
    set(fn) {
      handler = fn;
      if (fn && autoReady) setImmediate(() => w.reply({ t: 'ready' }));
    },
  });
  return w;
}

/** The runner double: the page's simulation data (`loadBrowserSim`'s frozen /data/*.json). */
const fakeRunner = (raw = { chess: {}, enemies: {} }) => ({ calls: 0, ensureSim() { this.calls++; return Promise.resolve({ raw }); } });

const task = (id, specs = [{ v: 1 }]) => ({ t: 'b.rehearsal', taskId: id, playerId: 'ai_0', cap: 300, specs });
const flush = () => new Promise((r) => setImmediate(r));
/** The installer logs to console by default; the tests keep their output clean. */
const QUIET = { warn() {} };

test('a task goes to the worker with the page\'s data once, and its pick is answered', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  const runner = fakeRunner();
  const r = installRehearsal({ net, runner, createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  assert.deepEqual(worker.messages[0], { t: 'data', raw: { chess: {}, enemies: {} } });
  assert.equal(worker.task().taskId, 't1');
  assert.equal(runner.calls, 1);
  worker.reply({ t: 'done', taskId: 't1', choice: 2 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't1', choice: 2 }]);
  // a second task reuses the worker and the data (no second copy, no second load)
  net.push(task('t2'));
  await flush();
  assert.equal(worker.messages.filter((m) => m.t === 'data').length, 1);
  assert.equal(worker.task().taskId, 't2');
  assert.equal(runner.calls, 1);
  worker.reply({ t: 'done', taskId: 't2', choice: 0 });
  assert.equal(net.sent.length, 2);
  r.dispose();
});

test('tasks arriving while the worker is busy are queued in order, and the queue is bounded', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  // MAX_PENDING_TASKS fit behind the running one; the task past the queue is refused at once (the server rehearses it)
  const queued = Array.from({ length: MAX_PENDING_TASKS + 1 }, (_, i) => `t${i + 2}`);
  for (const id of queued) net.push(task(id));
  const refused = queued[queued.length - 1];
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: refused, error: true }]);
  assert.equal(r.pending(), MAX_PENDING_TASKS);
  worker.reply({ t: 'done', taskId: 't1', choice: 1 });
  await flush();
  assert.equal(worker.task().taskId, 't2', 'the oldest queued task runs next');
  for (const id of queued.slice(0, -1)) {
    worker.reply({ t: 'done', taskId: id, choice: 0 });
    await flush();
  }
  assert.deepEqual(net.sent.map((m) => [m.taskId, m.choice ?? null]), [
    [refused, null], ['t1', 1], ...queued.slice(0, -1).map((id) => [id, 0]),
  ]);
  r.dispose();
});

test('a task the worker failed is answered as an error; a crashed worker refuses the later ones', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  worker.reply({ t: 'error', taskId: 't1', message: 'boom' });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't1', error: true }]);
  // a task-level error keeps the worker: the next task still goes there
  net.push(task('t2'));
  await flush();
  assert.equal(worker.task().taskId, 't2');
  // a crashed worker (its module failed to load, an uncaught error) is not reused: later tasks are refused at once
  worker.onerror?.({ message: 'worker crashed' });
  assert.deepEqual(net.sent[1], { t: 'b.rehearsalResult', taskId: 't2', error: true });
  assert.equal(worker.terminated, true);
  net.push(task('t3'));
  await flush();
  assert.deepEqual(net.sent[2], { t: 'b.rehearsalResult', taskId: 't3', error: true });
  assert.equal(worker.messages.filter((m) => m.t === 'rehearsal').length, 2, 'nothing is posted to a dead worker');
  r.dispose();
});

test('a browser without a module Worker refuses every task at once', async () => {
  const net = fakeNet();
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { throw new Error('no workers here'); }, log: QUIET });
  net.push(task('t1'));
  await flush();
  net.push(task('t2'));
  await flush();
  assert.deepEqual(net.sent, [
    { t: 'b.rehearsalResult', taskId: 't1', error: true },
    { t: 'b.rehearsalResult', taskId: 't2', error: true },
  ]);
  r.dispose();
});

test('simulation data that cannot be loaded fails this task only; the next one retries', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  let calls = 0;
  const runner = { ensureSim: () => { calls++; return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ raw: { chess: {} } }); } };
  const r = installRehearsal({ net, runner, createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't1', error: true }]);
  net.push(task('t2'));
  await flush();
  assert.equal(worker.task().taskId, 't2', 'the load is retried for the next task');
  worker.reply({ t: 'done', taskId: 't2', choice: 1 });
  assert.deepEqual(net.sent[1], { t: 'b.rehearsalResult', taskId: 't2', choice: 1 });
  r.dispose();
});

test('a malformed frame is ignored rather than sent to the worker, and dispose detaches the page', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => worker, log: QUIET });
  for (const bad of [null, {}, { t: 'b.rehearsal' }, { t: 'b.rehearsal', taskId: 'x', specs: 'nope' },
    { t: 'b.rehearsal', taskId: 7, playerId: 'ai_0', cap: 300, specs: [{}] },
    { t: 'b.rehearsal', taskId: 'x', playerId: 'ai_0', cap: 'soon', specs: [{}] }]) net.push(bad);
  await flush();
  assert.equal(net.sent.length, 0);
  assert.equal(worker.messages.length, 0, 'nothing to the worker either (it is not even created)');
  // an accepted frame runs, and dispose stops the page for good: no worker, no listener, no answer
  net.push(task('t1'));
  await flush();
  assert.equal(worker.task().taskId, 't1');
  r.dispose();
  assert.equal(net.listeners(), 0, 'the frame listener is gone');
  assert.equal(worker.terminated, true, 'the worker is terminated');
  worker.reply({ t: 'done', taskId: 't1', choice: 0 });
  net.push(task('t9'));
  await flush();
  assert.equal(net.sent.length, 0);
});

test('a task waits for the worker\'s ready report: nothing is posted into a worker still loading', async () => {
  const net = fakeNet();
  const worker = fakeWorker({ autoReady: false });
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  assert.deepEqual(worker.messages, [], 'neither the data nor the task is posted before the worker is up');
  worker.reply({ t: 'ready' }); // what a real module Worker sends once its imports are evaluated
  await flush();
  assert.deepEqual(worker.messages.map((m) => m.t), ['data', 'rehearsal']);
  worker.reply({ t: 'done', taskId: 't1', choice: 1 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't1', choice: 1 }]);
  r.dispose();
});

test('a cancelled task is stopped: its worker is terminated and the next task rebuilds one', async () => {
  const net = fakeNet();
  const workers = [];
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, log: QUIET });
  net.push(task('t1'));
  net.push(task('t2')); // queued behind t1
  await flush();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].task().taskId, 't1');
  net.push({ t: 'b.rehearsalCancel', taskId: 't1' });
  assert.equal(workers[0].terminated, true, 'a running simulation is only stopped by dropping its worker');
  assert.deepEqual(net.sent, [], 'a cancelled task is never answered');
  assert.equal(r.pending(), 0, 'the queued task moved to the worker that replaced it');
  assert.equal(workers.length, 2, 'the next task builds a fresh worker');
  await flush();
  assert.deepEqual(workers[1].messages.map((m) => m.t), ['data', 'rehearsal'], 'a new worker is given the data again');
  assert.equal(workers[1].task().taskId, 't2');
  // the dead worker's late answer cannot answer anything
  workers[0].reply({ t: 'done', taskId: 't1', choice: 0 });
  assert.deepEqual(net.sent, []);
  workers[1].reply({ t: 'done', taskId: 't2', choice: 1 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't2', choice: 1 }]);
  r.dispose();
});

test('a cancel never touches the task that replaced it, nor one already answered', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => worker, log: QUIET });
  net.push(task('t1'));
  await flush();
  net.push({ t: 'b.rehearsalCancel', taskId: 't0' }); // neither running nor queued
  assert.equal(worker.terminated, false);
  assert.equal(worker.task().taskId, 't1');
  net.push({ t: 'b.rehearsalCancel', taskId: 7 }); // malformed: ignored
  worker.reply({ t: 'done', taskId: 't1', choice: 2 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't1', choice: 2 }]);
  net.push(task('t3'));
  await flush();
  net.push({ t: 'b.rehearsalCancel', taskId: 't1' }); // the answer is out; t3 runs on the same worker
  assert.equal(worker.terminated, false);
  assert.equal(worker.task().taskId, 't3');
  r.dispose();
});

test('clear drops the tasks of a match that is over and keeps the installer usable', async () => {
  const net = fakeNet();
  const workers = [];
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, log: QUIET });
  net.push(task('t1'));
  net.push(task('t2'));
  await flush();
  r.clear();
  assert.equal(workers[0].terminated, true, 'the running simulation really stops');
  assert.equal(r.pending(), 0);
  assert.deepEqual(net.sent, [], 'a dropped task is never answered');
  workers[0].reply({ t: 'done', taskId: 't1', choice: 0 });
  net.push({ t: 'b.rehearsalCancel', taskId: 't1' });
  assert.deepEqual(net.sent, []);
  // the next match's tasks are still served (the page keeps its socket listener)
  net.push(task('t9'));
  await flush();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].messages.map((m) => m.t), ['data', 'rehearsal']);
  workers[1].reply({ t: 'done', taskId: 't9', choice: 1 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't9', choice: 1 }]);
  r.dispose();
});

test('an error of a worker that was already dropped cannot break the live one', async () => {
  const net = fakeNet();
  const workers = [];
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, log: QUIET });
  net.push(task('t1'));
  net.push(task('t2'));
  await flush();
  net.push({ t: 'b.rehearsalCancel', taskId: 't1' }); // t1's worker is dropped; t2 runs on the one that replaced it
  await flush();
  assert.equal(workers.length, 2);
  assert.equal(workers[1].task().taskId, 't2');
  // the dropped worker's error arrives late (a terminated Worker can still have one queued): it says nothing about
  // the live worker, and it must not mark this browser unable to run tasks
  workers[0].onerror?.({ message: 'the dropped worker failed late' });
  assert.equal(workers[1].terminated, false, 'the live worker keeps running');
  workers[1].reply({ t: 'done', taskId: 't2', choice: 1 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't2', choice: 1 }]);
  net.push(task('t3'));
  await flush();
  assert.equal(workers[1].task().taskId, 't3', 'a later task still reaches that worker instead of the server');
  assert.equal(workers.length, 2);
  r.dispose();
});

test('a socket that is not online drops the task: its answer could never be delivered', async () => {
  const net = fakeNet();
  const workers = [];
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, log: QUIET });
  net.push(task('t1'));
  net.push(task('t2')); // queued behind t1
  await flush();
  net.status('reconnecting'); // net.send refuses every frame offline, and the cancel frame cannot arrive either
  assert.equal(workers[0].terminated, true, 'the running simulation really stops');
  assert.equal(r.pending(), 0);
  assert.deepEqual(net.sent, [], 'a task dropped with the connection is never answered');
  workers[0].reply({ t: 'done', taskId: 't1', choice: 0 }); // the dropped worker's late answer changes nothing
  // back online the page keeps serving the tasks the server sends (the socket listener is still there)
  net.status('online');
  net.push(task('t9'));
  await flush();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].messages.map((m) => m.t), ['data', 'rehearsal']);
  workers[1].reply({ t: 'done', taskId: 't9', choice: 1 });
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 't9', choice: 1 }]);
  r.dispose();
});

test('without a socket (or in Node) the installer is a no-op', () => {
  assert.equal(installRehearsal({}), null);
  assert.equal(installRehearsal({ net: {} }), null);
});

test('a spec that names a content set is refused without starting the worker', async () => {
  const net = fakeNet();
  const worker = fakeWorker();
  let built = 0;
  const r = installRehearsal({ net, runner: fakeRunner(), createWorker: () => { built++; return worker; }, log: QUIET });
  net.push(task('plugin', [{ v: 1, cs: 'ab'.repeat(32) }]));
  await flush();
  assert.equal(built, 0, 'plugin content never reaches the worker');
  assert.equal(worker.messages.length, 0);
  assert.deepEqual(net.sent, [{ t: 'b.rehearsalResult', taskId: 'plugin', error: true }]);
  r.dispose();
});
