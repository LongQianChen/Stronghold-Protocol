// Room screen (同盟等待室): configurable seat cards (avatar frame, name, ready state, AI badge, host crown),
// host controls (difficulty picker, add/remove AI in co-op, start), invite code with copy code /
// copy link, ready toggle and leave.
// The capacity branch keeps manual humans first within every fixed draft group (D004); the room shows it read-only.
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// Texts go through t() (docs/I18N.md).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, DEFAULT_SEATS, ROOM_CAPACITIES, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Modal,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { AssetCacheButton } from '../ui/assetCache.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { t, tc } from '../../../shared/i18n.js';

/**
 * Seats padded to the room's capacity (co-op 4–20, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const requested = Number.isInteger(room?.capacity) ? room.capacity : src.length || DEFAULT_SEATS;
  const cap = room?.mode === 'solo' ? 1 : Math.max(1, Math.min(MAX_SEATS, requested));
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  const emptySeats = seats.filter((s) => !s).length;
  const botCount = occupied.filter((s) => s.isBot).length;
  const maxAiPerRoom = Number.isInteger(room?.maxAiPerRoom) && room.maxAiPerRoom >= 0 ? room.maxAiPerRoom : null;
  const aiLimitReached = maxAiPerRoom !== null && botCount >= maxAiPerRoom;
  const aiLimitExceeded = maxAiPerRoom !== null && botCount > maxAiPerRoom;
  const waiting = !room?.inMatch;
  // a room with gameplay plugins (DESIGN §32.6): every player's page has loaded and checked its content (the host's too)
  const modded = isModdedRoom(room);
  const contentReady = !modded || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats, botCount, maxAiPerRoom, aiLimitReached, aiLimitExceeded,
    allowMatchmaking: room?.allowMatchmaking !== false,
    canSetMatchmaking: waiting && isHost && room?.mode === 'coop' && !!mine && !mine.isBot && !mine.left,
    canAddBot: waiting && isHost && room?.mode !== 'solo' && emptySeats > 0 && !aiLimitReached,
    transferableHumans: waiting && isHost && !!mine
      ? others.filter((s) => s.connected !== false && !s.left) : [],
    canStart: waiting && isHost && othersReady && !!mine && !aiLimitExceeded && contentReady
      && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    contentReady,
    myContent: modded ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * The upstream 「AI 队友最后选择」 indicator follows D004 in this branch: online manual humans choose before AI,
 * managed and disconnected seats within each fixed group. Solo rooms have no teammates; co-op always shows it on
 * and read-only, including frames from an older server that omit the flag.
 * @param {any} room room.state payload
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room) {
  if (!room || room.mode === 'solo') return null;
  return { on: true, editable: false };
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

export function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick, onTransferHost }) {
  const coop = room.mode !== 'solo';
  if (!seat) {
    const canAdd = coop && facts.isHost;
    return html`<article class="seat seat--empty" style=${`--seat-i:${index}`}>
      <header class="seat__head"><span class="seat__no num">P${index + 1}</span><${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//></header>
      <div class="seat__art seat__art--empty">
        <div class="seat__radar" aria-hidden="true"></div>
        <span class="seat__wait">${t('等待博士加入')}</span>
        <${MicroLabel}>AWAITING DOCTOR<//>
      </div>
      <footer class="seat__foot">
        ${canAdd
          ? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`}
              disabled=${!!busy || !facts.canAddBot} title=${facts.aiLimitReached ? t('已达到服务器允许的 AI 队友上限') : undefined}
              onClick=${onAddBot}>${t('添加 AI 队友')}<//>`
          : html`<span class="seat__state t-dim">${t('空位')}</span>`}
      </footer>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  return html`<article class=${`seat brackets${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''} is-${state}`}
      style=${`--seat-i:${index}`}>
    ${consent ? html`<span data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="seat__head">
      <span class="seat__no num">P${index + 1}</span>
      <${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//>
      ${isHostSeat ? html`<span class="seat__host"><${Icon} name="crown" />${t('房主')}</span>` : null}
    </header>
    <div class="seat__art">
      <div class="seat__stripes" aria-hidden="true"></div>
      <${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />
      ${seat.isBot ? html`<span class="seat__bot-label"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
    </div>
    <div class="seat__who">
      <span class="seat__name">${seat.name || t('博士')}</span>
      ${isMe ? html`<span class="seat__you">${t('你')}</span>` : null}
    </div>
    <${MicroLabel}>${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}<//>
    ${facts.modded && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
    <footer class="seat__foot">
      <span class=${`seat__state seat__state--${state}`}>
        ${state === 'ready' ? html`<${Icon} name="check" />${t('已就绪')}`
          : state === 'offline' ? html`<${Icon} name="wifiOff" />${t('连接中断')}`
          : state === 'host' ? html`<${Icon} name="crown" />${t('待命中')}`
          : html`<${Icon} name="hourglass" />${t('准备中')}`}
      </span>
      ${facts.isHost && (seat.isBot || !isMe) ? html`<div class="seat__actions">
        ${!seat.isBot && !offline && facts.transferableHumans.some((s) => s.playerId === seat.playerId) ? html`<${Tooltip} text=${t('转让房主给该博士')}>
          <${Button} variant="secondary" size="sm" square=${true} icon="crown" loading=${busy === `transfer${index}`}
            disabled=${!!busy} onClick=${() => onTransferHost(index, seat.name, seat.playerId)} aria-label=${t('转让房主给该博士')} />
        <//>` : null}
        ${seat.isBot ? html`<${Tooltip} text=${t('移除该 AI 队友')}>
          <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rm${index}`} disabled=${!!busy}
            onClick=${() => onRemoveBot(index, seat.playerId)} aria-label=${t('移除 AI 队友')} />
        <//>` : html`<${Tooltip} text=${t('将该博士移出同盟')}>
          <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `kick${index}`} disabled=${!!busy}
            onClick=${() => onKick(index, seat.name, seat.playerId)} aria-label=${t('移出该博士')} />
        <//>`}
      </div>` : null}
    </footer>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

function InviteBox({ code, name, difficulty }) {
  const copy = async (what) => {
    // the copied link carries an invitation line (#103): 「{name}邀请你加入卫戍协议：盟约【{difficulty}】」
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: name ?? '', difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
    const ok = await copyText(what === 'code' ? code : `${inviteLink(code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  return html`<div class="invite brackets">
    <div class="invite__label"><${Icon} name="key" /><span>${t('同盟密钥')}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t('同盟密钥 {code}', { code })}>${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}</div>
    <div class="invite__btns">
      <${Button} size="sm" icon="copy" onClick=${() => copy('code')}>${t('复制密钥')}<//>
      <${Button} size="sm" icon="link" onClick=${() => copy('link')}>${t('复制链接')}<//>
    </div>
  </div>`;
}

function DifficultyPicker({ room, isHost, busy, onPick }) {
  if (!isHost) {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('由房主选择')}</span>
    </div>`;
  }
  return html`<div class="dpick" role="radiogroup" aria-label=${t('模拟难度')}>
    ${DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="radio" aria-checked=${room.difficulty === d ? 'true' : 'false'}
        class=${`dpick__opt${room.difficulty === d ? ' is-active' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`}
        disabled=${!!busy} onClick=${() => room.difficulty !== d && onPick(d)}>
      <${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d].replace('模拟', ''))}
    </button>`)}
  </div>`;
}

/** Waiting-room policy follows room.state, including the permission change after host transfer. */
export function MatchmakingControl({ facts, busy, connected, onChange }) {
  const on = facts.allowMatchmaking;
  const label = on ? t('允许匹配') : t('禁止匹配');
  const hint = t('关闭后不会参与最快匹配，也不能从房间列表加入；持有邀请码仍可加入，观战不受影响。');
  const cls = `room-matchmaking${on ? ' is-on' : ' is-private'}`;
  return facts.canSetMatchmaking
    ? html`<button type="button" class=${`${cls} tapx`} role="switch" aria-checked=${on ? 'true' : 'false'}
        aria-label=${t('允许匹配')} title=${hint} data-testid="room-matchmaking"
        disabled=${!!busy || !connected} onClick=${() => onChange(!on)}><${Icon} name=${on ? 'check' : 'close'} />${label}</button>`
    : html`<span class=${cls} role="status" title=${hint} data-testid="room-matchmaking-state"><${Icon} name=${on ? 'check' : 'close'} />${label}</span>`;
}

