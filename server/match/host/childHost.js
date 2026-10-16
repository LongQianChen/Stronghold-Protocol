// P3b: defence in depth around SES. Node 22 permissions are NOT a malicious-code security boundary and do not
// restrict network. Deploy with OS/container isolation (DESIGN §32.11, DEPLOY.md).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const INSTALL_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export function scriptMode(env = process.env) { return env.SP_PLUGIN_SCRIPTS === 'sandbox' ? 'sandbox' : 'off'; }

export function forkSandbox(entry, { memoryMb = 768 } = {}) {
  return fork(entry, [], { ...sandboxProcessOptions(memoryMb), serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
}

/** Shared by match hosts and the disposable sandbox registration probe. */
export function sandboxProcessOptions(memoryMb = 768) {
  // [ASSUMED] The child needs only its install tree; no fs-write/child/worker/addon permission, no inherited NODE_OPTIONS.
  const matchEnv = {};
  for (const key of ['SP_VERIFY', 'SP_COMBAT', 'SP_BOT_EMOTES']) if (process.env[key] !== undefined) matchEnv[key] = process.env[key];
  return {
    cwd: INSTALL_ROOT,
    execArgv: ['--permission', `--allow-fs-read=${INSTALL_ROOT}`, `--max-old-space-size=${Math.max(64, Math.floor(memoryMb))}`],
    env: { NODE_ENV: 'production', SP_PLUGIN_SCRIPTS: 'sandbox', ...matchEnv },
  };
}

/** IPC is JSON, including source/data bytes: Buffer's JSON shape is never implicitly trusted. */
export function sandboxInit(init) {
  // Production descriptors already contain strings; never copy arbitrary source byte arrays here.
  return { ...init, files: Object.fromEntries(Object.entries(init.files).map(([key, bytes]) => [key, Array.from(bytes)])) };
}
