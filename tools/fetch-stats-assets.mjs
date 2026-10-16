// Fetch only the official statistics artwork, preserving every existing manifest entry.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Downloader } from './assets/downloader.mjs';
import { contentHash } from './assets/manifest.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';
import { statsTemplateJobs } from './assets/stats-template.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function main() {
  const jobs = await statsTemplateJobs(root);
  const dl = new Downloader({ root: join(root, 'public/assets'), ledgerPath: join(root, '.cache/assets-ledger.json'), keepExisting: true });
  await dl.loadLedger();
  const results = await dl.run(jobs, 'stats-assets');
  for (const job of jobs) {
    if (!['ok', 'skip'].includes(results.get(job.rel)?.status)) throw new Error(`could not fetch ${job.name}`);
  }
  const file = join(root, 'data/assets.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const previous = new Set(Object.values(manifest.ui || {}));
  for (const job of jobs) {
    const url = `/assets/${job.rel}`;
    manifest.ui[`statistics/${job.name}`] = url;
    if (!previous.has(url)) {
      manifest.stats.files++;
      manifest.stats.bytes += results.get(job.rel).bytes;
    }
  }
  manifest.stats.ui = Object.keys(manifest.ui).length;
  const { version, hash, generator, stats, ...body } = manifest;
  manifest.hash = contentHash(body);
  await writeFile(`${file}.tmp`, JSON.stringify(manifest));
  await rename(`${file}.tmp`, file);
}
if (pathToFileURL(process.argv[1] || '').href === import.meta.url && !restartForEnvProxy()) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
