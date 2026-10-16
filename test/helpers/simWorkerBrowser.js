// Served to a module Worker by the browser tests. `node --test` also loads every file under test/, where there is no
// Worker scope and the absolute /vendor/ imports do not resolve: the imports are dynamic and run only in a Worker.
if (typeof WorkerGlobalScope !== 'undefined') {
  const ready = Promise.all([import('./simSandboxFixture.js'), import('/vendor/acorn.mjs')])
    .then(([{ fixtureRuntime }, { parse }]) => fixtureRuntime({ base: '/sim/', loadSES: () => import('/vendor/ses.umd.js'), parse }));
  let queue = Promise.resolve();
  globalThis.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        let value;
        if (data.method === 'network') {
          try { await fetch('/probe-network'); value = 'allowed'; } catch { value = 'blocked'; }
        } else value = await (await ready)(data.method, data.args);
        globalThis.postMessage({ id: data.id, value });
      } catch (e) { globalThis.postMessage({ id: data.id, error: { code: e.code, message: String(e.message) } }); }
    });
  };
}
