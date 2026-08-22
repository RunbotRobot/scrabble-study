/**
 * Cloud backup / cross-device sync, backed by a small Cloudflare Worker +
 * D1 database (see worker/). This is a durability layer on top of
 * js/store.js, which remains the fast, always-available local source of
 * truth — every read/write in the app goes through localStorage first
 * and keeps working with no network at all. Sync just means "also push
 * local changes to the cloud, and pull down anything that happened
 * elsewhere," on a best-effort basis, so that losing or wiping this
 * device doesn't lose the study history.
 *
 * There's no account system: a "sync ID" is a random unguessable token
 * generated on-device. Knowing it is the credential — like a share link.
 * Set the same sync ID on another device to pull the same data down.
 */

import { getChangedSince, mergeRemote } from './store.js';

// Filled in after the first deploy (see worker/wrangler.toml for the
// worker name; the URL is <name>.<your-cloudflare-subdomain>.workers.dev).
// Until then, sync fails closed with a clear status message — the app
// stays fully usable locally regardless.
const WORKER_URL = 'https://REPLACE-ME.workers.dev';

const KEY_SYNC_ID = 'scrabbleStudy.syncId';
const KEY_LAST_SYNC_AT = 'scrabbleStudy.lastSyncAt';
const MAX_ROWS_PER_REQUEST = 300;
const SYNC_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

let status = { state: 'idle', lastSyncAt: getLastSyncAt(), lastError: null };
const listeners = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function onStatusChange(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function getStatus() {
  return status;
}

export function getSyncId() {
  return localStorage.getItem(KEY_SYNC_ID) || null;
}

function getLastSyncAt() {
  return localStorage.getItem(KEY_LAST_SYNC_AT) || null;
}

function setLastSyncAt(iso) {
  localStorage.setItem(KEY_LAST_SYNC_AT, iso);
}

export function generateSyncId() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function isValidSyncId(id) {
  return SYNC_ID_RE.test(id);
}

/** Adopts a sync ID (new or an existing one from another device) and
 * kicks off an immediate full sync. */
export function setSyncId(id) {
  if (!isValidSyncId(id)) throw new Error('Invalid sync ID');
  localStorage.setItem(KEY_SYNC_ID, id);
  localStorage.removeItem(KEY_LAST_SYNC_AT);
  setStatus({ lastSyncAt: null, lastError: null });
  return runSync();
}

/** Forgets sync on this device only. Does not delete anything in the
 * cloud — setting the same ID again (here or elsewhere) picks it back
 * up. */
export function forgetSyncId() {
  localStorage.removeItem(KEY_SYNC_ID);
  localStorage.removeItem(KEY_LAST_SYNC_AT);
  setStatus({ state: 'idle', lastSyncAt: null, lastError: null });
}

function chunkPushes(selectedWords, cards, maxPerRequest) {
  if (selectedWords.length === 0 && cards.length === 0) {
    return [{ selectedWords: [], cards: [] }];
  }
  const chunks = [];
  let i = 0;
  let j = 0;
  while (i < selectedWords.length || j < cards.length) {
    const swChunk = selectedWords.slice(i, i + maxPerRequest);
    i += swChunk.length;
    const remaining = maxPerRequest - swChunk.length;
    const cardChunk = remaining > 0 ? cards.slice(j, j + remaining) : [];
    j += cardChunk.length;
    chunks.push({ selectedWords: swChunk, cards: cardChunk });
  }
  return chunks;
}

let inFlight = null;

/** Pushes local changes since the last successful sync and pulls down
 * anything new from the cloud, merging with last-write-wins. Safe to
 * call anytime (no-ops with no sync ID configured); safe to call
 * concurrently (callers share the same in-flight promise); safe to
 * retry after a failure (nothing is marked synced until the whole round
 * completes, so a retry just redoes idempotent work). */
export function runSync() {
  if (inFlight) return inFlight;

  const syncId = getSyncId();
  if (!syncId) return Promise.resolve({ ok: false, reason: 'no-sync-id' });

  inFlight = (async () => {
    setStatus({ state: 'syncing', lastError: null });
    const since = getLastSyncAt();
    const { selectedWords, cards } = getChangedSince(since);
    const chunks = chunkPushes(selectedWords, cards, MAX_ROWS_PER_REQUEST);

    let serverTime = null;
    try {
      for (const chunk of chunks) {
        const res = await fetchWithTimeout(`${WORKER_URL}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sync-Id': syncId },
          body: JSON.stringify({ since, ...chunk }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Sync failed: ${res.status} ${body}`);
        }
        const data = await res.json();
        mergeRemote(data);
        serverTime = data.serverTime;
      }
      setLastSyncAt(serverTime);
      setStatus({ state: 'idle', lastSyncAt: serverTime, lastError: null });
      return { ok: true };
    } catch (err) {
      const message = err.name === 'AbortError' ? 'Request timed out' : err.message;
      setStatus({ state: 'error', lastError: message });
      return { ok: false, reason: 'error', error: err };
    }
  })();

  inFlight.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let debounceTimer = null;

/** Schedules a sync a couple seconds out, coalescing bursts of
 * mutations (e.g. answering several cards in a row) into one round
 * trip. */
export function scheduleSync(delayMs = 2000) {
  if (!getSyncId()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSync, delayMs);
}

/** Wires up background sync: on load, periodically, when the tab
 * regains focus/connectivity. Call once at startup. */
export function startBackgroundSync({ intervalMs = 60000 } = {}) {
  if (!getSyncId()) return;
  runSync();
  setInterval(runSync, intervalMs);
  window.addEventListener('online', runSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runSync();
  });
}
