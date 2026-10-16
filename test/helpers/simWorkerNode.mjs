import { parentPort } from 'node:worker_threads';
import { fixtureRuntime } from './simSandboxFixture.js';
import { parse } from 'acorn';
// `node --test` also loads every file under test/: outside a worker thread there is nothing to serve
if (!parentPort) process.exit(0);
const dispatch = fixtureRuntime({ base: new URL('../../server/sim/', import.meta.url).href, loadSES: () => import('ses'), parse });
let queue = Promise.resolve();
parentPort.on('message', data => {
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id: data.id, value: await dispatch(data.method, data.args) }); }
    catch (e) { parentPort.postMessage({ id: data.id, error: { code: e.code, message: e.message } }); }
  });
});
