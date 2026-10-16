// server/match/scheduler.js — injectable time source + timers for the match engine.
//
// The match never touches setTimeout/Date.now directly: it asks a scheduler. Two implementations:
//
//   RealScheduler({ now })        production: wall-clock timers (unref'd so a stray timer never keeps the process
//                                 alive). `now` defaults to Date.now (the lobby passes its injectable clock).
//   VirtualScheduler({ start, instantCombat })
//                                 tests / tools: a priority queue of callbacks on a virtual clock. Nothing runs until
//                                 the owner advances time (advance / runNext / runUntil / runAll). With
//                                 `instantCombat: true` (default) the match steps battles to completion synchronously
//                                 inside one callback instead of pacing them at 2× real time, so an entire match runs
//                                 in milliseconds of wall time.
//
// Common interface: now(), setTimeout(fn, ms) → handle, clearTimeout(handle), setInterval(fn, ms) → handle,
// clearInterval(handle), dispose(). Flags: `virtual` (bool), `instant` (bool: battles run synchronously).
// Callbacks are expected to guard themselves; the schedulers still catch and report (onError) so one faulty
// callback never breaks the queue.

const MAX_DELAY = 2 ** 31 - 1;
const clampDelay = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DELAY, n);
};

export class RealScheduler {
  /** @param {{ now?: () => number, onError?: (e: unknown) => void }} [opts] */
  constructor({ now = Date.now, onError = null } = {}) {
    this.virtual = false;
    this.instant = false;
    this._now = typeof now === 'function' ? now : Date.now;
    this._onError = onError;
    /** @type {Set<any>} */
    this._timeouts = new Set();
    /** @type {Set<any>} */
    this._intervals = new Set();
    this.disposed = false;
  }

  now() {
    try { return Number(this._now()) || Date.now(); } catch { return Date.now(); }
  }

  _wrap(fn) {
    return () => {
      try { fn(); } catch (e) { if (this._onError) this._onError(e); else console.error('[scheduler] callback threw', e); }
    };
  }

  setTimeout(fn, ms) {
    if (this.disposed || typeof fn !== 'function') return null;
    const run = this._wrap(fn);
    const h = setTimeout(() => { this._timeouts.delete(h); run(); }, clampDelay(ms));
    h.unref?.();
    this._timeouts.add(h);
    return h;
  }

  clearTimeout(h) {
    if (!h) return;
    clearTimeout(h);
    this._timeouts.delete(h);
  }

  setInterval(fn, ms) {
    if (this.disposed || typeof fn !== 'function') return null;
    const h = setInterval(this._wrap(fn), Math.max(1, clampDelay(ms)));
    h.unref?.();
    this._intervals.add(h);
    return h;
  }

  clearInterval(h) {
    if (!h) return;
    clearInterval(h);
    this._intervals.delete(h);
  }

  dispose() {
    this.disposed = true;
    for (const h of this._timeouts) clearTimeout(h);
    for (const h of this._intervals) clearInterval(h);
    this._timeouts.clear();
    this._intervals.clear();
  }
}

export class VirtualScheduler {
  /**
   * @param {{ start?: number, instantCombat?: boolean, onError?: (e: unknown) => void }} [opts]
   */
  constructor({ start = 1_700_000_000_000, instantCombat = true, onError = null } = {}) {
    this.virtual = true;
    this.instant = instantCombat !== false;
    this.t = Number(start) || 0;
    this._seq = 0;
    /** @type {Array<{ id: number, at: number, seq: number, fn: Function, every: number, cancelled: boolean }>} */
    this._q = [];
    this._onError = onError;
    this.disposed = false;
    /** callbacks executed so far (diagnostics) */
    this.executed = 0;
    /** errors thrown by callbacks (tests assert this stays empty) */
    this.errors = [];
  }

  now() { return this.t; }

  _push(fn, ms, every) {
    if (this.disposed || typeof fn !== 'function') return null;
    const e = { id: ++this._seq, at: this.t + clampDelay(ms), seq: this._seq, fn, every, cancelled: false };
    // binary insertion keeps the queue sorted by (at, seq)
    let lo = 0;
    let hi = this._q.length;
    while (lo < hi) { // loop-cap: binary search
      const mid = (lo + hi) >> 1;
      const o = this._q[mid];
      if (o.at < e.at || (o.at === e.at && o.seq < e.seq)) lo = mid + 1; else hi = mid;
    }
    this._q.splice(lo, 0, e);
    return e;
  }

  setTimeout(fn, ms) { return this._push(fn, ms, 0); }
  clearTimeout(h) { if (h && typeof h === 'object') h.cancelled = true; }
  setInterval(fn, ms) { return this._push(fn, Math.max(1, clampDelay(ms)), Math.max(1, clampDelay(ms))); }
  clearInterval(h) { if (h && typeof h === 'object') h.cancelled = true; }

  /** Number of live (not cancelled) queued callbacks. */
  pending() {
    let n = 0;
    for (const e of this._q) if (!e.cancelled) n++;
    return n;
  }

  /** Time of the next live callback, or null. */
  nextAt() {
    while (this._q.length && this._q[0].cancelled) this._q.shift(); // loop-cap: queue of timers
    return this._q.length ? this._q[0].at : null;
  }

  /** Run the earliest callback (advancing the clock to it). Returns false when the queue is empty. */
  runNext() {
    while (this._q.length && this._q[0].cancelled) this._q.shift(); // loop-cap: queue of timers
    const e = this._q.shift();
    if (!e) return false;
    if (e.at > this.t) this.t = e.at;
    if (e.every > 0) {
      // re-arm before running so the callback may clear itself
      e.at = this.t + e.every;
      e.seq = ++this._seq;
      this._reinsert(e);
    }
    this.executed++;
    try { e.fn(); } catch (err) {
      this.errors.push(err);
      if (this._onError) this._onError(err); else console.error('[virtual scheduler] callback threw', err);
    }
    return true;
  }

  _reinsert(e) {
    let lo = 0;
    let hi = this._q.length;
    while (lo < hi) { // loop-cap: binary search
      const mid = (lo + hi) >> 1;
      const o = this._q[mid];
      if (o.at < e.at || (o.at === e.at && o.seq < e.seq)) lo = mid + 1; else hi = mid;
    }
    this._q.splice(lo, 0, e);
  }

  /** Advance the clock by `ms`, running every callback that falls due (in order). */
  advance(ms) {
    const target = this.t + Math.max(0, Number(ms) || 0);
    for (;;) {
      const at = this.nextAt();
      if (at == null || at > target) break;
      this.runNext();
    }
    if (target > this.t) this.t = target;
  }

  /**
   * Run callbacks until `pred()` is true (checked before each callback), the queue is empty, or a limit is hit.
   * Returns true when the predicate held.
   */
  runUntil(pred, { maxSteps = 1e7, maxTime = Infinity } = {}) {
    const limitT = this.t + maxTime;
    for (let i = 0; i < maxSteps; i++) {
      if (pred()) return true;
      const at = this.nextAt();
      if (at == null || at > limitT) return !!pred();
      this.runNext();
    }
    return !!pred();
  }

  /** Run until the queue is empty (or maxSteps). Returns the number of callbacks run. */
  runAll({ maxSteps = 1e7 } = {}) {
    let n = 0;
    while (n < maxSteps && this.runNext()) n++; // loop-cap: maxSteps
    return n;
  }

  dispose() {
    this.disposed = true;
    for (const e of this._q) e.cancelled = true;
    this._q = [];
  }
}
