// CLI test preload: install the exact composition before test imports instantiate the harness's DataSource.
import fs from 'node:fs';
import { setData } from '../data.js';
import { loadScripts } from '../../shared/plugins/scriptLoad.js';
import { installOfficialBounds } from '../../shared/plugins/officialBounds.js';
const set = JSON.parse(fs.readFileSync(process.env.SP_PLUGIN_TEST_SET,'utf8'));
setData(set.data);
installOfficialBounds(set.bounds);
await loadScripts(set.scripts,{hashInput:set.index});
