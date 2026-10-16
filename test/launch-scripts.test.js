// test/launch-scripts.test.js — scripts/launch.mjs --scripts (the plugin script mode for the server it starts,
// SP_PLUGIN_SCRIPTS — docs/PLUGINS.md §13) and scripts/start-windows-sandbox.bat, its double-click form on Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, serverEnv, SCRIPT_MODES } from '../scripts/launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('--scripts sets SP_PLUGIN_SCRIPTS for the server; off removes an inherited one; no flag keeps it', () => {
  assert.deepEqual([...SCRIPT_MODES], ['off', 'sandbox', 'trusted', 'trusted-force']);
  for (const argv of [['--scripts', 'sandbox'], ['--scripts=sandbox']]) {
    const o = parseArgs(argv);
    assert.equal(o.scripts, 'sandbox');
    assert.deepEqual(o.setupArgs, [], 'not passed on to setup');
    assert.equal(serverEnv(o, {}).SP_PLUGIN_SCRIPTS, 'sandbox');
  }
  assert.equal(serverEnv(parseArgs(['--scripts', 'off']), { SP_PLUGIN_SCRIPTS: 'sandbox' }).SP_PLUGIN_SCRIPTS, undefined);
  assert.equal(serverEnv(parseArgs([]), { SP_PLUGIN_SCRIPTS: 'trusted' }).SP_PLUGIN_SCRIPTS, 'trusted');
  const env = serverEnv(parseArgs(['--port', '3001', '--scripts', 'trusted-force', '--no-assets']), {});
  assert.deepEqual([env.PORT, env.SP_PLUGIN_SCRIPTS], ['3001', 'trusted-force']);
});

test('start-windows-sandbox.bat is start-windows.bat --scripts sandbox (CRLF, other arguments passed on)', () => {
  const bat = readFileSync(path.join(ROOT, 'scripts/start-windows-sandbox.bat'), 'utf8');
  assert.match(bat, /^@echo off\r\n/);
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF line endings (cmd.exe)');
  assert.match(bat, /call "%~dp0start-windows\.bat" --scripts sandbox %\*\r\n$/);
});
