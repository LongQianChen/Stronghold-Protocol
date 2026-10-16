// test/ui/mystic-energy.test.js — 设置「秘术师能量」 (PR #636 by @zasx77771, GitHub #633, DESIGN §32.14.28): a 秘术师's
// stored attack energies as stored/cap under the bars are not part of the official HUD — the client shows them as an
// effect on the operator — so the count is an option, off by default (the maintainer's decision of 2026-10-15, like
// 「弹药数量」). Settings normalisation, the dialog's toggle and its hint in every language pack, the field view's live
// setting, the diagnostics line. What the renderer draws: test/render/hud-readouts.test.js.
// Run: node --test test/ui/mystic-energy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic.js';
import { buildDiagnostics } from '../../public/js/diag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LABEL = '秘术师能量';
const HINT = '在秘术师的血条下方显示储存的攻击能量 / 上限（如 2/3）。官方用干员身上的特效表示，没有这个数字。';

test('mysticEnergy is stored with the other settings: off by default and for a profile saved before it, a boolean kept, junk off', () => {
  assert.equal(DEFAULT_SETTINGS.mysticEnergy, false);
  assert.equal(sanitizeSettings(null).mysticEnergy, false);
  assert.equal(sanitizeSettings({ bgm: 0.4, ammoCount: true }).mysticEnergy, false, 'a profile saved before 0.3.0');
  assert.equal(sanitizeSettings({ mysticEnergy: true }).mysticEnergy, true);
  for (const bad of ['true', 1, 0, null, {}, []]) assert.equal(sanitizeSettings({ mysticEnergy: bad }).mysticEnergy, false, JSON.stringify(bad));
  assert.deepEqual(sanitizeSettings({ mysticEnergy: true, ammoCount: true }), { ...sanitizeSettings({ ammoCount: true }), mysticEnergy: true });
});

test('the settings dialog has the toggle under 弹药数量 and a hint that the official interface has no such number, in every language pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /<\$\{Toggle\} label=\$\{t\('秘术师能量'\)\} micro="STORED ENERGY" value=\$\{s\.mysticEnergy\} onChange=\$\{\(v\) => updateSettings\(\{ mysticEnergy: v \}\)\} \/>/);
  assert.ok(src.includes(`t('${HINT}')`), 'the hint under it');
  assert.ok(src.indexOf("t('弹药数量')") < src.indexOf(`t('${LABEL}')`), 'beside the ammo count');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of [LABEL, HINT]) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
    assert.match(pack[HINT], /2\/3/, `${lang}: the example count`);
  }
});

test('the field view takes the setting at creation and live (setSettings); the units read it from their shared settings', () => {
  const app = read('public/js/render/app.js');
  assert.match(app, /if \(typeof s\.mysticEnergy === 'boolean'\) settings\.mysticEnergy = s\.mysticEnergy;/);
  const units = read('public/js/render/units.js');
  assert.match(units, /this\._updateEnergy\(showBars && !this\.isEnemy && !!this\.energy && this\.ctx\.settings\?\.mysticEnergy === true, /);
});

test('the diagnostics name the option when it is on', () => {
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (settings) => buildDiagnostics({ state, env: {}, settings }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', damageNumbers: true, mysticEnergy: true }), 'settings: quality high | damage numbers | mystic energy');
  assert.equal(line({ quality: 'high', damageNumbers: true, mysticEnergy: false }), 'settings: quality high | damage numbers');
});
