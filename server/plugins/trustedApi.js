// Shared rules of the experimental trusted IPC bridge (DESIGN §32.10).
// [ASSUMED] A plugin's health extension is at most 16 KiB of serialized UTF-8 JSON.
export const TRUSTED_HEALTH_BYTES = 16 * 1024;
export function trustedRouteAllowed(id, route) {
  return typeof id === 'string' && typeof route === 'string' && route.startsWith(`/x/${id}/`)
    && !/\.\.|%2e|%5c|[\\?#\x00-\x20\x7f]/i.test(route);
}
export function healthJson(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > TRUSTED_HEALTH_BYTES)
    throw new Error(`health extension must be JSON of at most ${TRUSTED_HEALTH_BYTES} bytes`);
  return JSON.parse(json);
}
