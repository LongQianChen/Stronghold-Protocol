// server/studio/templates/index.js — the templates a new plugin starts from (DESIGN §32.9, docs/PLUGINS.md §15): the
// studio's 新建插件 (POST /studio/api/plugins) and `node tools/plugin.mjs new <template> <id>` read this list. A template
// is one module: adding one (the data, DSL, script and interface templates of a later step) is adding a file here and
// its line in TEMPLATES — the studio's page then offers it, with an editor module of its own beside the others
// (public/studio/js/editors/).
//
// A template (StudioTemplate):
//   id        its name on the command line and in the API ('art', 'spine', 'voice', 'audio', 'dsl')
//   class     the plugin class it makes ('cosmetic')
//   kinds     the target kinds it changes (server/studio/targets.js TARGET_KINDS), in the picker's order
//   slots(target, manifest)   the places of a target it fills: `{ at, kind, field, dir, base }` — at the path in the asset
//             overlay (['chars', 'char_102_texas', 'avatar']), kind the value there (image / spine / audio / audioList /
//             track: shared/plugins/visual.js), field the name the page labels it by, dir + base where its files go
//             (art/char_102_texas/avatar.png …); manifest: the installation's art manifest (a voice's slots are its lines)
//   overlay(target)           the `assets` part of a new plugin for that target: its entry, empty (nothing replaced yet)
// createPlugin() puts a manifest and a README into a new folder. A cosmetic template adds nothing else (no file of the
// game, no picture): an empty entry is a valid plugin until the author fills a slot. A template with build() also
// writes its own files (the dsl template: one operator and one prep spec). check and pack pass on either as it is.

import { APP_VERSION, PLUGIN_API } from '../../../shared/constants.js';
import { isPluginId } from '../../../shared/plugins/manifest.js';
import art from './art.js';
import spine from './spine.js';
import voice from './voice.js';
import audio from './audio.js';
import numbers from './numbers.js';
import operator from './operator.js';
import dsl from './dsl.js';
import meta from './meta.js';
import mode from './mode.js';
import ui from './ui.js';
import script from './script.js';
import { readStudioData } from '../gameData.js';
import { DATA_DIR } from '../../data.js';
import { validateDsl, validatePrepSpec } from '../../sim/content/dsl/validate.js';
import { rememberOfficialBounds } from '../../../shared/plugins/officialBounds.js';
import { StudioError } from '../files.js';
import { readmeOf } from './readme.js';

/**
 * @typedef {import('../targets.js').Target} Target
 * @typedef {{ at: string[], kind: 'image' | 'spine' | 'audio' | 'audioList' | 'track', field: string, dir: string, base: string }} Slot
 * @typedef {{ id: string, class: string, kinds: string[], slots: (target: Target, manifest: any) => Slot[],
 *   overlay: (target: Target | null) => Record<string, any>, build?: (args: any) => any }} StudioTemplate
 */

/** @type {readonly StudioTemplate[]} every template, in the studio's order */
export const TEMPLATES = Object.freeze([art, spine, voice, audio, numbers, operator, dsl, meta, mode, ui, script]);

/** The template of an id, or null. @param {unknown} id */
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;

/** The game versions a new plugin is made for: this release's minor line (0.3.0-dev → ">=0.3.0 <0.4.0"). */
export function appRangeNow(version = APP_VERSION) {
  const m = /^(\d+)\.(\d+)\./.exec(String(version));
  return m ? `>=${m[1]}.${m[2]}.0 <${m[1]}.${Number(m[2]) + 1}.0` : '*';
}

/** Where a nested container path puts an entry: `{ a: { b: { [key]: value } } }`. */
function nest(path, key, value) {
  const out = {};
  let node = out;
  for (const k of path) node = node[k] = {};
  node[key] = value;
  return out;
}

/** An entry of a target's container in an overlay (an empty record, or an empty slot list for a track / sound). */
export function entryOverlay(target, value = {}) {
  return target ? nest(target.container, target.key, value) : {};
}

/**
 * A new plugin from a template (see the header): `{ manifest, files }` — plugin.json as an object and the other files
 * (README.md). `name` the display name (a text in `lang`), `target` what it changes (or none yet), `authors` / `license`
 * / `credits` as the author gave them.
 * @param {StudioTemplate} template
 * @param {{ id: string, name?: string, target?: Target | null, authors?: string[], license?: string, credits?: string,
 *   lang?: string, options?: any, data?: any }} opts
 * @returns {{ manifest: Record<string, any>, files: Record<string, string>, authoring?: any }}
 */
export function createPlugin(template, { id, name = '', target = null, authors = [], license = '', credits = '', lang = 'zh', options = {}, data = null }) {
  if (!isPluginId(id)) throw Object.assign(new Error(`${id} is not a plugin id`), { code: 'PLUGIN_ID' });
  /** A text the author gave (a string; anything else is none). @param {unknown} v @param {number} max */
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const text = str(name, 60) || id;
  const who = (Array.isArray(authors) ? authors : [authors]).map((a) => str(a, 200)).filter(Boolean).slice(0, 32);
  /** @type {Record<string, any>} */
  const manifest = {
    $schema: '../../schemas/plugin.schema.json',
    manifest: 2,
    name: { [lang === 'en' ? 'en' : 'zh']: text },
    version: '1.0.0',
    app: appRangeNow(),
    api: PLUGIN_API.current,
    class: template.class,
    scope: ['room', 'personal'],
  };
  if (who.length) manifest.authors = who;
  if (str(license, 100)) manifest.license = str(license, 100);
  if (str(credits, 500)) manifest.credits = str(credits, 500);
  if (template.build) {
    data ||= readStudioData(DATA_DIR);
    const made = template.build({ id, name: text, target, options, data });
    rememberOfficialBounds(data);
    const check = result => {
      if (result.ok) return;
      const p = result.problems[0];
      throw new StudioError(p.code, 400, { where: p.path, detail: p.zh });
    };
    for (const rel of made.manifest.operators || []) {
      const doc = JSON.parse(made.files[rel]);
      for (const rec of Array.isArray(doc) ? doc : [doc]) if (rec.kit?.dsl !== undefined) {
        const spec = rec.kit.dsl;
        if (spec?.pluginId !== undefined && spec.pluginId !== id) throw new StudioError('PLUGIN_DSL_PLUGIN_ID', 400);
        check(validateDsl(spec, { bounds: true }));
      }
    }
    for (const rel of made.manifest.dsl || []) check(validatePrepSpec(JSON.parse(made.files[rel]), id));
    Object.assign(manifest, made.manifest);
    const authoring = { template: template.id, target: target ? `${target.kind}:${target.key}` : '', options };
    return { manifest, files: { ...made.files, 'README.md': `# ${text}\n\nPlugin: ${id} (${template.id}).\n\nOpen /studio/ to edit and try a battle.\n\nSelf-check: schema → node tools/plugin.mjs check ${id} --strict → trial / node tools/plugin.mjs test ${id} → node tools/plugin.mjs pack ${id} --zip.\n\nSee docs/PLUGIN-GUIDE.md and docs/PLUGINS.md. Official kit references follow future official kit fixes. No game art is included.\n` }, authoring };
  }
  manifest.permissions = ['assets.override'];
  manifest.assets = template.overlay(target);
  return { manifest, files: { 'README.md': readmeOf({ id, name: text, template: template.id, target }) } };
}

/**
 * The JSON text a plugin.json is written as (the studio and the tool alike: two spaces, a final newline).
 * @param {unknown} manifest
 */
export const manifestText = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;
