// public/studio/js/catalog.js — 「从目录安装」(DESIGN §32.13, docs/PLUGINS.md §17). The owner gives a catalogue
// address or a catalogue file this browser already has. The file is read here and posted as text. The zip is not
// downloaded by the browser and not uploaded: POST /studio/api/catalog/install tells the server the https address and
// the sha256, and the server downloads, checks and installs it (server/plugins/install.js). Nothing in the package runs.

import { useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { post } from './api.js';
import { errorText } from './issues.js';

/** The status word. Each branch is a t() literal so the four language packs see it. */
function statusText(status) {
  if (status === 'installed') return t('已安装');
  if (status === 'updatable') return t('可更新');
  if (status === 'incompatible') return t('不适配');
  return t('可安装');
}

/**
 * The catalogue page. `canChange` is whether this browser holds the studio key (a read of the list is still a POST).
 * @param {{ canChange: boolean }} props
 */
export function CatalogPage({ canChange }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [bad, setBad] = useState('');
  const [again, setAgain] = useState(null);

  const show = (body) => {
    setName(typeof body?.name === 'string' ? body.name : '');
    setRows(Array.isArray(body?.plugins) ? body.plugins : []);
    setBad('');
  };

  const load = async (payload) => {
    setBusy('load');
    setNote('');
    setBad('');
    try {
      show(await post('catalog', payload));
      setAgain(payload);
    } catch (e) {
      setBad(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const onFile = async (e) => {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!file) return;
    let text;
    try { text = await file.text(); } catch (err) {
      setBad(errorText(err));
      return;
    }
    await load({ text });
  };

  const install = async (row) => {
    setBusy(row.id);
    setNote('');
    setBad('');
    try {
      const body = { url: row.url, sha256: row.sha256, id: row.id, force };
      if (Number.isInteger(row.bytes)) body.bytes = row.bytes;
      const done = await post('catalog/install', body);
      const moved = done.replaced ? t('旧文件夹已挪走，没有删除。') : '';
      setNote(`${t('已安装到 plugins/{id}/。', { id: done.id })}${moved ? ` ${moved}` : ''}`);
      if (again) show(await post('catalog', again));
    } catch (e) {
      setBad(errorText(e));
    } finally {
      setBusy('');
    }
  };

  return html`<div class="st-catalog" data-testid="catalog-page">
    <h2>${t('从目录安装')}</h2>
    <p class="st-note">${t('只接受 https 地址。每个插件都要有 sha256。服务器下载并校验，不会运行包里的代码。')}</p>
    ${canChange ? null : html`<p class="st-banner is-warn" data-testid="catalog-key">${t('安装需要工作台钥匙。')}</p>`}
    <label class="st-catalog__row">
      <span>${t('目录地址（https）')}</span>
      <input class="st-input st-catalog__grow" value=${url} onInput=${(e) => setUrl(e.currentTarget.value)}
        placeholder="https://" data-testid="catalog-url" />
    </label>
    <div class="st-catalog__row">
      <${Button} variant="primary" onClick=${() => load({ url: url.trim() })} loading=${busy === 'load'} disabled=${!!busy} data-testid="catalog-load">${t('读取目录')}<//>
      <label class="st-file">${t('或选择本机的目录文件')}
        <input type="file" accept="application/json,.json" onChange=${onFile} data-testid="catalog-file" disabled=${!!busy} />
      </label>
      <label class="st-file"><input type="checkbox" checked=${force} onChange=${(e) => setForce(e.currentTarget.checked)} data-testid="catalog-force" /> ${t('覆盖安装')}</label>
    </div>
    ${busy === 'load' ? html`<p class="st-note" data-testid="catalog-busy">${t('正在读取目录…')}</p>` : null}
    ${busy && busy !== 'load' ? html`<p class="st-note" data-testid="catalog-busy">${t('正在安装…')}</p>` : null}
    ${note ? html`<p class="st-banner is-ok" data-testid="catalog-note">${note}</p>` : null}
    ${bad ? html`<p class="st-banner is-bad" data-testid="catalog-error">${bad}</p>` : null}
    ${name ? html`<p class="st-note">${name}</p>` : null}
    ${rows && !rows.length ? html`<p class="st-note">${t('目录里没有插件。')}</p>` : null}
    ${rows && rows.length ? html`<ul class="st-list" data-testid="catalog-list">
      ${rows.map((row) => html`<li key=${row.id} class="st-catalog__item" data-id=${row.id} data-status=${row.status}>
        <div class="st-list__name">${row.name || row.id}</div>
        <div class="st-list__meta"><code>${row.id}</code> · ${t('版本')} ${row.version} · ${row.class}${row.installedVersion ? ` · ${row.installedVersion}` : ''}</div>
        <span class=${`st-badge ${row.status === 'incompatible' ? 'is-bad' : row.status === 'installed' ? 'is-ok' : ''}`}>${statusText(row.status)}</span>
        <${Button} size="sm" variant="primary" onClick=${() => install(row)} loading=${busy === row.id} disabled=${!!busy} data-testid="catalog-install" data-id=${row.id}>${t('安装')}<//>
      </li>`)}
    </ul>` : null}
  </div>`;
}
