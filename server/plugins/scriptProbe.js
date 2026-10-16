// Composition registration preflight. Only this disposable child imports author modules.
import fs from 'node:fs';
import { loadScripts, scriptExecution } from '../../shared/plugins/scriptLoad.js';
try {
  const {scripts, hashInput} = JSON.parse(fs.readFileSync(0,'utf8'));
  let registrations;
  if (scriptExecution(scripts) === 'sandbox') {
    if (!process.permission || process.env.SP_PLUGIN_SCRIPTS !== 'sandbox') throw new Error('sandbox probe requires permissions');
    const sandbox = await import('../../shared/plugins/sandbox.js');
    await sandbox.initializeSandbox({ loadSES: () => import('ses') });
    const { parse } = await import('acorn');
    registrations = await sandbox.installSandboxScripts(scripts, { hashInput, parse });
  } else registrations = await loadScripts(scripts,{hashInput});
  fs.writeFileSync(3,JSON.stringify({registrations}));
} catch (e) { fs.writeFileSync(3,JSON.stringify({code:e.code || 'PLUGIN_SCRIPT_CHECK',message:e.message})); process.exitCode=1; }
