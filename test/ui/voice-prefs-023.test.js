import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { sanitizeVoiceOverrides, voiceLangFor, VOICE_PICKS } from '../../public/js/voicePrefs.js';
import { AudioManager, voiceLine } from '../../public/js/audio.js';
const a = 'char_263_skadi', b = 'char_103_angel';
test('old settings migrate to inherit, malformed or prototype entries are discarded', () => {
  assert.deepEqual(sanitizeSettings({ voiceLang: 'jp' }).voiceOverrides, {});
  assert.deepEqual(sanitizeVoiceOverrides(Object.assign(Object.create({ [b]: 'jp' }), { [a]: 'jp', bad: 'cn', char_1_no: 'xx' })), { [a]: 'jp' });
  assert.deepEqual(sanitizeVoiceOverrides({ [a]: 'en', [b]: 'native', char_9_kr: 'kr' }), { [a]: 'en', [b]: 'native', char_9_kr: 'kr' });
  assert.deepEqual([...VOICE_PICKS], ['cn', 'jp', 'en', 'kr', 'native']);
  for (const raw of [null, [], 1, 'jp']) assert.deepEqual(sanitizeVoiceOverrides(raw), {});
});
test('per-character override survives persistence; deletion restores the current global setting', () => {
  const settings = sanitizeSettings(JSON.parse(JSON.stringify({ voiceLang: 'cn', voiceOverrides: { [a]: 'jp', [b]: 'cn' } })));
  const manager = new AudioManager();
  manager.setVoiceLang(settings.voiceLang, settings.voiceOverrides);
  assert.equal(voiceLangFor(a, manager.voiceLang, manager.voiceOverrides), 'jp');
  manager.setVoiceLang('jp');
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'cn');
  delete settings.voiceOverrides[b];
  manager.setVoiceLang('jp', settings.voiceOverrides);
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'jp');
  assert.equal(voiceLangFor('unknown', 'cn', manager.voiceOverrides), 'cn');
});
test('voiceLangFor with a manifest: own choice, then 本土语言, then the global dub, then 中文', () => {
  const audio = {
    voice: { [a]: { select: '/cn.mp3' }, [b]: { select: '/b-cn.mp3' } },
    voiceJp: { [a]: { select: '/jp.mp3' } },
    voiceEn: { [a]: { select: '/en.mp3' } },
    voiceNative: { [a]: { select: '/native.mp3' } },
  };
  assert.equal(voiceLangFor(a, 'cn', { [a]: 'en' }, { audio }), 'en', 'the operator\'s own choice wins when that tree is here');
  assert.equal(voiceLangFor(a, 'jp', { [a]: 'native' }, { audio, native: false }), 'native', 'an own native pick wins even with the switch off');
  assert.equal(voiceLangFor(a, 'jp', { [a]: 'kr' }, { audio, native: true }), 'native', 'a choice whose tree is missing falls through to 本土语言');
  assert.equal(voiceLangFor(a, 'en', {}, { audio, native: true }), 'native', '本土语言 beats the global dub');
  assert.equal(voiceLangFor(a, 'en', {}, { audio }), 'en', 'the global dub when the switch is off and there is no own choice');
  assert.equal(voiceLangFor(b, 'en', {}, { audio }), 'cn', 'a global dub this operator lacks falls back to 中文');
  assert.equal(voiceLangFor(b, 'jp', {}, { audio, native: true }), 'cn', 'no native tree and no JP tree: 中文');
  assert.equal(voiceLangFor(a, 'en', { [a]: 'jp' }), 'jp', 'without audio the old cn/jp rule stands, and en is not a global');
  assert.equal(voiceLangFor(a, 'en', { [a]: 'en' }), 'cn', 'without audio an en override does not win');
  assert.equal(voiceLangFor(a, 'kr', {}), 'cn');
});
test('the per-operator JP preference retains the existing per-slot Chinese fallback', () => {
  const tree = { voice: { [a]: { select: '/cn.mp3' } }, voiceJp: { [a]: { skill1: '/jp.mp3' } } };
  assert.equal(voiceLine(tree, a, 'select', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/cn.mp3');
  assert.equal(voiceLine(tree, a, 'skill1', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/jp.mp3');
});
