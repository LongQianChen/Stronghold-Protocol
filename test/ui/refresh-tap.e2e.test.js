// test/ui/refresh-tap.e2e.test.js — GitHub #501 (single-ptilopsis): 高延迟下连按「刷新」只发送一次请求. Through the mock
// harness (public/dev/game-mock.html) in headless Chrome, with the mock's reply to g.refresh delayed: the first tap
// sends one request and dims the button, a spam tap and the R key while it is on the wire send nothing, the shop pays
// once, and the next tap after the reply refreshes again. Opt-in: SP_E2E=1 (needs Chrome; CHROME_PATH overrides).
//
//   SP_E2E=1 node --test test/ui/refresh-tap.e2e.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BTN = '.shopbar__tools .toolbtn--amber';

describe('the shop refresh single-flights (GitHub #501, mock harness, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('a tap under a lagging shop pays once: the button dims, the extra tap / R key are dropped, the next tap works', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`${base}/dev/game-mock.html?shot=1&phase=PREP&render=fallback`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)') && !!globalThis.__SP_VIEW__, { timeout: 20000 });
    // the mock answers instantly; give g.refresh a high RTT, and count what the client actually sends (gameActions.js
    // looks net.request up at call time; the mock's own request record only sees the request after the delay)
    await page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      const orig = net.request.bind(net);
      globalThis.__REFRESHES__ = 0;
      net.request = (t, ...rest) => {
        if (t === 'g.refresh') globalThis.__REFRESHES__ += 1;
        return new Promise((res, rej) => {
          setTimeout(() => orig(t, ...rest).then(res, rej), t === 'g.refresh' ? 700 : 0);
        });
      };
    });
    const btnState = () => page.evaluate(() => {
      const b = document.querySelector('.shopbar__tools .toolbtn--amber');
      return { disabled: !!b?.disabled, title: b?.title || null };
    });
    const refreshes = () => page.evaluate(() => globalThis.__REFRESHES__);
    const funds = () => page.evaluate(() => globalThis.__MOCK__.S().priv.funds);

    assert.equal((await btnState()).disabled, false, 'the 刷新 button starts enabled');
    const n0 = await refreshes();
    const f0 = await funds();
    await page.click(BTN);
    await sleep(150);
    assert.equal(await refreshes(), n0 + 1, 'the tap sent one g.refresh');
    assert.deepEqual(await btnState(), { disabled: true, title: '正在刷新…' }, 'the button dims and says it is waiting');
    // the spam tap (the disabled button swallows clicks) and the R hotkey while pending: neither reaches the socket
    await page.evaluate(() => document.querySelector('.shopbar__tools .toolbtn--amber')?.click());
    await page.keyboard.press('r');
    await sleep(200);
    assert.equal(await refreshes(), n0 + 1, 'nothing else was sent');
    await page.waitForFunction(() => !document.querySelector('.shopbar__tools .toolbtn--amber')?.disabled, { timeout: 5000 });
    const back = await btnState();
    assert.equal(back.disabled, false, 'the button is enabled again after the reply');
    assert.match(back.title, /刷新商店/, 'the tooltip is back to the hotkey hint');
    assert.equal(await funds(), f0 - 1, 'the shop paid exactly one refresh');
    await page.click(BTN);
    await sleep(150);
    assert.equal(await refreshes(), n0 + 2, 'a refresh after the reply is sent again');
    await page.waitForFunction(() => !document.querySelector('.shopbar__tools .toolbtn--amber')?.disabled, { timeout: 5000 });
    assert.equal(await funds(), f0 - 2, 'and paid once more');
    await page.close();
  });
});
