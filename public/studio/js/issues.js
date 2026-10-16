// public/studio/js/issues.js — a plugin's findings in plain words (the error catalogue, shared/plugins/errors.js: the same
// checks the server runs — server/plugins/pack.js checkPluginFolder): each issue its explanation in the page's language
// (Chinese in a Chinese interface, else English — errorLang), what to do, a link to the document, the technical line, and
// the one-click fix when the catalogue has one. `issuesAt` picks the issues of one place (a slot, a field) so the page
// shows them beside it.

import { html } from '../../js/ui/components.js';
import { getLang, t } from '../../../shared/i18n.js';
import { describeIssue } from '../../../shared/plugins/errors.js';

const cx = (...p) => p.filter(Boolean).join(' ');

/**
 * The issues whose place is `at` (a path of the manifest — ['assets', …] for the overlay —, or a prefix of it) or the file
 * `file`.
 * @param {any[]} issues @param {{ at?: string[], file?: string, prefix?: boolean }} where
 */
export function issuesAt(issues, { at = null, file = null, prefix = false } = {}) {
  return (Array.isArray(issues) ? issues : []).filter((i) => {
    if (file && i.file === file) return true;
    if (!at || !Array.isArray(i.at)) return false;
    if (prefix) return at.every((k, n) => i.at[n] === k);
    return i.at.length >= at.length && at.every((k, n) => i.at[n] === k);
  });
}

/**
 * The issues as a list (each in plain words, its fix, the technical line folded).
 * @param {{ issues: any[], onFix?: ((issue: any) => void) | null, busy?: boolean, compact?: boolean }} props
 */
export function IssueList({ issues, onFix = null, busy = false, compact = false }) {
  const list = Array.isArray(issues) ? issues : [];
  if (!list.length) return null;
  const lang = getLang();
  return html`<ul class=${cx('st-issues', compact && 'is-compact')}>
    ${list.map((i, n) => {
      const d = describeIssue(i, lang);
      return html`<li key=${`${d.code}-${n}`} class=${cx('st-issue', `is-${d.level}`)} data-code=${d.code}>
        <div class="st-issue__head">
          <span class="st-issue__tag">${d.level === 'warning' ? t('提示') : t('问题')}</span>
          <span class="st-issue__msg">${d.message}</span>
        </div>
        <div class="st-issue__fix">${t('怎么改：')}${d.fix}</div>
        <div class="st-issue__foot">
          ${d.autofix && onFix ? html`<button type="button" class="st-link-btn" disabled=${busy} onClick=${() => onFix(i)} data-testid="fix">${t('一键修复')}</button>` : null}
          <code class="st-issue__code">${d.code}</code>
          ${compact ? null : html`<details class="st-issue__detail"><summary>${t('原文')}</summary><code>${d.detail}</code></details>`}
        </div>
      </li>`;
    })}
  </ul>`;
}

/** An error the API answered, in plain words (an alert's text). @param {any} err */
export function errorText(err) {
  const d = describeIssue({ level: 'problem', code: err?.code || 'PLUGIN_STUDIO_REQUEST', text: err?.detail || err?.message || '', params: err?.params || {} }, getLang());
  return `${d.message}\n${t('怎么改：')}${d.fix}`;
}
