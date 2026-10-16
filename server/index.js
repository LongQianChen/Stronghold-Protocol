// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate with a per-connection outbound dictionary; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>), the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js: the content hash `cs`, DESIGN §32), the visual sets
//                      of cosmetic plugins (/vs/<vs16>/…, plugins/visualSet.js) and their files (/p/<id>/<hash8>/…),
//                      the content sets of gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js — DESIGN §32.6; the
//                      server owner's plugins/config.json: plugins/policy.js; a room's plugins: plugins/roomSets.js; its
//                      match then runs in that set's worker: match/host/)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json, /data/local-assets.json and /data/local-fx.json: every art URL with
//                      its hash segment (/assets/~<hash>/…, immutable when the hash matches); the files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createAnnouncementStore } from './announcements.js';
import { createAnnouncementNoticeMonitor } from './announcementNotices.js';
import { createServerSettings } from './serverSettings.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createAssetCacheHandler } from './http/assetCache.js';
import { createBandwidthEmergencyController, bandwidthEmergencyOptions } from './bandwidthEmergency.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError } from './http/common.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   announcementsDir?: string, serverSettingsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number, compactWire?: boolean, runtimeCache?: boolean,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number | null,
 *   assetCacheLimits?: { totalBps?: number, clientBps?: number, maxDownloads?: number, maxDownloadsPerClient?: number },
 *   assetCacheBuildCatalog?: Function,
 *   bandwidthEmergency?: object | false,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object,
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests)
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     announcements: ReturnType<typeof createAnnouncementStore>,
 *                     serverSettings: ReturnType<typeof createServerSettings>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  // Validate operator options before starting any session/watch timers.
  const emergencyOptions = bandwidthEmergencyOptions(opts.bandwidthEmergency === false ? { enabled: false } : opts.bandwidthEmergency || {});
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
  // like the data the matches use and the build tag below
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
  // whenever their folders change
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost: host, scriptMode });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = assetIndex ? createManifestViews({ dataDir, index: assetIndex, log }) : null;
  const serverSettings = createServerSettings({ dir: opts.serverSettingsDir, root: ROOT, log,
    onChange: (next) => applySettings(next) });
  const announcements = createAnnouncementStore({ dir: opts.announcementsDir, root: ROOT, log });
  // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
  const visual = createVisualSets({ registry: packs, log });
  // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
  // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
  const policy = createPluginPolicy({ pluginsDir, log });
  const contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
  // an out-of-memory abort in a worker thread ends the whole server)
  const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  const { registry, lobby, network } = createSessionStack(opts, { data, log, content, plugins: roomSets, hosts });
  const announcementNotices = createAnnouncementNoticeMonitor({ store: announcements, network, log });
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content,
    runtimeCache: opts.runtimeCache, log, assetIndex, views, visual, contents });
  // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
  // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  const trustedRuntime = await createTrustedRuntime({ registry: packs, log });
  lobby.trustedRuntime = trustedRuntime;
  // A persisted owner limit overrides the programmatic/env fallback. A null setting means the
  // default unlimited limiter, while keeping tests and embedders' explicit opts usable.
  const fallbackAssetCacheLimits = opts.assetCacheLimits;
  const initialAssetCacheLimits = serverSettings.get().assetCacheLimits ?? fallbackAssetCacheLimits ?? undefined;
  const assetCache = createAssetCacheHandler({ publicDir, dataDir, log, limits: initialAssetCacheLimits, trustProxy: opts.trustProxy,
    buildCatalog: opts.assetCacheBuildCatalog, requireAssetCache: () => serverSettings.get().requireAssetCache });
  let warmingAssetSummary = null;
  function warmAssetSummary() {
    if (!warmingAssetSummary) warmingAssetSummary = assetCache.summary()
      .catch((error) => { log.warn('[asset-cache] admission summary unavailable', error.message); })
      .finally(() => { warmingAssetSummary = null; });
    return warmingAssetSummary;
  }
  let bandwidthEmergency = null;
  function applySettings(next) {
    lobby.setAiLimit(next.maxAiPerRoom);
    lobby.setAssetCachePolicy({ required: next.requireAssetCache, getSummary: assetCache.currentSummary });
    assetCache.setLimits(next.assetCacheLimits ?? fallbackAssetCacheLimits);
    // A persisted owner setting overrides the startup/env fallback and is applied by the
    // existing private settings poll; an absent field keeps the normal emergency option.
    bandwidthEmergency?.setEnabled(next.bandwidthEmergencyEnabled ?? emergencyOptions.enabled);
    // Runtime enabling fails closed until a summary is ready; ordinary optional startup stays lazy.
    if (next.requireAssetCache && !assetCache.currentSummary()) void warmAssetSummary();
  }
  applySettings(serverSettings.get());
  if (serverSettings.get().requireAssetCache) await warmAssetSummary();
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const traffic = createTrafficCounter();
  let requestHandler;
  const bandwidthEmergencyEnabled = serverSettings.get().bandwidthEmergencyEnabled ?? emergencyOptions.enabled;
  bandwidthEmergency = createBandwidthEmergencyController({
    ...(opts.bandwidthEmergency || {}), ...emergencyOptions, enabled: bandwidthEmergencyEnabled,
    getMetrics: () => assetCache.metrics(), getCongestion: () => network.congestion(),
    canResume: () => [...lobby.rooms.values()].every((room) => !room.match || room.activeHumans().some((seat) => seat.connected)),
    log,
    onChange: (state) => {
      if (state.active) {
        assetCache.trip(state.reason);
        requestHandler?.abortPublicRequests();
        // `finish` only means handed to TCP, not delivered. Close ordinary HTTP sockets too,
        // including finished keep-alive transfers; Node deliberately excludes upgraded WebSockets.
        server.closeAllConnections?.();
      } else assetCache.resume();
      network.setEmergency(state);
      lobby.setEmergency(state);
      log.warn(`[bandwidth-emergency] ${state.active ? state.action === 'retry-delayed'
        ? '现有对局仍未具备恢复条件，继续保护' : '保护开启，下载和新访问已切断，对局冻结'
        : '尝试恢复访问和对局'} (${state.reason || 'recovery'})`);
    },
  });
  requestHandler = createRequestHandler({ serveStatic, announcements, assetCache,
    emergency: () => network.emergency, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir),
    health: { startedAt, network, registry, lobby, content, bandwidthEmergency, traffic, assetIndex, views, trusted: trustedRuntime?.health },
    log, trustProxy: network.opts.trustProxy, studio, trustedRuntime });
  const server = http.createServer(requestHandler);
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, traffic });
  // Prime before accepting connections; only commands submitted to a running server are broadcast.
  announcementNotices.start();
  serverSettings.start();

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    bandwidthEmergency.close();
    serverSettings.close();
    assetCache.close();
    announcementNotices.close();
    network.close(); // stop heartbeat/sweep timers of the half-built server
    assetIndex?.close();
    studio?.close();
    await trustedRuntime?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  bandwidthEmergency.start();
  assetIndex?.start();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      bandwidthEmergency.close();
      serverSettings.close();
      assetCache.close();
      announcementNotices.close();
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      network.close();
      assetIndex?.close();
      studio?.close();
      await trustedRuntime?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, announcements, serverSettings,
    bandwidthEmergency, content, visual, contents, hosts, traffic, assetIndex, views, studio, close };
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
