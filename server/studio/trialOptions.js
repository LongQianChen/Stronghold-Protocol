import fs from 'node:fs';
import { readStudioData } from './gameData.js';
let cached;
let cachedDir;
export function trialOptions(dataDir) {
  if (cached && cachedDir === dataDir) return cached;
  const data = readStudioData(dataDir);
  const golden = [];
  // Source checkouts offer their exact golden battle corpus; distributions without tools/test omit this group.
  if (fs.existsSync(new URL('../../tools/golden.mjs', import.meta.url))) for (const family of ['roster', 'bonds', 'fields', 'standins', 'diy']) {
    try {
      const doc = JSON.parse(fs.readFileSync(new URL(`../../test/golden/${family}.json`, import.meta.url), 'utf8'));
      for (const id of Object.keys(doc.scenarios)) golden.push({ id: `golden:${family}:${id}`, name: `${family} / ${id}` });
    } catch { /* no corpus in a release */ }
  }
  cachedDir = dataDir;
  cached = {
    operators: Object.values(data.chess).filter(r => !r.isGolden && !r.isDiy && !r.isHidden).map(r => ({ id: r.chessId, name: r.name })),
    waves: Object.entries(data.waves).filter(([, w]) => w.kind === 'normal').map(([id, w]) => ({ id, name: w.name || id })), golden,
  };
  return cached;
}
