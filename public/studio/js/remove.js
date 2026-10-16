// public/studio/js/remove.js — 删除所选 (DESIGN §32.14.34, docs/PLUGINS.md §15): the plugins checked in the list move to
// plugins/_removed/ after a confirmation that names them (POST /studio/api/plugins/remove — nothing is deleted: moving a
// folder back restores it); a plugin the server leaves where it is (one a room uses, a symbolic link, one already gone) is
// shown with its reason from the error catalogue (shared/plugins/errors.js). The list's checkboxes are main.js's.

import { html, Button, alertDialog, confirmDialog } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { post } from './api.js';
import { errorText } from './issues.js';

/**
 * The tools above the list: 全选 (checked when every plugin that can be removed is, mixed when some are), 清除选择 and
 * 删除所选（N）, disabled with nothing checked.
 * @param {{ count: number, total: number, busy: boolean, onAll: (on: boolean) => void, onClear: () => void, onRemove: () => void }} props
 */
export function SelectTools({ count, total, busy, onAll, onClear, onRemove }) {
  const all = total > 0 && count >= total;
  return html`<div class="st-select" data-testid="select-tools">
    <div class="st-select__row">
      <label class="st-check"><input type="checkbox" checked=${all} disabled=${busy || !total} data-testid="select-all"
        ref=${(el) => { if (el) el.indeterminate = count > 0 && !all; }} onChange=${(e) => onAll(e.currentTarget.checked)} /> ${t('全选')}</label>
      <button type="button" class="st-link-btn" disabled=${busy || !count} onClick=${onClear} data-testid="select-clear">${t('清除选择')}</button>
    </div>
    <${Button} variant="danger" size="sm" block=${true} disabled=${!count} loading=${busy} onClick=${onRemove} data-testid="remove-selected">${t('删除所选（{n}）', { n: count })}<//>
  </div>`;
}

/**
 * Ask before removing: the plugins by name and id, where they go and how one comes back. Whether it was confirmed.
 * @param {{ id: string, name?: string }[]} chosen
 * @returns {Promise<boolean>}
 */
export function confirmRemoval(chosen) {
  return confirmDialog({
    title: t('删除所选插件'),
    danger: true,
    okText: t('删除'),
    text: html`<div class="st-remove" data-testid="remove-confirm">
      <p class="modal__text">${t('下面 {n} 个插件会移到 plugins/_removed/ 文件夹，不会被彻底删除：', { n: chosen.length })}</p>
      <ul class="st-remove__list" data-testid="remove-list">${chosen.map((p) => html`<li key=${p.id} data-plugin=${p.id}>
        <span class="st-remove__name">${p.name || p.id}</span> <code>${p.id}</code></li>`)}</ul>
      <p class="st-note">${t('想恢复的话，把它的文件夹从 plugins/_removed/ 移回 plugins/，并把文件夹名改回插件 id（去掉后面的时间）。')}</p>
    </div>`,
  });
}

/**
 * Remove the plugins `ids`: one request per `max` of them (the server's limit, GET info `limits.removeMax`), the answers
 * put together. An error of a request (the key, the network) is thrown as the API's StudioApiError.
 * @param {string[]} ids @param {number} [max]
 * @returns {Promise<{ removed: { id: string, to: string }[], refused: { id: string, error: string, params: Record<string, unknown> }[] }>}
 */
export async function removePlugins(ids, max = 100) {
  const step = Number.isInteger(max) && max > 0 ? max : 100;
  const out = { removed: [], refused: [] };
  for (let i = 0; i < ids.length; i += step) {
    const r = await post('plugins/remove', { ids: ids.slice(i, i + step) });
    out.removed.push(...(Array.isArray(r?.removed) ? r.removed : []));
    out.refused.push(...(Array.isArray(r?.refused) ? r.refused : []));
  }
  return out;
}

/**
 * The plugins the server did not remove, each with its reason and what to do (an alert).
 * @param {{ id: string, error: string, params?: Record<string, unknown> }[]} refused
 * @param {{ id: string, name?: string }[]} chosen @param {number} removedCount
 */
export function showRefused(refused, chosen, removedCount) {
  const nameOf = (id) => chosen.find((p) => p.id === id)?.name || id;
  return alertDialog({
    title: t('{n} 个插件没有删除', { n: refused.length }),
    text: html`<div class="st-remove" data-testid="remove-refused">
      ${removedCount ? html`<p class="modal__text">${t('其余 {n} 个已移到 plugins/_removed/。', { n: removedCount })}</p>` : null}
      <ul class="st-remove__list">${refused.map((x) => html`<li key=${x.id} data-plugin=${x.id} data-code=${x.error}>
        <span class="st-remove__name">${nameOf(x.id)}</span> <code>${x.id}</code>
        <p class="st-remove__why">${errorText({ code: x.error, params: x.params || {} })}</p></li>`)}</ul>
    </div>`,
  });
}
