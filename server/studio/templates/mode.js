import { jsonText, localId } from '../gameData.js';

export default {
  id: 'mode', class: 'content', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, name, options, data }) {
    return { manifest: { scope: ['room'], permissions: ['data.add'], modes: ['data/mode.json'] },
      files: { 'data/mode.json': jsonText({ id: `mode_x_${localId(id)}_one`, base: options.base || 'mode_single_normal',
        set: { name: name || id, economy: { refreshPrice: options.refreshPrice ?? 0, ...(options.income ? { income: options.income } : options.incomePerRound !== undefined ? { income: Array.from({ length: 33 }, (_, n) => n ? options.incomePerRound : 0), incomeCap: options.incomePerRound } : {}) },
          timers: { infoCheck: options.infoCheck ?? 10 },
          ...(options.prepTime !== undefined ? { rounds: Object.fromEntries(Object.entries(data.config.modes[options.base || 'mode_single_normal'].rounds).map(([n, r]) => [n, { ...r, prepTime: options.prepTime }])) } : {}),
          ...(options.dpInit !== undefined ? { dp: { init: options.dpInit } } : {}) } }) } };
  },
};
