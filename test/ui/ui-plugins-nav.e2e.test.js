// Interface-plugin navigation browser test (DESIGN §32.8): a plugin page that navigates its own frame after the
// handshake loses the frame and the feed, and a plugin page opened at the top level has an opaque origin (no site
// storage). Not part of the default run.
//   SP_E2E=1 node --test test/ui/ui-plugins-nav.e2e.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

/** The example widget, plus a second page it navigates to once it has said `ready`. */
function navPlugin(dir) {
  fs.cpSync(path.join(ROOT, 'plugins/_template/ui'), dir, { recursive: true });
  const entry = path.join(dir, 'ui/index.html');
  const html = fs.readFileSync(entry, 'utf8').replace("parent.postMessage({ v: 1, t: 'ready' }, '*');\n      return;",
    "parent.postMessage({ v: 1, t: 'ready' }, '*');\n      setTimeout(function () { location.href = 'away.html?d=' + Date.now(); }, 300);\n      return;");
  assert.notEqual(html, fs.readFileSync(entry, 'utf8'), 'the navigation was added to the example');
  fs.writeFileSync(entry, html);
  // the page it lands on says ready again and records every message it is still sent
  fs.writeFileSync(path.join(dir, 'ui/away.html'), `<!DOCTYPE html><meta charset="utf-8"><body><script>
    window.addEventListener('message', function (ev) { document.title = 'got:' + (ev.data && ev.data.t); });
    parent.postMessage({ v: 1, t: 'ready' }, '*');
  </script></body>`);
}

describe('an interface plugin that navigates its own frame', { skip: !ENABLED }, () => {
  test('the frame is destroyed after leaving the entry, and a top-level open has no site storage', { timeout: 4 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ui-nav-'));
    navPlugin(path.join(tmp, 'nav-meter'));
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true }, pluginsDir: tmp });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'ui-nav', w: 1600, h: 900 });
    try {
      await c.open();
      await c.page.evaluate(() => {
        localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['nav-meter']));
        localStorage.setItem('sp.tokens', JSON.stringify(['probe-token']));
      });
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      // the bridge loads with the match screen
      await c.enter('凯尔希');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      // the frame mounts (as soon as the match screen loads), says ready, then navigates itself to away.html: the
      // host must drop it and block it for this page
      await c.page.waitForFunction(() => (globalThis.__SP_UI_PLUGINS__?.blocked?.() || []).includes('nav-meter'), { timeout: 30000 });
      // and it is not mounted again (and fed again) on the next sync
      await new Promise((r) => setTimeout(r, 3000));
      const after = await c.page.evaluate(() => ({ frames: globalThis.__SP_UI_PLUGINS__.frames(), blocked: globalThis.__SP_UI_PLUGINS__.blocked(), iframe: !!document.querySelector('iframe[data-plugin="nav-meter"]') }));
      assert.ok(!after.frames.includes('nav-meter') && !after.iframe, `the navigated frame stays gone (${JSON.stringify(after)})`);
      assert.ok(after.blocked.includes('nav-meter'), 'the plugin is blocked for this page');
      // the same page opened at the top level runs with an opaque origin: no site storage, no token
      const entry = await c.page.evaluate(async () => {
        const idx = await (await fetch('/plugins/index.json')).json();
        const list = Array.isArray(idx) ? idx : idx.plugins || [];
        const e = list.find((p) => p.id === 'nav-meter');
        return e && e.files && e.entry ? `/p/nav-meter/${String(e.files[e.entry] || '').slice(0, 8)}/${e.entry}` : null;
      });
      const url = entry && /\/p\/nav-meter\/[0-9a-f]{8}\//.test(entry) ? entry : '/p/nav-meter/00000000/ui/index.html';
      const top = await c.browser.newPage();
      const res = await top.goto(srv.base + url, { waitUntil: 'load' });
      assert.match(res.headers()['content-security-policy'] || '', /(^|;)\s*sandbox allow-scripts\b/);
      const probe = await top.evaluate(() => {
        const out = { origin: self.origin };
        try { out.local = localStorage.getItem('sp.tokens'); } catch (e) { out.local = 'denied:' + e.name; }
        return out;
      });
      assert.equal(probe.origin, 'null');
      assert.match(String(probe.local), /^denied:/, `site storage is not readable (${JSON.stringify(probe)})`);
      await top.close();
    } finally {
      await c.close();
      await srv.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
