import { jsonText } from '../gameData.js';
import { dslExample } from '../dslExamples.js';

export default {
  id: 'meta', class: 'content', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, options }) {
    return { manifest: { scope: ['room'], permissions: ['dsl'], dsl: ['dsl/meta.json'] },
      files: { 'dsl/meta.json': jsonText(options.dsl !== undefined ? options.dsl : dslExample('lmlee', id).spec) } };
  },
};
