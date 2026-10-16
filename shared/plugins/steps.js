// Minimum step and per-tick iteration cap for plugin-controlled subtract loops (DESIGN §32.5).
// Shared code does not import the server. STEP_TICK is 1/30, the same value as server/sim/constants.js TICK.

import { dataBound, isStepKey } from './limits.js';
import { officialPositiveMin } from './officialBounds.js';

export { isStepKey };

/** One simulation tick, in game seconds. Locked equal to TICK by the regression test. */
export const STEP_TICK = 1 / 30;
/** How many times a per-tick subtract loop may run in one call. Same budget as battle.every. */
export const STEP_PER_TICK = 8;

/**
 * Step length for a subtract loop. Non-positive values are unchanged (a 0 interval still means "off").
 * A positive value at or above the official minimum positive of `key` is unchanged, even when it is
 * shorter than one tick (official `interval` 0.03 and `atk_interval` 0.025). Anything smaller is raised
 * to max(one tick, official minimum / 10). When that minimum has not been installed, only a step below
 * a tenth of a tick is raised, so a cold cache does not move an official 0.03. [ASSUMED] DESIGN §32.5.
 * @param {string} key
 * @param {unknown} value
 * @param {unknown} [fallback] used only when `value` is not finite
 */
export function stepOf(key, value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fb = Number(fallback);
    return Number.isFinite(fb) ? fb : STEP_TICK;
  }
  if (!(n > 0)) return n;
  const officialMin = officialPositiveMin(key);
  if (officialMin > 0 && n + 1e-12 >= officialMin) return n;
  // [ASSUMED] A missing table must not lift official sub-tick intervals (0.03, 0.025) up to one tick.
  if (!(officialMin > 0)) return n < STEP_TICK / 10 ? STEP_TICK : n;
  const minStep = Math.max(STEP_TICK, officialMin / 10);
  return n < minStep ? minStep : n;
}

/**
 * Iteration cap for a burst that is not one tick of accumulated time (a skill-end catch-up, one spend).
 * Official bursts stay under the cap because the cap is max(10 × that official count, 64).
 * @param {unknown} officialIterations
 */
export function burstLimit(officialIterations) {
  return dataBound(officialIterations);
}
