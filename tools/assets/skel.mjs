// Spine 3.8 binary skeleton (.skel) inspection in Node, using the same parser
// the client ships (@pixi-spine/runtime-3.8, a dependency of pixi-spine).
//
// We only need metadata: animation names + durations, event names, the times
// of `OnAttack` events per animation (hit timing, research 07 §5.4) and the
// skeleton bounds. Attachments are created without textures, so no atlas or
// canvas is needed; attachment paths are checked against the atlas region names
// to detect mismatched downloads.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));

let runtime = null;
/**
 * Lazily load @pixi-spine/runtime-3.8.
 * @returns {any} the runtime module
 * @throws when pixi-spine is not installed (run `npm install`)
 */
function loadRuntime() {
  if (runtime) return runtime;
  runtime = require('@pixi-spine/runtime-3.8');
  return runtime;
}

/**
 * True when the Spine parser can be loaded.
 * @returns {boolean}
 */
export function skelParserAvailable() {
  try { loadRuntime(); return true; } catch { return false; }
}

function makeLoader(r, regions, missing) {
  const check = (path) => { if (regions && !regions.has(path)) missing.add(path); };
  return {
    newRegionAttachment(skin, name, path) { check(path); return new r.RegionAttachment(name); },
    newMeshAttachment(skin, name, path) { check(path); return new r.MeshAttachment(name); },
    newBoundingBoxAttachment(skin, name) { return new r.BoundingBoxAttachment(name); },
    newPathAttachment(skin, name) { return new r.PathAttachment(name); },
    newPointAttachment(skin, name) { return new r.PointAttachment(name); },
    newClippingAttachment(skin, name) { return new r.ClippingAttachment(name); },
  };
}

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;

/**
 * @typedef {{ version: string, animations: string[], durations: Record<string, number>,
 *   events: string[], hits: Record<string, number[]>, bounds: {x:number,y:number,width:number,height:number}|null,
 *   missingRegions: string[] }} SkelInfo
 */

/**
 * Parse a Spine 3.8 binary skeleton.
 * @param {Uint8Array} bytes .skel file contents
 * @param {Set<string>} [atlasRegions] region names of the matching atlas (optional, for validation)
 * @returns {SkelInfo}
 * @throws on malformed data
 */
export function parseSkel(bytes, atlasRegions) {
  const r = loadRuntime();
  const missing = new Set();
  const bin = new r.SkeletonBinary(makeLoader(r, atlasRegions, missing));
  // the runtime reads `bytes.buffer` from its start (BinaryInput: new DataView(data.buffer)), so a view into a larger
  // buffer — a small file fs.readFileSync took from Node's buffer pool — is copied into one of its own first
  const own = bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const data = bin.readSkeletonData(own ? bytes : new Uint8Array(bytes));
  const animations = data.animations.map((a) => a.name);
  const durations = {};
  const hits = {};
  for (const a of data.animations) {
    durations[a.name] = round3(a.duration);
    for (const t of a.timelines) {
      if (!t || !Array.isArray(t.events)) continue;
      for (const e of t.events) {
        const nm = e?.data?.name;
        if (typeof nm === 'string' && /^onattack$/i.test(nm)) {
          (hits[a.name] ||= []).push(round3(e.time));
        }
      }
    }
    if (hits[a.name]) hits[a.name].sort((x, y) => x - y);
  }
  const w = Number(data.width); const h = Number(data.height);
  const bounds = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    ? { x: round3(data.x), y: round3(data.y), width: round3(w), height: round3(h) }
    : null;
  return {
    version: String(data.version ?? ''),
    animations,
    durations,
    events: data.events.map((e) => e.name),
    hits,
    bounds,
    missingRegions: [...missing].sort(),
  };
}
