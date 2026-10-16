// .gitignore keeps per-machine state out of the repository (and so out of the release packages, which ship tracked
// files only: tools/package.mjs). GitHub #258: a local npm cache (`npm_config_cache=./.npm-cache`, `npm ci --cache
// .npm-cache`) must never be committed by any contributor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());

/** git's own verdict on a path (null when git or the repository is not available). */
function ignored(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (e) {
    return e && e.status === 1 ? false : null;
  }
}

test('GitHub #258: the local npm cache (.npm-cache/) is ignored, like node_modules/ and .cache/', () => {
  for (const entry of ['.npm-cache/', 'node_modules/', '.cache/']) assert.ok(lines.includes(entry), `.gitignore lists ${entry}`);
  for (const rel of ['.npm-cache/_cacache/index-v5/00/aa', '.npm-cache/_logs/debug-0.log']) {
    const v = ignored(rel);
    if (v !== null) assert.equal(v, true, `${rel} is ignored`);
  }
  assert.notEqual(ignored('package.json'), true, 'a tracked file is not');
});

test('a symlinked node_modules, vendor, art or cache folder (a worktree sharing them) is ignored too', () => {
  for (const entry of ['/node_modules', '/public/vendor', '/public/assets', '/public/fonts', '/.cache']) assert.ok(lines.includes(entry), `.gitignore lists ${entry}`);
  // without a trailing slash and absent from the index, git checks the path as a file: what a symlink is to it
  for (const rel of ['node_modules', 'public/vendor', 'public/assets', 'public/fonts', '.cache']) {
    const v = ignored(rel);
    if (v !== null) assert.equal(v, true, `${rel} as a symlink is ignored`);
  }
});
