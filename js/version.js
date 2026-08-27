/**
 * Lets the running page know whether it's actually the latest deployed
 * code — useful on its own (shown in the Options panel so you can
 * confirm what you're running), and as the basis for detecting a stale
 * tab: comparing what was loaded at startup against a fresh,
 * cache-bypassing fetch catches a deploy that happened after this page
 * loaded, even one the browser's own HTTP cache would otherwise have
 * hidden from a plain reload (see sw.js).
 *
 * version.json is bumped by hand on every deploy that changes
 * client-visible behavior — there's no build step to generate it
 * automatically from e.g. the git commit.
 */

const VERSION_URL = 'version.json';

/** The deployed version, or null if it couldn't be determined.
 * `bypassCache: true` forces an actual network round-trip (skips both
 * the browser's HTTP cache and the service worker's cache-first/
 * network-first distinction) — use that for checking whether a *newer*
 * version now exists, not for the page's own startup version (which
 * should reflect whatever it was actually served, consistent with
 * every other shell asset it loaded at the same time). */
export async function fetchVersion({ bypassCache = false } = {}) {
  try {
    const res = await fetch(VERSION_URL, bypassCache ? { cache: 'no-store' } : {});
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}
