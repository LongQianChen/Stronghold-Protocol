// Settings, wiring and the title-page repository link for the official damage-number option (#412) and #543.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { fallbackFloat } from '../../public/js/ui/fallbackField.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('official damage numbers default off and only a real boolean is kept', () => {
  assert.equal(sanitizeSettings(null).officialDamageNumbers, false);
  assert.equal(sanitizeSettings({}).officialDamageNumbers, false, 'a profile saved before the setting stays on today\'s numbers');
  assert.equal(sanitizeSettings({ officialDamageNumbers: true }).officialDamageNumbers, true);
  assert.equal(sanitizeSettings({ officialDamageNumbers: true, damageNumbers: false }).damageNumbers, false);
  for (const bad of ['yes', 1, null, undefined]) {
    assert.equal(sanitizeSettings({ officialDamageNumbers: bad }).officialDamageNumbers, false, String(bad));
  }
});

test('the settings screen, the field view and the simplified board follow the same flag', () => {
  const settings = read('public/js/ui/settings.js');
  assert.match(settings, /t\('官方伤害数字'\)/);
  assert.match(settings, /officialDamageNumbers/);
  const app = read('public/js/render/app.js');
  assert.match(app, /officialDamageNumbers/);
  // (an official hit drawn by the official battle effects passes NO_SPARK as well: render/vfx/wiring.js damage)
  assert.match(app, /fx\.damage\(v, amt, e\[3\], src, e\[4\](, official \? NO_SPARK : undefined)?\)/);
  assert.deepEqual(fallbackFloat(['dmg', 7, 40, 'phys'], { damageNumbers: true }), { id: 7, text: '40', type: 'phys' });
  assert.deepEqual(fallbackFloat(['heal', 7, 12], { damageNumbers: true, officialDamageNumbers: false }), { id: 7, text: '+12', type: 'heal' });
  assert.equal(fallbackFloat(['dmg', 7, 40, 'phys'], { damageNumbers: true, officialDamageNumbers: true }), null);
  assert.equal(fallbackFloat(['heal', 7, 12], { damageNumbers: true, officialDamageNumbers: true }), null);
  assert.deepEqual(fallbackFloat(['dmg', 7, 0, 'phys', 'r'], { damageNumbers: true, officialDamageNumbers: true }), { id: 7, text: '0', type: 'crit' });
  assert.deepEqual(fallbackFloat(['dmg', 7, 80, 'arts', 'r'], { damageNumbers: true, officialDamageNumbers: true }), { id: 7, text: '80', type: 'crit' });
  assert.deepEqual(fallbackFloat(['fx', 'dodge', 1, 2, { id: 7, num: 'm' }], { damageNumbers: true, officialDamageNumbers: true }), { id: 7, text: 'MISS', type: 'miss' });
  assert.equal(fallbackFloat(['fx', 'dodge', 1, 2, { id: 7, num: 'm' }], { damageNumbers: true }), null);
  assert.equal(fallbackFloat(['dmg', 7, 80, 'phys', 'r'], { damageNumbers: false, officialDamageNumbers: true }), null);
});

test('every interface pack translates the new settings and title strings', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of ['官方伤害数字', '只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。', '项目仓库']) {
      assert.equal(typeof pack[id], 'string', `${lang} ${id}`);
      assert.ok(pack[id].length > 0, `${lang} ${id}`);
      if (lang !== 'zh-TW') assert.notEqual(pack[id], id, `${lang} still has the Chinese source`);
    }
  }
});

test('the title page links the project repository in a new tab', () => {
  const src = read('public/js/screens/title.js');
  assert.match(src, /class="title-repo"/);
  assert.match(src, /href="https:\/\/github\.com\/sganggs\/Stronghold-Protocol"/);
  assert.match(src, /target="_blank"/);
  assert.match(src, /rel="noopener noreferrer"/);
  assert.match(src, /t\('项目仓库'\)/);
});
