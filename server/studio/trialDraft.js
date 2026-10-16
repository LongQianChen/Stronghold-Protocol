// Generated draft files obey the same pack-path contract as saved studio files.
import fs from 'node:fs';
import path from 'node:path';
import { isPackPath } from '../../shared/plugins/manifest.js';
import { StudioError } from './files.js';
export function writeTrialDraftFile(dir, rel, text) {
  if (!isPackPath(rel) || path.isAbsolute(rel)) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: rel });
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
