// server/studio/paths.js — the plugin studio's URLs (DESIGN §32.9), on their own so that the static file server
// (server/http/static.js) can refuse them without loading the studio.

/** The page. */
export const STUDIO_URL = '/studio/';
/** The API. */
export const STUDIO_API = '/studio/api/';

/**
 * Whether a raw request path is the studio's, in any spelling a static file server would map to public/studio/ — another
 * case (/Studio/), doubled slashes (//studio/), percent-encoding (/%73tudio/), a letter that folds to one of "studio"
 * (/ſtudio/: the long s upper-cases to S): the studio answers them all (its gate first; any spelling but the exact one is
 * a 404), so its page never reaches anyone through the static mounts. The static server also compares the real path of a
 * file it would serve with public/studio/ (what a file system folds that no spelling rule foresees).
 * @param {string} rawPath
 */
export function isStudioPath(rawPath) {
  let p;
  try { p = decodeURIComponent(String(rawPath)); } catch { return false; }
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').normalize('NFKC').toUpperCase().toLowerCase();
  return p === '/studio' || p.startsWith('/studio/');
}
