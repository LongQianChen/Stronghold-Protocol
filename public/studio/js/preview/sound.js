// public/studio/js/preview/sound.js — the sounds of a plugin beside the original ones (DESIGN §32.9): every voice line, a
// music track (its intro and loop), a sound — each file with a play button, the installation's on the left, the plugin's
// on the right (the preview layers' `<key>~plugin` entries, ./layers.js). One sound plays at a time.

import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { data } from '../../../js/data.js';
import { t } from '../../../../shared/i18n.js';
import { getPath } from '../../../../shared/plugins/visual.js';
import { PLUGIN_SUFFIX } from './layers.js';
import { slotLabel } from '../labels.js';

/** The one sound playing now (stopped when another starts). */
let playing = null;
const listeners = new Set();
const tell = () => { for (const fn of [...listeners]) fn(); };

/** Play a URL (or stop it when it is the one playing). @param {string} url */
export function playSound(url) {
  if (playing) { const same = playing.url === url; try { playing.audio.pause(); } catch { /* gone */ } playing = null; tell(); if (same) return; }
  if (!url) return;
  const audio = new Audio(url);
  playing = { url, audio };
  audio.onended = () => { if (playing?.audio === audio) { playing = null; tell(); } };
  audio.onerror = () => { if (playing?.audio === audio) { playing = null; tell(); } };
  audio.play().catch(() => { if (playing?.audio === audio) { playing = null; tell(); } });
  tell();
}

/** Re-render while the playing sound changes. */
function usePlaying() {
  const [, set] = useState(0);
  useEffect(() => { const fn = () => set((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  return playing?.url || null;
}

/** The path of a slot's plugin entry: the target's key segment with the plugin suffix. @param {string[]} at @param {any} target */
export function pluginAt(at, target) {
  const i = at.indexOf(target.key, 1);
  return i < 0 ? at : [...at.slice(0, i), `${target.key}${PLUGIN_SUFFIX}`, ...at.slice(i + 1)];
}

/** The URLs of a sound value: a file, a list of them, a track { intro?, loop }. */
function urlsOf(v) {
  if (typeof v === 'string') return [{ url: v, part: '' }];
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').map((url, i) => ({ url, part: v.length > 1 ? `${i + 1}` : '' }));
  if (v && typeof v === 'object' && typeof v.loop === 'string') return [...(typeof v.intro === 'string' ? [{ url: v.intro, part: t('前奏') }] : []), { url: v.loop, part: t('循环') }];
  return [];
}

/** Play buttons for a value. */
function Players({ value, now, testid }) {
  const list = urlsOf(value);
  if (!list.length) return html`<span class="st-none">${t('无')}</span>`;
  return html`<span class="st-players">${list.map((x) => html`<button type="button" key=${x.url} class=${`st-play${now === x.url ? ' is-on' : ''}`} data-testid=${testid}
      onClick=${() => playSound(x.url)} title=${x.url}>${now === x.url ? '■' : '▶'}${x.part ? ` ${x.part}` : ''}</button>`)}</span>`;
}

/**
 * The sound previews of a section (see the header).
 * @param {{ target: any, slots: any[], version: number }} props
 */
export function SoundPreview({ target, slots, version }) {
  const now = usePlaying();
  const m = data.get('assets');
  void version;
  const list = slots.filter((s) => s.kind === 'audio' || s.kind === 'audioList' || s.kind === 'track');
  if (!list.length) return null;
  return html`<table class="st-sounds" data-testid="sound-preview">
    <thead><tr><th></th><th>${t('原版')}</th><th>${t('插件')}</th></tr></thead>
    <tbody>${list.map((s) => {
      const orig = getPath(m, s.at);
      const mine = getPath(m, pluginAt(s.at, target));
      const changed = JSON.stringify(orig) !== JSON.stringify(mine);
      return html`<tr key=${s.at.join('.')} class=${changed ? 'is-changed' : ''}>
        <th>${slotLabel(s)}</th>
        <td><${Players} value=${orig} now=${now} testid="play-orig" /></td>
        <td><${Players} value=${mine} now=${now} testid="play-plugin" /></td>
      </tr>`;
    })}</tbody>
  </table>`;
}