function CapacityPicker({ room, facts, busy, connected, onPick, onMatchmaking }) {
  const capacity = room.capacity || facts.seats.length;
  const minCapacity = Math.max(1, ...facts.occupied.map((s) => s.seat + 1));
  return html`<div class="room-capacity" aria-label=${t('同盟席位')}>
    <span class="room-capacity__label">${t('人数上限')} <b class="num">${capacity}</b> ${t('人')}</span>
    ${facts.isHost ? html`<div class="room-capacity__options" role="radiogroup" aria-label=${t('调整同盟人数上限')}>
      ${ROOM_CAPACITIES.map((n) => html`<button key=${n} type="button" role="radio" aria-checked=${capacity === n ? 'true' : 'false'}
        class=${`room-capacity__opt${capacity === n ? ' is-active' : ''}`} disabled=${!!busy || n < minCapacity}
        title=${n < minCapacity ? t('先移除超出席位的玩家') : t('{n} 人房间', { n })}
        onClick=${() => n !== capacity && onPick(n)}>${n}</button>`)}
    </div>` : html`<span class="t-dim">${t('由房主设置')}</span>`}
    <span class="room-capacity__count num">${facts.occupied.length} / ${capacity}</span>
    <${MatchmakingControl} facts=${facts} busy=${busy} connected=${connected} onChange=${onMatchmaking} />
    ${facts.maxAiPerRoom !== null ? html`<span class=${`room-ai-limit${facts.aiLimitReached ? ' is-full' : ''}`} role="status"
        title=${facts.aiLimitReached ? t('已达到服务器允许的 AI 队友上限') : t('服主设置的每房 AI 队友上限')}>
      <${Icon} name="robot" />${t('AI 队友 {used} / {limit}', { used: facts.botCount, limit: facts.maxAiPerRoom })}
      ${facts.aiLimitReached ? html`<span>${t('已达上限')}</span>` : null}
    </span>` : null}
  </div>`;
}

