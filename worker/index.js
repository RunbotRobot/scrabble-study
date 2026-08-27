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
 *
 * Second endpoint, GET /image/:word[?prompt=...]. Images are shared,
 * global assets keyed only by word (not per sync ID — "a crown of
 * flowers" for HAKU is the same picture for everyone). On a cache miss,
 * generates one via Pollinations.ai (free, keyless) using `prompt` (the
 * word's definition, supplied by the client) and stores it in R2 before
 * returning it, so every word is generated at most once, ever. If
 * Pollinations fails (e.g. rate-limited during a large batch), falls
 * back to the Gemini API's free tier — only when the GEMINI_API_KEY
 * secret is configured; otherwise this fallback is silently skipped and
 * Pollinations remains the only generator, exactly as before.
 */

const SYNC_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const WORD_RE = /^[A-Z]+$/;
const MAX_ROWS_PER_PUSH = 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    (row.phase === 'intro' || row.phase === 'review' || row.phase === 'held') &&
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

const IMAGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  ...CORS_HEADERS,
};

/** Free, keyless, always tried first. Returns null (never throws) on any
 * failure so the caller can fall through to generateWithGemini. */
async function generateWithPollinations(prompt) {
  try {
    const genUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
    const res = await fetch(genUrl);
    if (!res.ok) return null;
    return { bytes: await res.arrayBuffer(), contentType: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Fallback for when Pollinations is rate-limited — a second free-tier
 * quota to draw on, e.g. during a 50-word batch that outpaces
 * Pollinations alone. Only attempted when env.GEMINI_API_KEY is
 * configured (a Cloudflare Worker secret — see README); returns null
 * (never throws) on any failure, including an unset key, so it's always
 * safe to call. */
async function generateWithGemini(prompt, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-lite-image',
        input: [{ type: 'text', text: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const image = data.output_image;
    if (!image || !image.data) return null;
    const binary = atob(image.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes: bytes.buffer, contentType: image.mime_type || 'image/png' };
  } catch {
    return null;
  }
}

async function handleImage(request, env, word) {
  if (!WORD_RE.test(word)) {
    return json({ error: 'Invalid word' }, 400);
  }
  const key = `${word}.jpg`;

  const existing = await env.IMAGES.get(key);
  if (existing) {
    const contentType = existing.httpMetadata?.contentType || 'image/jpeg';
    return new Response(existing.body, { headers: { 'Content-Type': contentType, ...IMAGE_CACHE_HEADERS } });
  }

  const prompt = new URL(request.url).searchParams.get('prompt') || word;
  const generated =
    (await generateWithPollinations(prompt)) || (await generateWithGemini(prompt, env.GEMINI_API_KEY));
  if (!generated) {
    return json({ error: 'Image generation failed (all providers)' }, 502);
  }
  await env.IMAGES.put(key, generated.bytes, { httpMetadata: { contentType: generated.contentType } });
  return new Response(generated.bytes, { headers: { 'Content-Type': generated.contentType, ...IMAGE_CACHE_HEADERS } });
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

    const imageMatch = url.pathname.match(/^\/image\/([^/]+)$/);
    if (imageMatch && request.method === 'GET') {
      try {
        return await handleImage(request, env, decodeURIComponent(imageMatch[1]));
      } catch (err) {
        return json({ error: `Internal error: ${err.message}` }, 500);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
