// test/e2e/client.mjs waitForFunctionLong (Node, no browser): a long wait of the real-server browser suites polls in
// slices shorter than the CDP protocol timeout. A plain page.waitForFunction runs its whole poll inside one
// Runtime.callFunctionOn, which the 90 s protocol timeout cut off: watch-bonds.e2e's "own battle over" wait (240 s) failed
// with a bare "Waiting failed" whenever the own battle at 1× lasted longer than 90 s (0.1.4 release candidate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PROTOCOL_TIMEOUT_MS, waitForFunctionLong } from './client.mjs';

const timeoutError = (ms) => Object.assign(new Error(`Waiting failed: ${ms}ms exceeded`), { name: 'TimeoutError' });

/** A page whose predicate turns true after `trueAfter` ms; each waitForFunction slice behaves like puppeteer's. */
function fakePage(trueAfter) {
  const t0 = Date.now();
  const calls = [];
  return {
    calls,
    waitForFunction(fn, opts, ...args) {
      calls.push({ fn, opts, args });
      const left = t0 + trueAfter - Date.now();
      return new Promise((resolve, reject) => {
        if (left <= opts.timeout) setTimeout(() => resolve({ handle: 'ok', args }), Math.max(0, left));
        else setTimeout(() => reject(timeoutError(opts.timeout)), opts.timeout);
      });
    },
  };
}

/**
 * A page whose predicate holds from its `holdsOn`-th waitForFunction call on; each earlier slice times out after its own
 * timeout, like puppeteer's. Counted in calls, not in wall time: on a loaded machine late timers merge time-based slices
 * (fakePage(95) with 30 ms slices returned in 3 calls instead of 4 in the 0.2.0 candidate's full pass).
 */
function slicedPage(holdsOn) {
  const calls = [];
  return {
    calls,
    waitForFunction(fn, opts, ...args) {
      calls.push({ fn, opts, args });
      const holds = calls.length >= holdsOn;
      return new Promise((resolve, reject) => {
        if (holds) setTimeout(() => resolve({ handle: 'ok', args }), 0);
        else setTimeout(() => reject(timeoutError(opts.timeout)), opts.timeout);
      });
    },
  };
}

test('a wait longer than one slice keeps polling the same predicate until it holds', async () => {
  const page = slicedPage(4);
  const fn = () => true;
  const t0 = Date.now();
  const got = await waitForFunctionLong(page, fn, { timeout: 60_000, polling: 200, slice: 30 }, 'a', 2);
  assert.deepEqual(got, { handle: 'ok', args: ['a', 2] });
  assert.equal(page.calls.length, 4, 'three slices ran out, the fourth held, nothing polled after it');
  assert.ok(Date.now() - t0 >= 85, `the three slices waited their 30 ms each (${Date.now() - t0} ms)`);
  for (const c of page.calls) {
    assert.equal(c.fn, fn);
    assert.deepEqual(c.args, ['a', 2]);
    assert.equal(c.opts.polling, 200);
    assert.ok(c.opts.timeout > 0 && c.opts.timeout <= 30, `slice ${c.opts.timeout}`);
  }
});

test('the overall timeout still ends the wait with a TimeoutError naming it; the last slice is the remainder', async () => {
  const page = fakePage(10_000);
  const t0 = Date.now();
  await assert.rejects(waitForFunctionLong(page, () => false, { timeout: 70, slice: 30 }), (e) => e.name === 'TimeoutError' && /70ms exceeded/.test(e.message));
  assert.ok(Date.now() - t0 >= 65, 'not before the deadline');
  assert.ok(page.calls.at(-1).opts.timeout <= 30);
  assert.ok(page.calls.reduce((n, c) => n + c.opts.timeout, 0) <= 75, 'the slices add up to the timeout');
});

test('any other failure is not retried (a page error, a detached frame, the protocol timeout itself)', async () => {
  for (const err of [new Error('Waiting failed'), Object.assign(new Error('boom'), { name: 'ProtocolError' })]) {
    let n = 0;
    const page = { waitForFunction: () => { n++; return Promise.reject(err); } };
    await assert.rejects(waitForFunctionLong(page, () => true, { timeout: 1000, slice: 30 }), (e) => e === err);
    assert.equal(n, 1);
  }
});

test('the default slice stays well under the protocol timeout every Client launches with', async () => {
  const page = fakePage(0);
  await waitForFunctionLong(page, () => true, { timeout: 240000 });
  assert.ok(page.calls[0].opts.timeout < PROTOCOL_TIMEOUT_MS / 2, `slice ${page.calls[0].opts.timeout}`);
  const client = readFileSync(path.join(ROOT, 'test/e2e/client.mjs'), 'utf8');
  assert.match(client, /protocolTimeout: PROTOCOL_TIMEOUT_MS \}/, 'Client.open launches with the exported constant');
});

test('no Client suite has a plain page.waitForFunction as long as the protocol timeout (use waitForFunctionLong)', () => {
  const files = [];
  for (const dir of ['test/ui', 'test/e2e']) {
    for (const f of readdirSync(path.join(ROOT, dir))) if (/\.(m?js)$/.test(f)) files.push(path.join(dir, f));
  }
  const long = [];
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    if (!/from '\.\.\/e2e\/client\.mjs'|from '\.\/client\.mjs'/.test(src)) continue;
    for (let i = src.indexOf('.waitForFunction('); i >= 0; i = src.indexOf('.waitForFunction(', i + 1)) {
      // the call's own arguments (balanced parentheses), not the text up to the next call: a test's own
      // `{ timeout }` option between two waits is not a wait's timeout
      let end = i + '.waitForFunction('.length;
      for (let depth = 1; end < src.length && depth > 0; end++) depth += src[end] === '(' ? 1 : src[end] === ')' ? -1 : 0;
      const m = src.slice(i, end).match(/\{ timeout: ([0-9_]+)/);
      if (m && Number(m[1].replace(/_/g, '')) >= PROTOCOL_TIMEOUT_MS) long.push(`${f}:${src.slice(0, i).split('\n').length} (${m[1]} ms)`);
    }
  }
  assert.deepEqual(long, []);
});