/** D004 is a fixed co-op rule, including managed and disconnected human seats after manual humans. */
function AiLastRule({ option }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('本分支固定由在线且未托管的博士先选，AI、托管和掉线席位随后选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${true}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    <span class="t-dim">${t('固定规则')}</span>
  </div>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const facts = roomFacts(room, me.playerId);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat, playerId) => run(`rm${seat}`, () => net.request('room.removeBot', { seat, playerId }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = (seat, name, playerId) => run(`kick${seat}`, async () => {
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) await net.request('room.kick', { seat, playerId });
  });
  const transferHost = (seat, name, playerId) => run(`transfer${seat}`, async () => {
    const ok = await confirmDialog({ title: t('转让房主'),
      text: t('确定将房主转让给「{name}」吗？双方将交换席位，新房主位于 P1。', { name: name || t('博士') }),
      okText: t('转让') });
    if (ok) await net.request('room.transferHost', { playerId });
  });
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setCapacity = (capacity) => run('capacity', () => net.request('room.setCapacity', { capacity }));
  const setMatchmaking = (allowed) => run('matchmaking', () => net.request('room.setMatchmaking', { allowed }));
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的房主，离开后房主身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待房主开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，房主即可开始模拟')}</span>`;

  return html`<div class="screen room-screen">
    <header class="topbar">
      <div class="topbar__left">
        <${AssetCacheButton} compact=${true} />
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <${Button} variant="danger" size="lg" square=${true} icon="exit" loading=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')} />
        <//>
        <div class="room-ping">
          <${PingPill} ms=${conn.ping} online=${online} />
          <${MicroLabel}>${t('当前延迟')}<//>
        </div>
        <${Button} variant="secondary" size="sm" icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')}>${t('统计')}<//>
        <${SettingsButton} class="room-settings" variant="secondary" label=${t('设置')} />
        <${GuideButton} class="room-guide" variant="secondary" label=${t('玩法说明')} />
      </div>
      <div class="topbar__center">
        <${MicroLabel} tone="mint">${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}<//>
        <h1 class="topbar__title">${coop ? t('同盟模拟') : t('独立模拟')}<span class="topbar__sep"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />
          ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}</h1>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="topbar__right">
        ${coop ? html`<${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} />` : html`<div class="solo-note"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    ${coop ? html`<${CapacityPicker} room=${room} facts=${facts} busy=${busy} connected=${online} onPick=${setCapacity} onMatchmaking=${setMatchmaking} />` : null}
    <main class=${`seats${coop ? facts.seats.length > 10 ? ' seats--dense' : facts.seats.length > 4 ? ' seats--expanded' : '' : ' seats--solo'}${coop && facts.seats.length === 10 ? ' seats--ten' : ''}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} onTransferHost=${transferHost} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <span class="room-bar__label">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></span>
        <div class="room-bar__opts">
          <${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />
          <${AiLastRule} option=${aiLastOption(room)} />
        </div>
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
          ${facts.humans.length <= 8 ? html`<span class="ready-count__icons" aria-hidden="true">
            ${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}
          </span>` : null}
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right">
        <${LoadoutButton} from="room" size="lg" class="room-loadout" label=${t('干员调配')} />
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : !facts.contentReady ? t('仍有博士未载入房间的插件内容') : t('仍有博士未准备就绪')}>
              <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online} onClick=${start}>${t('开始模拟')}<//>
            <//>`
          : facts.spectating
            ? html`<${Button} variant="secondary" size="xl" icon="eye" disabled=${true}>${t('观战中')}<//>`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : null}>
              <${Button} variant=${myReady ? 'primary' : 'secondary'} size="xl" icon=${myReady ? 'check' : 'hourglass'} active=${myReady}
              loading=${busy === 'ready'} disabled=${!online || !facts.mine || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}>${myReady ? t('已就绪') : t('准备就绪')}<//>
            <//>`}
      </div>
    </footer>
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
