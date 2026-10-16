// render/vfx/rng.js — random numbers of the official battle effects (client-only cosmetics: not the sim's RNG).
// A seeded generator per particle system (mulberry32) so the dev viewer and the tests can replay an effect exactly,
// and a hash for the per-particle field randoms: Unity keeps one random number per particle and field (the r of
// render/vfx/curves.js), here derived from the particle's seed and a field id instead of stored.

/** Seeded generator: `.next()` → [0, 1). */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A 32-bit seed for a new particle. */
  seed() { return (this.next() * 4294967296) >>> 0; }

  range(a, b) { return a + (b - a) * this.next(); }
}

/** The random number of field `f` (a small integer) of the particle with seed `s`: [0, 1). */
export function hashRand(s, f) {
  let h = Math.imul((s ^ Math.imul(f + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Field ids of hashRand (one per particle property that keeps a random number). */
export const RF = Object.freeze({
  LIFETIME: 0, SPEED: 1, SIZE: 2, SIZE_Y: 3, SIZE_Z: 4, ROT: 5, ROT_X: 6, ROT_Y: 7, COLOR: 8, GRAVITY: 9,
  SIZE_OL: 10, ROT_OL: 11, COLOR_OL: 12, VEL_X: 13, VEL_Y: 14, VEL_Z: 15, ORB_X: 16, ORB_Y: 17, ORB_Z: 18,
  RADIAL: 19, SPEED_MOD: 20, LIMIT: 21, DRAG: 22, FORCE_X: 23, FORCE_Y: 24, FORCE_Z: 25, FRAME: 26, START_FRAME: 27,
  ROW: 28, FLIP_U: 29, FLIP_V: 30, FLIP_X: 31, FLIP_Y: 32, FLIP_Z: 33, ROT_DIR: 34, NOISE: 35, TRAIL: 36,
  TRAIL_LIFE: 37, CUSTOM: 38, MESH: 39, INHERIT: 40, ROT_OL_X: 41, ROT_OL_Y: 42, SIZE_OL_Y: 43, SIZE_OL_Z: 44,
  COLOR_SPEED: 45, SIZE_SPEED: 46, ROT_SPEED: 47, LIFE_SPEED: 48, SUB: 49, TRAIL_W: 50, TRAIL_C: 51, OFFSET_X: 52,
});
