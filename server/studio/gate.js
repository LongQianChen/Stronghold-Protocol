// server/studio/gate.js — who may use the studio (DESIGN §32.9, docs/PLUGINS.md §15): /studio/ and /studio/api/* answer a
// request from this machine or the local network only; any other gets the same 404 as a page that does not exist.
//
//   1. the client is this machine or the local network (isLocalIp, server/net.js): the socket peer AND every address any
//      forwarding header names — X-Forwarded-For (every hop), X-Real-IP, CF-Connecting-IP, True-Client-IP, X-Client-IP,
//      X-Cluster-Client-IP, Fastly-Client-IP, Forwarded's for= — is a loopback or private-network one; an address that
//      cannot be read (for=unknown) refuses too. Stricter than clientAddress, which picks one header for the limits: a
//      proxy that sets one header passes the others a visitor sent, so a header may refuse a request but never admits
//      one, whatever TRUST_PROXY says. A tunnel or proxy on this machine that names a public visitor is refused
//      (SP_STUDIO=local narrows all of it to loopback; SP_STUDIO=off switches the studio off) [ASSUMED: on for the local
//      network by default, as the 0.3.0 plan asks];
//   2. the Host the browser asked for is a local address or a local name — a loopback or private-network IP literal,
//      localhost / *.localhost, a name without a dot (a machine name), *.local, *.lan, *.home.arpa, *.internal, or a name
//      SP_STUDIO_HOSTS lists — so a web page whose own name was made to point at this machine (DNS rebinding) cannot reach
//      it, nor a browser that reaches the machine at a public address (a port forward, a tunnel's public IP) [ASSUMED];
//   3. a change (POST, PUT, DELETE) also carries the header `X-SP-Studio` — a page of another site cannot send it
//      without the browser asking first, and the studio never answers that question — and, when the browser names it,
//      comes from the studio's own origin (Origin, Sec-Fetch-Site); its value is the studio's key (server/studio/key.js,
//      checked by index.js).
// What no address check can see — a raw TCP tunnel on this machine (frp tcp, ssh -R, ngrok tcp …) hands a visitor's bytes
// over from this machine itself with no forwarding header, and a client that is not a browser writes any Host — is what
// the key is for: a change without it is refused, whatever the address.

import { isIP } from 'node:net';
import { isLocalIp, normalizeIp } from '../net.js';

/** The studio's mode from the environment: 'lan' (default), 'local' (loopback only) or 'off'. */
export function studioMode(env = process.env) {
  const v = String(env.SP_STUDIO ?? '').trim().toLowerCase();
  if (['0', 'off', 'false', 'no'].includes(v)) return 'off';
  if (['local', 'loopback'].includes(v)) return 'local';
  return 'lan';
}

/** Extra Host names the owner allows (SP_STUDIO_HOSTS, comma separated, lower case). */
export const extraHosts = (env = process.env) => String(env.SP_STUDIO_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Is `ip` (normalized) a loopback address? */
export function isLoopback(ip) {
  if (isIP(ip) === 4) return ip.startsWith('127.');
  return ip === '::1';
}

/**
 * The host name of a Host header (no port, no brackets, lower case), or null when it is none.
 * @param {unknown} host
 */
export function hostName(host) {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h || h.length > 255) return null;
  if (h.startsWith('[')) { const end = h.indexOf(']'); return end > 0 ? h.slice(1, end) : null; }
  const colon = h.lastIndexOf(':');
  const name = colon > 0 && /^\d+$/.test(h.slice(colon + 1)) ? h.slice(0, colon) : h;
  return /^[a-z0-9._-]+$/.test(name) ? name : null;
}

/**
 * Is a Host header a local one (see the header, rule 2)?
 * @param {unknown} host @param {string[]} [extra] more allowed names
 */
export function isLocalHost(host, extra = []) {
  const name = hostName(host);
  if (!name) return false;
  if (isIP(name)) return isLocalIp(normalizeIp(name) || name);
  if (extra.includes(name)) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (!name.includes('.')) return true;
  return /\.(local|lan|home\.arpa|internal)$/.test(name);
}

/** The headers a proxy names a client address in (see the header, rule 1). */
export const FORWARD_HEADERS = Object.freeze(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip',
  'x-cluster-client-ip', 'fastly-client-ip', 'forwarded']);

/**
 * Every client address the forwarding headers of a request name, normalized ('' for one that cannot be read: an unknown
 * or obfuscated name, garbage) — X-Forwarded-For's every hop, each single-address header (repeated ones too), the for=
 * of each element of Forwarded (RFC 7239).
 * @param {Record<string, string | string[] | undefined>} [headers]
 * @returns {string[]}
 */
export function forwardedAddresses(headers = {}) {
  const out = [];
  for (const name of FORWARD_HEADERS) {
    const raw = headers?.[name];
    if (raw === undefined) continue;
    for (const part of (Array.isArray(raw) ? raw : [raw]).flatMap((v) => String(v).split(','))) {
      let v = part.trim();
      if (name === 'forwarded') {
        const m = /(?:^|;)\s*for\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(v);
        if (!m) continue; // an element without for= (proto=, by=, host= only)
        v = (m[1] ?? m[2] ?? '').trim();
      }
      if (!v && name !== 'forwarded') continue; // an empty hop ("a,,b")
      out.push(normalizeIp(v));
    }
  }
  return out;
}

/**
 * May this request use the studio? `{ ok: true }` or `{ ok: false, why }` (why: for the log, never for the client).
 * @param {import('node:http').IncomingMessage} req
 * @param {{ mode?: 'lan' | 'local' | 'off', hosts?: string[] }} [opts]
 */
export function studioAllowed(req, { mode = studioMode(), hosts = extraHosts() } = {}) {
  if (mode === 'off') return { ok: false, why: 'the studio is off (SP_STUDIO=off)' };
  const allowed = mode === 'local' ? isLoopback : isLocalIp;
  const where = mode === 'local' ? 'this machine (SP_STUDIO=local)' : 'a local or private-network address';
  const peer = normalizeIp(req?.socket?.remoteAddress);
  if (!peer || !allowed(peer)) return { ok: false, why: `${peer || '?'} is not ${where}` };
  for (const ip of forwardedAddresses(req?.headers)) {
    if (!ip || !allowed(ip)) return { ok: false, why: `a forwarding header names ${ip || 'an address that cannot be read'}, not ${where}` };
  }
  if (!isLocalHost(req?.headers?.host, hosts)) return { ok: false, why: `Host ${String(req?.headers?.host ?? '').slice(0, 80)} is not a local name` };
  return { ok: true };
}

/**
 * Is a change request the studio's own (see the header, rule 3)? It carries X-SP-Studio (the key: index.js checks it), and
 * its Origin, when given, has the request's Host.
 * @param {import('node:http').IncomingMessage} req
 */
export function isStudioChange(req) {
  const h = req.headers || {};
  if (typeof h['x-sp-studio'] !== 'string' || !h['x-sp-studio']) return false;
  const site = h['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const origin = h.origin;
  if (origin === undefined) return true;
  try { return new URL(String(origin)).host.toLowerCase() === String(h.host || '').toLowerCase(); } catch { return false; }
}
