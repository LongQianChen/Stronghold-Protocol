// test/render/eyemask.browser.test.js — GitHub #647 in headless Chrome: 纯烬艾雅法拉's eyes drawn by the real pixi-spine
// bundle and WebGL, the stencil masks on vs off. With the masks off (a crowded field, or below high quality: render/app.js
// pickClipping) SpineActor._eyeMaskFallback must draw her closed eyes as the stencil does — her eyeballs are region
// attachments under lids that close to a slit, and they showed through (0.3.0). The eye area is rendered three ways —
// masks on, masks off with the fallback, masks off without it — and compared pixel by pixel.
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/eyemask.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default. Images → test/e2e/out/eyemask-*.png.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ID = 'char_1016_agoat2';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets/spine/op', ID, 'front', `${ID}.skel`));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and the downloaded assets)';

test('纯烬艾雅法拉\'s eyes with the masks off look as with the stencil: shut in her blink and her S3, open in Idle (GitHub #647)', { skip, timeout: 120000 }, async (t) => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const entry = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).chars[ID].spine.front;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&panel=0`);
    await page.waitForFunction(() => window.__demo?.ready, { timeout: 60000 });
    const result = await page.evaluate(async (entry) => {
      const { SpineActor } = await import('/js/render/spine.js');
      const { loadSpineData } = await import('/js/assets.js');
      const { app } = window.__demo.view.debug;
      app.stop();
      const data = await loadSpineData(entry);
      const W = 240, H = 120, S = 3;
      // the eye area of a pose (masks on / off; `raw`: the fallback's hiding undone), framed on the clip polygons
      const render = async (clip, t, clipOn, raw = false) => {
        const a = new SpineActor(data, entry);
        a.setClipping(clipOn);
        a.spine.state.setAnimation(0, clip, true);
        a.update(t);
        if (raw) a._showClipHidden();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const slot of a.spine.skeleton.drawOrder) {
          const att = slot.getAttachment();
          if (!att || att.type !== 6) continue;
          const v = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
          for (let k = 0; k < v.length; k += 2) { x0 = Math.min(x0, v[k]); x1 = Math.max(x1, v[k]); y0 = Math.min(y0, v[k + 1]); y1 = Math.max(y1, v[k + 1]); }
        }
        const stage = new PIXI.Container();
        stage.addChild(new PIXI.Graphics().beginFill(0x8fa3b8).drawRect(0, 0, W, H).endFill());
        const holder = new PIXI.Container();
        holder.scale.set(S);
        holder.position.set(W / 2 - ((x0 + x1) / 2) * S, H / 2 - ((y0 + y1) / 2) * S);
        holder.addChild(a.spine);
        stage.addChild(holder);
        const rt = PIXI.RenderTexture.create({ width: W, height: H });
        app.renderer.render(stage, { renderTexture: rt, clear: true });
        const pixels = app.renderer.extract.pixels(rt);
        const png = await app.renderer.extract.base64(rt);
        const hidden = [...a._clipHidden].map((i) => a.spine.skeleton.slots[i].data.name).sort();
        rt.destroy(true);
        stage.destroy({ children: true });
        return { pixels, png, hidden };
      };
      // mean absolute difference per channel (0–255)
      const diff = (p, q) => { let s = 0; for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - q[i]); return s / p.length; };
      const out = {};
      for (const [clip, t] of [['Idle', 2.2], ['Skill_3_Idle', 1], ['Idle', 1]]) {
        const on = await render(clip, t, true), off = await render(clip, t, false), raw = await render(clip, t, false, true);
        out[`${clip}@${t}`] = { fallback: diff(on.pixels, off.pixels), none: diff(on.pixels, raw.pixels), hidden: off.hidden, pngs: [on.png, off.png, raw.png] };
      }
      return out;
    }, entry);
    mkdirSync(OUT, { recursive: true });
    for (const [key, r] of Object.entries(result)) {
      r.pngs.forEach((png, i) => writeFileSync(path.join(OUT, `eyemask-${key.replace('@', '-')}-${['on', 'fallback', 'none'][i]}.png`), Buffer.from(png.split(',')[1], 'base64')));
      delete r.pngs;
    }
    const msg = JSON.stringify(result);
    t.diagnostic(msg);
    for (const key of ['Idle@2.2', 'Skill_3_Idle@1']) {
      // shut: the fallback hides both eyeballs and matches the stencil; without it the eyeballs show through the lids
      assert.deepEqual(result[key].hidden, ['F_L_Eyeball', 'F_R_Eyeball'], `${key} ${msg}`);
      assert.ok(result[key].fallback < 1, `${key}: the fallback draws what the stencil draws ${msg}`);
      assert.ok(result[key].none > 5 * Math.max(0.2, result[key].fallback), `${key}: without the fallback the eyeballs show ${msg}`);
    }
    // open: nothing hidden, the eyeballs lie inside the openings
    assert.deepEqual(result['Idle@1'].hidden, [], msg);
    assert.ok(result['Idle@1'].fallback < 1, `open eyes are drawn as with the stencil ${msg}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
