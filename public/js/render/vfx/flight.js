// render/vfx/flight.js — how an official projectile flies (DESIGN §33.12 Projectile; the client's movement classes,
// read from its native code): which effect flies and which line goes with it, the lobbed arc of a ParacurveMovement and
// the wobble of an AmiyaS2Movement. The wiring (render/vfx/wiring.js `_fly`) keeps the sim's flight time; these give the
// path's shape. Pure functions (Node tests).
//
//   projectileParts(proj)                { main, rope, chain, life }: the flying effect, a HarpoonRenderer's rope, a
//                                        chain lightning's line, the projectile class's LIMITED life
//   paracurve(mv, hs, ht, dist, seed)    a ParacurveMovement's arc for a start / end height and a distance, or null
//   arcHeight(arc, k, ht)                the height at flight fraction k (0…1), landing at the end height `ht`
//   wobble(mv, seed)                     an AmiyaS2Movement's sideways wobble { amp, hz, phase }, or null

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

/**
 * A projectile's parts by role (index.json Projectile, DESIGN §33.12), read from the behaviours the entry lists:
 * `main` — the flying effect, the `_mainEffect` of its projectile class (SimpleProjectile, HarpoonProjectile,
 * LassoProjectile, LaserProjectile …; null when that class names none: 溯光星源 S3's timer, a rope alone); `rope` — a
 * HarpoonRenderer's line, which the client stretches every tick from the shooter's point to the head
 * (HarpoonRenderer.OnTick / _UpdatePosition); `chain` — a ChainLightningEffectBehaviour's lightning, which the client
 * plays between the chain's targets as the shot reaches them (ChainLightningHitBehaviour.OnProjectileReached /
 * DoSelectTargetToHit → PlayLineEffect; the behaviour has no tick of its own: no line follows the shot in flight); `life`
 * — the projectile class's LIMITED life (s; else index.json's `lifeTime`). An index written before 2026-10-15 took
 * `main` and `lifeTime` from the last behaviour with a `_mainEffect`: 29 projectiles of the used set named their chain or
 * rope line there — a world-space LineRenderer flown as the shot, drawn where it was authored — and lost the flying
 * effect; a later index names the line `link` (either kind: the behaviours say which). Cached on the entry.
 * @returns {{ main: string|null, rope: string|null, chain: string|null, life: number|null }}
 */
export function projectileParts(proj) {
  if (!proj || typeof proj !== 'object') return { main: null, rope: null, chain: null, life: null };
  if (proj.__parts) return proj.__parts;
  let own = null, rope = null, chain = null;
  for (const b of Array.isArray(proj.behaviours) ? proj.behaviours : []) {
    const f = b && b.fields && typeof b.fields === 'object' ? b.fields : null;
    if (!f || typeof f._mainEffect !== 'string') continue;
    const cls = String(b.class || '');
    if (cls === 'HarpoonRenderer') rope = rope || lc(f._mainEffect);
    else if (cls === 'ChainLightningEffectBehaviour') chain = chain || lc(f._mainEffect);
    else if (own === null && /Projectile$/.test(cls)) own = b;
  }
  const idxMain = lc(proj.main);
  const main = own ? lc(own.fields._mainEffect) : idxMain && idxMain !== rope && idxMain !== chain ? idxMain : null;
  const ownLife = own && Number(own.fields._lifeTimeType) === 1 ? Number(own.fields._lifeTime) : NaN;
  const life = Number.isFinite(ownLife) ? ownLife : proj.lifeTime != null && Number.isFinite(Number(proj.lifeTime)) ? Number(proj.lifeTime) : null;
  const parts = Object.freeze({ main, rope, chain, life });
  try { Object.defineProperty(proj, '__parts', { value: parts, enumerable: false }); } catch { /* a frozen index */ }
  return parts;
}

