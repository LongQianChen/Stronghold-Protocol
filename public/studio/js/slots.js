// public/studio/js/slots.js — one place a plugin fills (a template's slot: server/studio/templates/): what the
// installation has there and what the plugin puts there, side by side; drop files on it (or pick them) and they go into
// the plugin folder under the right name (POST /studio/api/plugins/<id>/slot — the server names and checks them); borrow
// the installation's own art instead (a reference, `{ "ref": "<key>" }`); empty it; and its issues in plain words right
// under it.

import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from '../../js/ui/components.js';
import { data } from '../../js/data.js';
import { t } from '../../../shared/i18n.js';
import { getPath } from '../../../shared/plugins/visual.js';
import { fileBase64 } from './api.js';
import { slotLabel, targetName } from './labels.js';
import { IssueList, issuesAt } from './issues.js';
import { TargetPicker } from './picker.js';
import { pluginAt, playSound } from './preview/sound.js';
import { editorOf } from './editors/index.js';

const cx = (...p) => p.filter(Boolean).join(' ');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a slot holds in the plugin's overlay, as words: a file, files, a reference, a model, a track. */
function valueText(v) {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  if (isObj(v) && typeof v.ref === 'string') return t('借用：{key}', { key: v.ref });
  if (isObj(v) && typeof v.skel === 'string') return [v.skel, ...(Array.isArray(v.textures) ? v.textures : [])].join(', ');
  if (isObj(v) && typeof v.loop === 'string') return [v.intro, v.loop].filter(Boolean).join(' + ');
  return '';
}

/** A small view of a slot's art in the preview manifest (an image, or play buttons for a sound). */
function Mini({ kind, value }) {
  if (kind === 'image') return typeof value === 'string' ? html`<img class="st-mini" src=${value} alt="" />` : html`<span class="st-mini is-none">${t('无')}</span>`;
  if (kind === 'spine') return isObj(value) && typeof value.skel === 'string' ? html`<span class="st-mini is-text">${t('有模型')}</span>` : html`<span class="st-mini is-none">${t('无')}</span>`;
  const urls = typeof value === 'string' ? [value] : Array.isArray(value) ? value : isObj(value) && typeof value.loop === 'string' ? [value.intro, value.loop].filter(Boolean) : [];
  return urls.length ? html`<span class="st-mini is-text">${urls.map((u, i) => html`<button type="button" key=${u} class="st-play" onClick=${() => playSound(u)}>▶${urls.length > 1 ? ` ${i + 1}` : ''}</button>`)}</span>` : html`<span class="st-mini is-none">${t('无')}</span>`;
}

/**
 * One slot (see the header).
 * @param {{ slot: any, target: any, template: string, overlay: any, issues: any[], busy: boolean,
 *   onFiles: (slot: any, files: { name: string, data: string, role?: string }[]) => void,
 *   onRef: (slot: any, key: string) => void, onClear: (slot: any) => void, onFix: (issue: any) => void }} props
 */
export function SlotCard({ slot, target, template, overlay, issues, busy, onFiles, onRef, onClear, onFix }) {
  const editor = editorOf(template);
  const input = useRef(null);
  const intro = useRef(null);
  const [over, setOver] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const m = data.get('assets');
  const value = getPath(overlay, slot.at);
  const mine = issuesAt(issues, { at: ['assets', ...slot.at] });
  const send = async (fileList, role = null) => {
    const files = [...fileList];
    if (!files.length) return;
    const list = await Promise.all(files.map(async (f) => ({ name: f.name, data: await fileBase64(f), ...(role ? { role } : {}) })));
    onFiles(slot, list);
  };
  const onDrop = (e) => { e.preventDefault(); setOver(false); if (!busy) send(e.dataTransfer?.files || []); };
  const has = value !== undefined;
  return html`<div class=${cx('st-slot', over && 'is-over', has && 'is-set', mine.some((i) => i.level === 'problem') && 'is-bad')} data-slot=${slot.at.join('.')}
      onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
    <div class="st-slot__head">
      <span class="st-slot__label">${slotLabel(slot)}</span>
      ${has ? html`<span class="st-slot__value" title=${valueText(value)}>${valueText(value)}</span>` : html`<span class="st-slot__value is-empty">${t('未替换（用原版）')}</span>`}
    </div>
    <div class="st-slot__body">
      <div class="st-slot__compare">
        <div class="st-slot__side"><${Mini} kind=${slot.kind} value=${getPath(m, slot.at)} /><span>${t('原版')}</span></div>
        <div class="st-slot__arrow" aria-hidden="true">→</div>
        <div class="st-slot__side is-plugin"><${Mini} kind=${slot.kind} value=${getPath(m, pluginAt(slot.at, target))} /><span>${t('插件')}</span></div>
      </div>
      <div class="st-slot__drop" role="button" tabindex="0" onClick=${() => input.current?.click()}
          onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}>
        <strong>${t('把文件拖到这里')}</strong><span>${t('或点击选择文件')}</span>
        <small>${editor.hint(slot)}</small>
        <input ref=${input} type="file" hidden accept=${editor.accept(slot)} multiple=${editor.multiple(slot)} data-testid="slot-input"
          onChange=${(e) => { send(e.currentTarget.files || []); e.currentTarget.value = ''; }} />
      </div>
    </div>
    <div class="st-slot__actions">
      ${slot.kind === 'track' ? html`<button type="button" class="st-link-btn" disabled=${busy} onClick=${() => intro.current?.click()}>${t('放入前奏')}</button>
        <input ref=${intro} type="file" hidden accept=${editor.accept(slot)} onChange=${(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f || !isObj(value) || typeof value.loop !== 'string') return;
          send([f], 'intro');
        }} />` : null}
      <button type="button" class="st-link-btn" disabled=${busy} onClick=${() => setRefOpen(true)} data-testid="slot-ref">${t('用已有的素材')}</button>
      ${has ? html`<button type="button" class="st-link-btn is-danger" disabled=${busy} onClick=${() => onClear(slot)} data-testid="slot-clear">${t('恢复原版')}</button>` : null}
    </div>
    <${IssueList} issues=${mine} onFix=${onFix} busy=${busy} compact=${true} />
    <${Modal} open=${refOpen} title=${t('借用本安装已有的素材')} onClose=${() => setRefOpen(false)} width="8rem"
        actions=${html`<${Button} onClick=${() => setRefOpen(false)}>${t('取消')}<//>`}>
      <p class="st-note">${t('「{slot}」改用下面选中的那一个的同类素材（不复制任何文件）。', { slot: slotLabel(slot) })}</p>
      <${TargetPicker} kinds=${[target.kind]} autoFocus=${true} onPick=${(tg) => { setRefOpen(false); onRef(slot, tg.key); }} placeholder=${t('搜索要借用的「{name}」的替代者', { name: targetName(target) })} />
    <//>
  </div>`;
}
