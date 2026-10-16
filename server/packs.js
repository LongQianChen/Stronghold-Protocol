// server/packs.js — the content-pack registry of 0.2.0 (docs/PACKS.md), kept as a compatibility export. Since the plugin
// system (DESIGN §32, docs/PLUGINS.md) the registry is server/plugins/registry.js: it reads the same folders the same
// way — the single-file language packs of public/i18n/ (+ data/i18n/), the pack folders of packs/ — and plugins/ when
// it is given one, answers /packs/index.json exactly as before and serves only what a lang manifest names.
//
//   scanPacks(dirs, { app })           the language entries found, what was skipped and why, the warnings
//   packIndexOf(packs, { app })        the body of GET /packs/index.json
//   createPackRegistry(dirs, opts)     the live registry (refresh, list, index, report, servable — and the plugin
//                                      catalogue: plugins, pluginIndex)
//   LANG_DIR                           'i18n', the language folders' subdirectory

export { LANG_DIR, scanPacks, packIndexOf, createPackRegistry } from './plugins/registry.js';
