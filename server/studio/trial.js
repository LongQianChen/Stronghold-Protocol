// Isolated author battles. The timeout covers validation, composition and both simulations.
import { fork, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPluginId } from '../../shared/plugins/manifest.js';
import { StudioError } from './files.js';

// [ASSUMED] Two jobs per server, 20 wall seconds per comparison, 512 MB per child, 16 MB result.
export const TRIAL_LIMITS = Object.freeze({ concurrent: 2, timeoutMs: 20000, heapMb: 512, resultBytes: 16 * 1024 * 1024 });
export function createTrialBench({ registry, files, spawn = fork, limits = TRIAL_LIMITS }) {
  const jobs = new Set();
  let closed = false;
  function run(request, { signal } = {}) {
    if (closed || signal?.aborted) return Promise.reject(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 503));
    if (!isPluginId(request?.id)) return Promise.reject(new StudioError('PLUGIN_ID', 400, { id: request?.id }));
    if (jobs.size >= limits.concurrent) return Promise.reject(new StudioError('PLUGIN_STUDIO_TRIAL_BUSY', 429));
    files.root(request.id); // same link/path gate as all studio reads
    // A wizard draft can contain data only. Author script code never arrives in this request.
    const allowedScripts = registry.plugins().filter(p => p.status === 'loaded' && p.script).map(p => ({ id: p.id, hash: p.script.lockHash, execution: p.script.execution }));
    return new Promise((resolve, reject) => {
      let child, temporary, timer;
      let done = false, exited = false;
      const job = { stop: () => finish(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 503)) };
      const abort = () => job.stop();
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const cleaned = () => {
          try { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
          catch { error = new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500); }
          jobs.delete(job);
          if (error) reject(error); else resolve(value);
        };
        // Reap the writer before removing its directory: it cannot recreate a draft after cleanup.
        if (child?.pid && !exited) child.once('exit', cleaned);
        if (child?.pid) {
          // Probe/runner descendants inherit this group. Kill them even if the leader already exited.
          if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5000, windowsHide: true, stdio: 'ignore' });
          else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
        }
        try { child?.kill('SIGKILL'); } catch { /* already exited */ }
        if (!child?.pid || exited) cleaned();
      };
      jobs.add(job);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (request.draft) temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-trial-'));
        child = spawn(fileURLToPath(new URL('./trialChild.js', import.meta.url)), [], {
          detached: true, execArgv: [`--max-old-space-size=${limits.heapMb}`],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
        });
        timer = setTimeout(() => finish(new StudioError('PLUGIN_STUDIO_TRIAL_TIMEOUT', 504)), limits.timeoutMs);
        child.once('error', () => finish(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500)));
        child.once('exit', () => { exited = true; finish(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500)); });
        child.once('message', message => {
          if (!message || Buffer.byteLength(JSON.stringify(message)) > limits.resultBytes) return finish(new StudioError('PLUGIN_STUDIO_TRIAL_LIMIT', 413));
          finish(null, message);
        });
        child.send({ dirs: registry.contentDirs, request, allowedScripts, temporary, heapMb: limits.heapMb });
      } catch { finish(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500)); }
    });
  }
  return { run, active: () => jobs.size, close() { closed = true; for (const job of [...jobs]) job.stop(); } };
}
