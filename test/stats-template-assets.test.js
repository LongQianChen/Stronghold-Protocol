import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { embeddedStatsAssets, statsTemplateJobs } from '../tools/assets/stats-template.mjs';
import { kindOf, validate } from '../tools/assets/formats.mjs';

const png = Buffer.alloc(45);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.write('IHDR', 12);
png.writeUInt32BE(1, 16);
png.writeUInt32BE(1, 20);
png.write('IEND', 37);
const glow = `data:image/png;base64,${png.toString('base64')}`;
const mask = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`;
const recordSelectors = ['.D_liCN .C8cb_l .grJEuP', '.D_liCN .C8cb_l:first-child .QjacBn', '.D_liCN .C8cb_l:nth-child(2) .QjacBn', '.D_liCN .C8cb_l:nth-child(3) .QjacBn', '.MjyVeP .oetJsV', '.zJvtrR', '.d55Z07 .YhjRsw', '.d55Z07 .YhjRsw:after', '.jDhW1o', '.jDhW1o.GajVs2:after', ...Array.from({ length: 6 }, (_, i) => `.X3pmNU .V1837J[data-value="${i + 1}"]`), '.vMxx75 .QjacBn', ...Array.from({ length: 6 }, (_, i) => `.MLjcnT .ykHBSj[data-value="${i + 1}"]`), '.MLjcnT .E1AGEa .UuPuiA[data-value="1"]', '.MLjcnT .yREPMr .uMnwgg .qgW2SX'];
const recordUrls = recordSelectors.map((_, i) => {
  const image = Buffer.from(png);
  image.writeUInt32BE(i + 2, 16);
  return `data:image/png;base64,${image.toString('base64')}`;
});
const recordImages = recordSelectors.map((selector, i) => `${selector} { background:url(${recordUrls[i]}) }`).join(' ');
const css = `.other { background:url(${glow}) } .WqPlp7 { mask:url(${mask}) } .LOEhW2.zrK7_e:before { background:url(${glow}) } ${recordImages}`;

test('official asset extraction selects embedded artwork, rejecting missing or invalid payloads', () => {
  assert.deepEqual(embeddedStatsAssets(css), { titleMask: mask, countGlow: glow, recordLabel: recordUrls[0], recordFunds: recordUrls[1], recordPromotions: recordUrls[2], recordDefeats: recordUrls[3], strategyTopFrame: recordUrls[4], bondTopFrame: recordUrls[5], headingIconFrame: recordUrls[6], headingIcon: recordUrls[7], strategyBadgeFrame: recordUrls[8], strategyBadge: recordUrls[9], ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`memberTier${i + 1}`, recordUrls[10 + i]])), achievementBondFrame: recordUrls[16], ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`achievementTier${i + 1}`, recordUrls[17 + i]])), achievementElite1: recordUrls[23], achievementItemSlot: recordUrls[24] });
  assert.throws(() => embeddedStatsAssets(css.replace('WqPlp7', 'missing')), /missing official stats asset/);
  assert.throws(() => embeddedStatsAssets(css.replaceAll(glow, 'data:image/png;base64,YmFk')), /invalid official stats asset/);
  assert.throws(() => embeddedStatsAssets(css.replace(mask, glow)), /missing official stats asset/);
  const font = Buffer.alloc(48);
  font.write('wOF2');
  assert.equal(kindOf('number-font.woff2'), 'font');
  assert.equal(validate('font', font), true);
  assert.equal(validate('font', Buffer.from('<html>not a font</html>')), false);
});

test('offline setup uses cached CSS and never fetches; a bad response cannot become the cache', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sp-stats-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.cache'));
  const cache = join(root, '.cache/stats-template-41668e.css');
  await writeFile(cache, css);
  const jobs = await statsTemplateJobs(root, { offline: true, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(jobs.find((job) => job.name === 'titleMask').urls[0], mask);
  assert.equal(jobs.find((job) => job.name === 'countGlow').urls[0], glow);
  await rm(cache);
  const missing = await statsTemplateJobs(root, { offline: true, log: () => {} });
  assert.deepEqual(missing.find((job) => job.name === 'titleMask').urls, []);
  await statsTemplateJobs(root, { fetchImpl: async () => new Response('<html>error</html>'), log: () => {} });
  await assert.rejects(readFile(cache), { code: 'ENOENT' });
  await writeFile(cache, '<html>corrupt cache</html>');
  await statsTemplateJobs(root, { fetchImpl: async () => new Response(css), log: () => {} });
  assert.equal(await readFile(cache, 'utf8'), css, 'an online retry repairs corrupt cached CSS');
});
