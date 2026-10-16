// test/match/fixtures/hostMatch.js — a match module for the match host tests (test/match/plugin-host.test.js; startServer
// `matchHost.matchModule`, server/match/host/entry.js imports it instead of server/match/Match.js — like the lobby's
// MatchClass for an in-process match). The platform's StubMatch (server/match/StubMatch.js) with three test hooks:
//   g.emote with EMOTES[0] — a probe: the match posts an m.toast naming what the worker gave it (its options' cs,
//   requireCs, modeId, the seat's ops) and facts of the data the worker installed (a patched bond value, the plugin
//   modes, the engine's cap of the blackboard key `times` — the official-bounds snapshot it installed); EMOTES[1] spins forever (the worker stops answering and beating: the watchdog's case); EMOTES[2] throws out
//   of the worker's event loop (an uncaught error: the crash case); EMOTES[3] allocates without end (the host runs out of
//   memory: what a data bomb past every check would do). (Emote ids, because the protocol takes no other
//   intent a stub would answer.)
// Never used by the server itself.

import { StubMatch } from '../../../server/match/StubMatch.js';
import { EMOTES } from '../../../shared/constants.js';
import { getData } from '../../../server/data.js';
import { bbCap } from '../../../shared/plugins/officialBounds.js';

export class Match extends StubMatch {
  constructor(opts) {
    super(opts);
    this.opts = opts;
  }

  handle(playerId, msg) {
    if (msg && msg.t === 'g.emote' && msg.id === EMOTES[0]) {
      const d = getData();
      const modes = Object.keys(d.config?.modes || {});
      const seat = (this.opts.seats || []).find((x) => x.playerId === playerId) || {};
      this.sendFn(playerId, { t: 'm.toast', kind: 'info', text: `probe;cs=${this.opts.cs || ''};requireCs=${this.opts.requireCs === true};modeId=${this.opts.modeId};`
        + `bond=${d.bonds?.deputShip?.bb?.base_def};plugin-modes=${modes.filter((m) => m.startsWith('mode_x_')).join(',')};ops=${JSON.stringify(seat.ops || null)};`
        + `times-cap=${bbCap('times')}` });
      return { ok: true };
    }
    if (msg && msg.t === 'g.emote' && msg.id === EMOTES[1]) {
      for (;;) { /* the plugin's code never returns: no answer, no heartbeat */ }
    }
    if (msg && msg.t === 'g.emote' && msg.id === EMOTES[2]) {
      setTimeout(() => { throw new Error('a plugin crashed its worker'); }, 0);
      return { ok: true };
    }
    if (msg && msg.t === 'g.emote' && msg.id === EMOTES[3]) {
      setTimeout(() => { const keep = []; for (;;) keep.push(new Array(1e6).fill(keep.length)); }, 0);
      return { ok: true };
    }
    return super.handle(playerId, msg);
  }
}
