/**
 * Cloudflare Worker: sync backend for the Scrabble Study app.
 *
 * Single endpoint, POST /sync. The client identifies itself with an
 * unguessable "sync ID" (a random token it generates locally — there's no
 * separate password/account) sent as the X-Sync-Id header, which
 * partitions all rows in D1. Knowledge of the sync ID *is* the
 * credential, the same way a share-link token or API key works.
 *
 * Request body:
 *   { since: string|null, selectedWords: Row[], cards: Row[], pendingWords: Row[] }
 * `since` is the ISO timestamp of the last successful sync (or null for a
 * brand new device pulling everything down). `selectedWords`/`cards`/
 * `pendingWords` are locally-changed rows to push up (can be empty).
 *
 * Response body:
 *   { serverTime: string, selectedWords: Row[], cards: Row[], pendingWords: Row[] }
 * `serverTime` becomes the client's new `since` cursor. The returned rows
 * are everything changed (by any device) after `since`, INCLUDING rows
 * this same request just pushed — the client applies them the same way
 * either way (last-write-wins by updated_at), so that's harmless.
 *
 * Conflict resolution is last-write-wins per row, compared by
 * `updated_at`: an incoming row only overwrites a stored one if its
 * updated_at is strictly newer. Rows are never actually deleted from D1 —
 * a card is "removed" by setting its `deleted` flag to 1 (with a fresh
 * updated_at), which syncs like any other change. The client filters
 * deleted cards out of everything it shows, but keeps the tombstone
 * around locally so last-write-wins still has something to compare
 * against if an older, non-deleted version of that row shows up later.
 */

const SYNC_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ROWS_PER_PUSH = 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Id',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function validateSelectedWord(row) {
  return (
    row &&
    isNonEmptyString(row.root_word) &&
    isNonEmptyString(row.via_word) &&
    isNonEmptyString(row.selected_at) &&
    isNonEmptyString(row.updated_at)
  );
}

function validateCard(row) {
  return (
    row &&
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.root_word) &&
    isNonEmptyString(row.type) &&
    isNonEmptyString(row.prompt) &&
    isNonEmptyString(row.answer) &&
    typeof row.interval_days === 'number' &&
    typeof row.ease === 'number' &&
    typeof row.reps === 'number' &&
    typeof row.lapses === 'number' &&
    isNonEmptyString(row.due_at) &&
    (row.last_reviewed_at === null || isNonEmptyString(row.last_reviewed_at)) &&
    isNonEmptyString(row.created_at) &&
    isNonEmptyString(row.updated_at) &&
    (row.phase === 'intro' || row.phase === 'review') &&
    (row.deleted === 0 || row.deleted === 1)
  );
}

function validatePendingWord(row) {
  return (
    row &&
    isNonEmptyString(row.word) &&
    isNonEmptyString(row.added_at) &&
    isNonEmptyString(row.updated_at) &&
    (row.deleted === 0 || row.deleted === 1)
  );
}

async function handleSync(request, env) {
  const syncId = request.headers.get('X-Sync-Id') || '';
  if (!SYNC_ID_RE.test(syncId)) {
    return json({ error: 'Missing or invalid X-Sync-Id header' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const since = typeof body.since === 'string' ? body.since : null;
  const selectedWords = Array.isArray(body.selectedWords) ? body.selectedWords : [];
  const cards = Array.isArray(body.cards) ? body.cards : [];
  const pendingWords = Array.isArray(body.pendingWords) ? body.pendingWords : [];

  if (
    selectedWords.length > MAX_ROWS_PER_PUSH ||
    cards.length > MAX_ROWS_PER_PUSH ||
    pendingWords.length > MAX_ROWS_PER_PUSH
  ) {
    return json({ error: `Too many rows in one push (max ${MAX_ROWS_PER_PUSH} each)` }, 400);
  }
  if (
    !selectedWords.every(validateSelectedWord) ||
    !cards.every(validateCard) ||
    !pendingWords.every(validatePendingWord)
  ) {
    return json({ error: 'Malformed row in selectedWords, cards, or pendingWords' }, 400);
  }

  const statements = [];

  for (const row of selectedWords) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO selected_words (sync_id, root_word, via_word, selected_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sync_id, root_word) DO UPDATE SET
           via_word = excluded.via_word,
           selected_at = excluded.selected_at,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > selected_words.updated_at`
      ).bind(syncId, row.root_word, row.via_word, row.selected_at, row.updated_at)
    );
  }

  for (const row of cards) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO cards (sync_id, id, root_word, type, prompt, answer, interval_days, ease, reps, lapses, due_at, last_reviewed_at, created_at, updated_at, phase, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sync_id, id) DO UPDATE SET
           interval_days = excluded.interval_days,
           ease = excluded.ease,
           reps = excluded.reps,
           lapses = excluded.lapses,
           due_at = excluded.due_at,
           last_reviewed_at = excluded.last_reviewed_at,
           updated_at = excluded.updated_at,
           phase = excluded.phase,
           deleted = excluded.deleted
         WHERE excluded.updated_at > cards.updated_at`
      ).bind(
        syncId,
        row.id,
        row.root_word,
        row.type,
        row.prompt,
        row.answer,
        row.interval_days,
        row.ease,
        row.reps,
        row.lapses,
        row.due_at,
        row.last_reviewed_at,
        row.created_at,
        row.updated_at,
        row.phase,
        row.deleted
      )
    );
  }

  for (const row of pendingWords) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO pending_words (sync_id, word, added_at, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sync_id, word) DO UPDATE SET
           added_at = excluded.added_at,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted
         WHERE excluded.updated_at > pending_words.updated_at`
      ).bind(syncId, row.word, row.added_at, row.updated_at, row.deleted)
    );
  }

  // Timestamp taken before writes so nothing landing concurrently between
  // here and the SELECTs below is silently skipped on the next sync.
  const serverTime = new Date().toISOString();

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  const changedSelected = since
    ? await env.DB.prepare('SELECT * FROM selected_words WHERE sync_id = ? AND updated_at > ?')
        .bind(syncId, since)
        .all()
    : await env.DB.prepare('SELECT * FROM selected_words WHERE sync_id = ?').bind(syncId).all();

  const changedCards = since
    ? await env.DB.prepare('SELECT * FROM cards WHERE sync_id = ? AND updated_at > ?').bind(syncId, since).all()
    : await env.DB.prepare('SELECT * FROM cards WHERE sync_id = ?').bind(syncId).all();

  const changedPending = since
    ? await env.DB.prepare('SELECT * FROM pending_words WHERE sync_id = ? AND updated_at > ?').bind(syncId, since).all()
    : await env.DB.prepare('SELECT * FROM pending_words WHERE sync_id = ?').bind(syncId).all();

  return json({
    serverTime,
    selectedWords: changedSelected.results.map(({ sync_id, ...rest }) => rest),
    cards: changedCards.results.map(({ sync_id, ...rest }) => rest),
    pendingWords: changedPending.results.map(({ sync_id, ...rest }) => rest),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/sync' && request.method === 'POST') {
      try {
        return await handleSync(request, env);
      } catch (err) {
        return json({ error: `Internal error: ${err.message}` }, 500);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
