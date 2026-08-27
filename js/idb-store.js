/**
 * A tiny async-loaded, sync-thereafter key/value store backed by
 * IndexedDB — replaces this app's earlier use of localStorage.
 *
 * localStorage turned out to be a bad fit specifically because this
 * app is hosted on GitHub Pages: localStorage is shared per *origin*,
 * not per site/path, so every project under the same account
 * (runbotrobot.github.io/scrabble-study, runbotrobot.github.io/some-
 * other-app, ...) draws from the exact same small (historically ~5MB)
 * quota. One app filling it starves every other app at that origin, no
 * matter how little any individual app writes — which is exactly what
 * happened here. IndexedDB's quota is a much larger, separate pool
 * (see navigator.storage.estimate()) that isn't susceptible to the
 * same collision.
 *
 * IndexedDB itself is inherently async, but this app's actual data is
 * small enough to keep entirely in memory once loaded. So: await
 * initPersistence() once, at startup, to pull everything into an
 * in-memory cache; after that, get()/set() are synchronous (reading/
 * writing the cache directly), with set() also writing through to
 * IndexedDB in the background. This keeps most of the app's code
 * synchronous, matching how it worked against localStorage before,
 * instead of threading async through every single read.
 */

const DB_NAME = 'scrabbleStudy';
const DB_VERSION = 1;
const OBJECT_STORE = 'kv';

// Keys this app used to store directly in localStorage, migrated into
// IndexedDB the first time this runs on a given browser (then removed
// from localStorage, so they stop competing for that shared quota).
// 'json' keys were JSON.stringify'd arrays; 'string' keys were plain
// strings — IndexedDB can just store either as its natural type
// directly, so no (de)serialization is needed for either going forward.
const LEGACY_LOCALSTORAGE_KEYS = {
  'scrabbleStudy.selectedWords': 'json',
  'scrabbleStudy.cards': 'json',
  'scrabbleStudy.recentlyWrong': 'json',
  'scrabbleStudy.pendingWords': 'json',
  'scrabbleStudy.syncId': 'string',
  'scrabbleStudy.lastSyncAt': 'string',
  'scrabbleStudy.streak': 'string',
};

function isQuotaExceededError(err) {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
}

/** How much of its storage quota this origin is actually using, per the
 * browser's own accounting. Unlike localStorage's own separate (and
 * unrelated) quota, this *is* the budget IndexedDB actually draws from,
 * so it's a meaningful diagnostic for a failure here. Not supported in
 * every browser; null if unavailable or it throws. */
export async function describeStorageQuota() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    return `browser reports ${mb(usage)} MB used of ${mb(quota)} MB allowed for this site`;
  } catch {
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OBJECT_STORE)) {
        req.result.createObjectStore(OBJECT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(asError(req.error, 'Failed to open IndexedDB'));
  });
}

// IndexedDB can fire an error event whose .error is null (e.g. a
// transaction aborted without an underlying request error) — never
// reject with that directly, since downstream code assumes a real
// Error/DOMException (reading .message, .quotaExceeded, etc.) and a
// null rejection reason would crash with a confusing secondary error
// instead of surfacing the original failure cleanly.
function asError(err, fallbackMessage) {
  return err || new Error(fallbackMessage);
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, 'readonly');
    const store = tx.objectStore(OBJECT_STORE);
    const entries = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        entries.push([cursor.key, cursor.value]);
        cursor.continue();
      } else {
        resolve(entries);
      }
    };
    req.onerror = () => reject(asError(req.error, 'IndexedDB read failed'));
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, 'readwrite');
    tx.objectStore(OBJECT_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB write failed'));
  });
}

/** Reads this app's old localStorage keys (if any), removing each as
 * it's read regardless of whether it parsed cleanly — a corrupt legacy
 * value is no more recoverable by leaving it in place, and leaving it
 * there just means it keeps counting against localStorage's quota for
 * no benefit. */
function migrateFromLocalStorage() {
  const entries = [];
  for (const [key, kind] of Object.entries(LEGACY_LOCALSTORAGE_KEYS)) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      continue; // localStorage itself unusable here — nothing to read
    }
    if (raw !== null) {
      if (kind === 'json') {
        try {
          entries.push([key, JSON.parse(raw)]);
        } catch {
          // corrupt value — nothing sensible to migrate
        }
      } else {
        entries.push([key, raw]);
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort cleanup only
    }
  }
  return entries;
}

let db = null;
const cache = new Map();
let loaded = false;

/** Must be awaited once, before any other function here (or in
 * store.js/sync.js/streak.js, which build on this) is called. */
export async function initPersistence() {
  if (loaded) return;
  db = await openDb();
  for (const [k, v] of await idbGetAll(db)) cache.set(k, v);

  // One-time migration: an IndexedDB store that's still completely
  // empty means this browser hasn't run this code before, so pull in
  // whatever's still sitting in localStorage from before IndexedDB was
  // used at all. Only on a genuinely empty store, so this can't ever
  // clobber real IndexedDB data with a stale localStorage copy later.
  if (cache.size === 0) {
    for (const [k, v] of migrateFromLocalStorage()) {
      cache.set(k, v);
      await idbPut(db, k, v);
    }
  }
  loaded = true;
}

function requireLoaded() {
  if (!loaded) throw new Error('IndexedDB persistence not initialized — call initPersistence() first');
}

export function get(key, fallback) {
  requireLoaded();
  return cache.has(key) ? cache.get(key) : fallback;
}

/** Updates the in-memory cache immediately — a get() for the same key
 * right after sees the new value even before the IndexedDB write below
 * finishes — then writes through to IndexedDB. Await this when the
 * caller needs to know the write actually landed (e.g. before telling
 * the user it succeeded); fire-and-forget is fine when it doesn't. */
export async function set(key, value) {
  requireLoaded();
  cache.set(key, value);
  try {
    await idbPut(db, key, value);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      const wrapped = new Error(
        "your browser is blocking storage here — this app's data is far too small to hit a normal quota on its own, so something else about this browser/device is restricting it"
      );
      wrapped.quotaExceeded = true;
      throw wrapped;
    }
    throw err;
  }
}

/** Removes a key entirely (as opposed to set()ing it to some empty
 * value) — the cache update, like set()'s, happens synchronously
 * before the IndexedDB delete, so a get() for the same key immediately
 * after (even without awaiting this) already reflects the removal. */
export async function remove(key) {
  requireLoaded();
  cache.delete(key);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, 'readwrite');
    tx.objectStore(OBJECT_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB delete failed'));
  });
}
