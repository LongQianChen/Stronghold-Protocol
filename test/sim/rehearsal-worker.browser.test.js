// The delegated bot layout rehearsal in a real browser (DESIGN §14): the page's installer, its module Worker
// (public/js/battle/rehearsalWorker.js) and the shared scoring run a real bot prep's candidate specs in headless
// Chrome/Edge and must pick exactly the candidate Node picks from the same specs — the whole point of sending the
// server's own BattleSpecs: the browser is bit-for-bit the same simulation, so the layout a bot places is the same.
// A task the server cancels (`b.rehearsalCancel`) is stopped there: the page terminates the Worker running it, answers
// nothing for it, and the tasks after it run on the fresh Worker that replaced it (the data sent again).
//
// Opt-in (starts a browser): SIM_E2E=1 node --test test/sim/rehearsal-worker.browser.test.js   (or RENDER_E2E=1)
// Browser path: $CHROME_PATH or the macOS default. Run browser test files one at a time.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeMatch } from '../match/harness.js';
import { simulateRehearsal } from '../match/simClient.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = (process.env.RENDER_E2E === '1' || process.env.SIM_E2E === '1') && existsSync(CHROME);
const skip = enabled ? false : 'set SIM_E2E=1 or RENDER_E2E=1 (needs Chrome)';

/**
 * The `b.rehearsal` frames of a real co-op match's first rounds: the match's host never answers (the tasks time out
 * and the server rehearses them), so the frames are plain data — the specs the browser is handed.
 * @returns {object[]} frames ({ taskId, playerId, cap, specs })
 */
function captureTasks() {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
    { seat: 2, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 3, botRehearsal: 3, hostId: 'p_0', botRehearsalDelegate: true }).start();
  const frames = [];
  h.onSend.push((pid, msg) => { if (msg.t === 'b.rehearsal') frames.push(msg); });
  // one human alone is untimed (soloUntimed): drive its decisions so the AI seats reach their rehearsals
  h.drive(() => frames.length >= 3 || h.ended != null, { ready: true });
  h.m.dispose();
  assert.ok(frames.length >= 3, 'the match delegated at least three rehearsals');
  return frames;
}

describe('a delegated bot rehearsal in the browser', { skip }, () => {
  let srv, browser, tasks;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    tasks = captureTasks();
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('the module Worker loads, runs the specs and picks what Node picks', { timeout: 180000 }, async () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, seed: 3, botRehearsal: 0 }).start();
    const ds = h.m.ds;
    const want = tasks.map((t) => simulateRehearsal(t, ds));
    h.m.dispose();

    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // the browser's own duplicate of a failed request, without its URL (the `response` hook below reports those)
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const answers = await page.evaluate(async (frames) => {
      // the page's own loader (the worker is handed exactly the data the page simulates with) and its installer
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const sim = await loadBrowserSim();
      const { installRehearsal } = await import('/js/battle/rehearsal.js');
      const sent = [];
      const handlers = new Map();
      const net = {
        on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
        send(t, fields) { sent.push({ t, ...fields }); return true; },
      };
      const host = installRehearsal({ net, runner: { ensureSim: () => Promise.resolve(sim) } });
      const wait = async (n) => { for (let i = 0; i < 240 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 25)); };
      // the first task: the Worker simulates and answers
      handlers.get('b.rehearsal')(frames[0]);
      await wait(1);
      // a task the server drops at once (b.rehearsalCancel): the page stops it — terminating the Worker, the only way to
      // interrupt a running simulation — and answers nothing, not even late
      handlers.get('b.rehearsal')(frames[1]);
      handlers.get('b.rehearsalCancel')({ t: 'b.rehearsalCancel', taskId: frames[1].taskId });
      // every later task runs on the Worker that replaced it
      for (const frame of frames.slice(2)) handlers.get('b.rehearsal')(frame);
      await wait(frames.length - 1);
      await new Promise((r) => setTimeout(r, 300));
      host.dispose();
      return sent;
    }, tasks);
    assert.deepEqual(problems, []);
    const kept = tasks.map((t, i) => [t, want[i]]).filter(([t]) => t !== tasks[1]);
    assert.deepEqual(answers.map((a) => a.taskId), kept.map(([t]) => t.taskId), 'every task but the cancelled one was answered');
    assert.deepEqual(answers.map((a) => a.choice), kept.map(([, choice]) => choice), 'the browser picked the candidate Node picks');
    for (const [i, a] of answers.entries()) assert.equal(a.error, undefined, `task ${i} ran: ${JSON.stringify(a)}`);
  });
});