/** A deterministic 0…1 of a seed (the random height / inverse coin of a ParacurveMovement: replayable). */
function unit01(seed) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A ParacurveMovement's arc (Torappu.Battle.Projectiles.ParacurveMovement, read from the client's GameAssembly.dll —
 * OnInit, OnTick, _CalculateNextPosition): the projectile crosses the ground at its speed `m_speed` (= `_speed`)
 * homing on the target, and climbs ballistically: the raise height h = `raiseHeight` (`useRandomHeight`: a value in
 * `randomHeightRange`) — 0 when the ground distance is not above `noRaiseHeightThreshold` —, the drop
 * H = max(0, hs + h − ht) from the top to the end height, flight time T = distance / speed, gravity
 * g = 2(√h + √H)² / T² and initial climb √(2gh): it tops out h above its start (heights in tiles, the start the
 * shooter's mount point) and comes down on the target's point. After the top the client re-solves g each tick to land
 * on the target's current height (a homing end). `inverseParacurve` (`randomInverseParacurve`: a coin) flies the mirror
 * image: climb √(2gh) − gT under −g, a sag below the line. As a function of the flight fraction k = t / T the height is
 * hs + 2√h·s·k − s²·k² with s = √h + √H (inverse: hs + 2s(√h − s)·k + s²·k²) whatever T is, so the remake's own flight
 * time (the sim's) flies the same path. Returns null for another movement class.
 * @param {any} mv the projectile's `movement`
 * @param {number} hs start height (tiles above the ground plane)
 * @param {number} ht end height
 * @param {number} dist ground distance (tiles)
 * @param {number} [seed] the random height / coin
 * @returns {{ h: number, inverse: boolean, hs: number }|null}
 */
export function paracurve(mv, hs, ht, dist, seed = 0) {
  if (!mv || mv.class !== 'ParacurveMovement') return null;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  let h = Math.max(0, num(mv.raiseHeight, 0));
  if (Number(mv.useRandomHeight) === 1 && Array.isArray(mv.randomHeightRange)) {
    const a = num(mv.randomHeightRange[0], h), b = num(mv.randomHeightRange[1], h);
    h = Math.max(0, a + (b - a) * unit01(seed));
  }
  if (!(dist > num(mv.noRaiseHeightThreshold, 0))) h = 0;
  const inverse = Number(mv.randomInverseParacurve) === 1 ? unit01(seed ^ 0x5bd1e995) < 0.5 : Number(mv.inverseParacurve) === 1;
  return { h, inverse, hs };
}

/**
 * The arc's height at flight fraction k (paracurve): it lands on `ht`, the end height now (a homing end; an end above
 * the top — the drop clamped to 0 — is reached by a linear share of the difference [ASSUMED: the client's re-solve
 * after the top]).
 */
export function arcHeight(arc, k, ht) {
  const kk = k < 0 ? 0 : k > 1 ? 1 : k;
  const rh = Math.sqrt(arc.h);
  const s = rh + Math.sqrt(Math.max(0, arc.hs + arc.h - ht));
  if (!(s > 0)) return arc.hs + (ht - arc.hs) * kk;
  const y = arc.inverse ? arc.hs + 2 * s * (rh - s) * kk + s * s * kk * kk : arc.hs + 2 * rh * s * kk - s * s * kk * kk;
  const y1 = arc.hs + 2 * rh * s - s * s;
  return y + (ht - y1) * kk;
}

/**
 * An AmiyaS2Movement's wobble (Torappu.Battle.Projectiles.AmiyaS2Movement: _UpdateBodyAnimation sets the body's local
 * position to (0, sin φ · `yAnimateOffset`, 0), φ advancing by 2π · `yAnimateSpeed` per second from a random start; the
 * body faces its flight, so the wobble runs across it): { amp (tiles), hz, phase (radians) }, or null for another
 * class or a zero amplitude. Its flight is straight and homing, in `time` s after a start phase of `startDuration` s
 * towards `startDistance` in a random direction (both 0 for the roster's 安洁莉娜 S2); the remake keeps the sim's time.
 */
export function wobble(mv, seed = 0) {
  if (!mv || mv.class !== 'AmiyaS2Movement') return null;
  const amp = Number(mv.yAnimateOffset) || 0;
  const hz = Number(mv.yAnimateSpeed) || 0;
  if (!amp) return null;
  return { amp, hz, phase: unit01(seed) * Math.PI * 2 };
}
