import { templateFile } from '../gameData.js';
import { UI_SLOTS } from '../../../shared/plugins/ui.js';
import { StudioError } from '../files.js';

const escape = text => String(text).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
export default {
  id: 'ui', class: 'ui', kinds: [], slots: () => [], overlay: () => ({}),
  build({ name, options }) {
    const slot = options.slot || 'hud.right';
    if (!UI_SLOTS.includes(slot)) throw new StudioError('PLUGIN_UI_SLOTS', 400, { detail: slot });
    const title = escape(options.title || name);
    const source = templateFile('ui', 'ui/index.html').replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
      .replace(/<div id="label">.*?<\/div>/, `<div id="label">${title}</div>`).replace("slot: 'hud.right'", `slot: '${slot}'`);
    return { manifest: { scope: ['personal'], permissions: ['ui.frame'], slots: [slot], entry: { client: 'ui/index.html' } }, files: { 'ui/index.html': source } };
  },
};
