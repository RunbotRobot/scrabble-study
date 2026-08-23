/**
 * Persists study state (selected root words + flashcards + SRS progress)
 * in this browser's localStorage, which is always the fast/offline
 * source of truth for the UI. js/sync.js layers cloud backup/cross-device
 * sync on top of this — see there for how remote merges happen.
 */

import { pickRandomWord, resolveRoots, wordExists, wordCount } from './dictionary.js';
import { buildCardSpecs } from './cards.js';
import { initialState, schedule, DEFAULT_EASE } from './srs.js';

const KEY_SELECTED = 'scrabbleStudy.selectedWords';
const KEY_CARDS = 'scrabbleStudy.cards';
const KEY_RECENTLY_WRONG = 'scrabbleStudy.recentlyWrong';
const KEY_PENDING_WORDS = 'scrabbleStudy.pendingWords';

const MAX_PICK_ATTEMPTS = 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** New cards graduate out of the intensive "intro" rotation once they've
 * been answered correctly this many times (matches the SM-2 scheduler's
 * own first two learning steps — see js/srs.js). */
const INTRO_GRADUATION_REPS = 2;

/** Once this many distinct review-phase cards are sitting in the
 * "recently missed" pile at once, they all go back into intensive intro
 * drilling together — see answerCard. */
const MISTAKE_BATCH_SIZE = 50;

function load(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSelected() {
  return load(KEY_SELECTED, []);
}

function getCards() {
  // Defensive defaults for cards persisted before `phase`/`deleted` existed.
  return load(KEY_CARDS, []).map((c) => ({
    ...c,
    phase: c.phase || 'review',
    deleted: c.deleted || 0,
  }));
}

function getRecentlyWrong() {
  return load(KEY_RECENTLY_WRONG, []);
}

function getAllPendingWords() {
  return load(KEY_PENDING_WORDS, []);
}

/** Queued words, oldest-first — the order generateIntroBatch will
 * consume them in. */
export function getPendingWords() {
  return getAllPendingWords()
    .filter((p) => !p.deleted)
    .sort((a, b) => (a.added_at < b.added_at ? -1 : a.added_at > b.added_at ? 1 : 0));
}

/** Queues a word to be resolved to its root(s) and added — ahead of any
 * random picks — the next time a batch is generated (a streak milestone,
 * a mistake batch, or the empty-state bootstrap). Validates against the
 * dictionary immediately so a typo is caught right away rather than
 * silently going nowhere later. */
export function queueWord(rawWord) {
  const word = (rawWord || '').trim().toUpperCase();
  if (!word) return { ok: false, message: 'Enter a word.' };
  if (!/^[A-Z]+$/.test(word)) return { ok: false, message: 'Letters only.' };
  if (!wordExists(word)) return { ok: false, message: `"${word}" isn't in the Scrabble dictionary.` };

  const selectedSet = new Set(getSelected().map((s) => s.root_word));
  const roots = resolveRoots(word);
  if (roots.every((r) => selectedSet.has(r))) {
    return { ok: false, message: `${word} is already in your deck.` };
  }

  const pending = getAllPendingWords();
  if (pending.some((p) => p.word === word && !p.deleted)) {
    return { ok: false, message: `${word} is already queued.` };
  }

  const nowIso = new Date().toISOString();
  const existingTombstone = pending.find((p) => p.word === word);
  if (existingTombstone) {
    existingTombstone.deleted = 0;
    existingTombstone.added_at = nowIso;
    existingTombstone.updated_at = nowIso;
  } else {
    pending.push({ word, added_at: nowIso, updated_at: nowIso, deleted: 0 });
  }
  save(KEY_PENDING_WORDS, pending);
  return { ok: true, word };
}

function consumePendingWords(words, nowIso) {
  if (words.length === 0) return;
  const consumed = new Set(words);
  const all = getAllPendingWords();
  for (const p of all) {
    if (consumed.has(p.word) && !p.deleted) {
      p.deleted = 1;
      p.updated_at = nowIso;
    }
  }
  save(KEY_PENDING_WORDS, all);
}

/** A card's identity is fully determined by what it's made of (root word,
 * kind, and prompt), not by when/where it was created — so two devices
 * that independently build "the same" card always agree on its id. This
 * is what makes cross-device sync merge cleanly without coordination. */
function cardId(type, rootWord, prompt) {
  return [type, rootWord, prompt].join('␟');
}

function addRootToStudy(rootWord, viaWord, now, phase, selected, cards) {
  const specs = buildCardSpecs(rootWord);
  if (!specs) return 0;

  const nowIso = now.toISOString();
  selected.push({ root_word: rootWord, via_word: viaWord, selected_at: nowIso, updated_at: nowIso });

  const base = initialState(now);
  for (const spec of specs) {
    cards.push({
      id: cardId(spec.type, rootWord, spec.prompt),
      root_word: rootWord,
      type: spec.type,
      prompt: spec.prompt,
      answer: spec.answer,
      interval_days: base.interval_days,
      ease: base.ease,
      reps: base.reps,
      lapses: base.lapses,
      due_at: base.due_at,
      last_reviewed_at: base.last_reviewed_at,
      created_at: nowIso,
      updated_at: nowIso,
      phase,
      deleted: 0,
    });
  }
  return specs.length;
}

/** Picks a uniformly-random word from the whole dictionary that still
 * resolves to at least one not-yet-studied root. Returns null if the
 * dictionary is exhausted of new words. */
function pickRandomNewWord(selectedSet) {
  for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
    const word = pickRandomWord();
    const roots = resolveRoots(word);
    if (roots.some((r) => !selectedSet.has(r))) return word;
  }
  return null;
}

/** Resolves `word` to its root(s), and adds any not-yet-studied root(s)
 * — with their flashcards — to `selected`/`cards` (mutated in place).
 * Returns how many cards and roots were newly added (both 0 if every
 * root `word` resolves to was already studied). */
function addWordToStudy(word, now, phase, selected, selectedSet, cards) {
  const roots = resolveRoots(word);
  const newRoots = roots.filter((r) => !selectedSet.has(r));
  let cardsAdded = 0;
  for (const root of newRoots) {
    cardsAdded += addRootToStudy(root, word, now, phase, selected, cards);
    selectedSet.add(root);
  }
  return { newRoots, cardsAdded };
}

/** Generates a fresh batch of at least `minCards` new flashcards (tagged
 * for intensive "intro" drilling — see getNextCard). Words you've
 * explicitly queued (see queueWord) are used first, oldest-queued first,
 * ahead of random picks — only once the queue is empty does it fall back
 * to picking randomly. Since a single root can produce several cards,
 * `minCards` is a floor, not a ceiling: the batch always finishes out
 * the root/word it's partway through rather than cutting it off mid-way. */
export function generateIntroBatch(minCards = 50) {
  const now = new Date();
  const nowIso = now.toISOString();
  const selected = getSelected();
  const selectedSet = new Set(selected.map((s) => s.root_word));
  const cards = getCards();
  const pending = getPendingWords();

  let cardsAdded = 0;
  let wordsAdded = 0;
  const roots = [];
  let pendingIndex = 0;
  const consumedPendingWords = [];

  while (cardsAdded < minCards) {
    let word;
    if (pendingIndex < pending.length) {
      word = pending[pendingIndex].word;
      consumedPendingWords.push(word);
      pendingIndex++;
    } else {
      word = pickRandomNewWord(selectedSet);
      if (word === null) break; // dictionary exhausted of unstudied words
    }

    const result = addWordToStudy(word, now, 'intro', selected, selectedSet, cards);
    cardsAdded += result.cardsAdded;
    wordsAdded += result.newRoots.length;
    roots.push(...result.newRoots);
  }

  consumePendingWords(consumedPendingWords, nowIso);
  save(KEY_SELECTED, selected);
  save(KEY_CARDS, cards);
  return { ok: cardsAdded > 0, cardsAdded, wordsAdded, roots };
}

/** How urgently a graduated ("review"-phase) card needs quizzing again,
 * higher = more urgent. Two things drive it, both continuous rather than
 * a due/not-due cutoff — so there's always a next-most-useful card to
 * show instead of ever running dry with cards left to study:
 *   - how overdue it is, as a fraction of its own interval (a 1-day-old
 *     card two days late is more urgent than a 30-day-old card two days
 *     late — same raw lateness, very different relative staleness)
 *   - how much harder than average it's been recently (its `ease` has
 *     already fallen from getting missed, or risen from streaks of
 *     correct answers — SM-2's own running difficulty signal)
 */
function reviewPriority(card, nowMs) {
  const dueAtMs = new Date(card.due_at).getTime();
  const intervalMs = Math.max(card.interval_days, 1) * ONE_DAY_MS;
  const overdueRatio = (nowMs - dueAtMs) / intervalMs;
  const difficulty = DEFAULT_EASE - card.ease;
  return overdueRatio + difficulty;
}

/** The card to show next: any card still in its intensive "intro"
 * rotation takes priority over everything else (least-recently-shown
 * first), regardless of due date — that's what makes it intensive. Once
 * there are no intro cards left, the highest-priority graduated card is
 * shown (see reviewPriority) — there's no due-date gate, so this only
 * comes back empty if there are truly no cards at all. */
export function getNextCard() {
  const cards = getCards().filter((c) => !c.deleted);

  const intro = cards.filter((c) => c.phase === 'intro');
  if (intro.length > 0) {
    // Least-recently-reviewed first (nulls — never reviewed — sort
    // first), but pick uniformly at random *among* whichever cards tie
    // for that spot. Within a freshly-generated batch every card ties
    // (all null), so without this a word->definition card and its
    // definition->word twin — built back to back, so otherwise
    // identical on every tiebreak — would always land adjacent, making
    // the second one trivial since you'd have just seen the first.
    let oldest = null;
    for (const c of intro) {
      const key = c.last_reviewed_at || '';
      if (oldest === null || key < oldest) oldest = key;
    }
    const candidates = intro.filter((c) => (c.last_reviewed_at || '') === oldest);
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    return { card, introRemaining: intro.length };
  }

  const reviewPool = cards.filter((c) => c.phase === 'review');
  if (reviewPool.length === 0) return { card: null, introRemaining: 0 };

  const nowMs = Date.now();
  return { card: pickWeightedByPriority(reviewPool, nowMs), introRemaining: 0 };
}

/** Picks one card at random, weighted toward higher priority — as
 * opposed to always the single highest. Two cards a hair's-breadth apart
 * in priority are (correctly) close to equally likely to be picked; a
 * card that's clearly way more urgent is picked far more often, but a
 * calmer card is never fully locked out.
 *
 * Picking strictly the max every time turned out to starve whole card
 * types: freshly-graduated cards mostly tie near the same priority (they
 * were all just reviewed together, so "how overdue" hasn't diverged
 * yet), so the ranking comes down to tiny `ease` differences — and once
 * *some* type has taken a few early misses, its slightly lower ease
 * means it wins that comparison forever, while a type you're doing
 * fine on (never below the max) never gets picked again at all. */
function pickWeightedByPriority(pool, nowMs) {
  const priorities = pool.map((c) => reviewPriority(c, nowMs));
  const maxPriority = Math.max(...priorities);
  // exp(priority - max): the top card gets weight 1; others fall off
  // smoothly the further behind they are, but nothing hits exactly zero.
  const weights = priorities.map((p) => Math.exp(p - maxPriority));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Grades a card and updates its SRS state. Also maintains the rolling
 * "recently missed" pile: a miss on *any* card (whether it's still in
 * intro drilling or already graduated) adds it, a subsequent correct
 * answer removes it again, and once the pile reaches MISTAKE_BATCH_SIZE
 * distinct cards they're all sent back into intensive intro drilling
 * together (same mechanism as a fresh batch of new words) and the pile
 * resets. Re-flagging a card that's already mid-intro is harmless — it
 * just resets its rep count, asking for two more correct answers before
 * it graduates instead of however many it needed before. Returns the
 * updated card and, when the batch just triggered, { cardCount }. */
export function answerCard(id, correct) {
  const cards = getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  const now = new Date();
  const nowIso = now.toISOString();

  const next = schedule(
    { interval_days: card.interval_days, ease: card.ease, reps: card.reps, lapses: card.lapses },
    correct,
    now
  );
  Object.assign(card, next, { updated_at: nowIso });
  if (card.phase === 'intro' && card.reps >= INTRO_GRADUATION_REPS) {
    card.phase = 'review';
  }

  let mistakeBatch = null;
  let recentlyWrong = getRecentlyWrong();
  if (correct) {
    recentlyWrong = recentlyWrong.filter((x) => x !== id);
  } else if (!recentlyWrong.includes(id)) {
    recentlyWrong = [...recentlyWrong, id];
  }
  if (recentlyWrong.length >= MISTAKE_BATCH_SIZE) {
    let cardCount = 0;
    for (const wrongId of recentlyWrong) {
      const c = cards.find((x) => x.id === wrongId);
      if (!c) continue;
      c.phase = 'intro';
      c.reps = 0;
      c.updated_at = nowIso;
      cardCount++;
    }
    mistakeBatch = { cardCount };
    recentlyWrong = [];
  }
  save(KEY_RECENTLY_WRONG, recentlyWrong);

  save(KEY_CARDS, cards);
  return { card, mistakeBatch };
}

export function getStats() {
  const cards = getCards().filter((c) => !c.deleted);
  const byType = {};
  for (const c of cards) byType[c.type] = (byType[c.type] || 0) + 1;
  return {
    dictionaryWordCount: wordCount(),
    selectedRootCount: getSelected().length,
    totalCards: cards.length,
    introducing: cards.filter((c) => c.phase === 'intro').length,
    recentlyWrong: getRecentlyWrong().length,
    queuedWords: getPendingWords().length,
    cardsByType: byType,
  };
}

// --- Sync support (see js/sync.js) -----------------------------------

/** Rows changed strictly after `since` (or all rows, if `since` is
 * null/undefined) — what this device needs to push. */
export function getChangedSince(since) {
  const selected = getSelected();
  const cards = getCards();
  const pendingWords = getAllPendingWords();
  return {
    selectedWords: since ? selected.filter((r) => r.updated_at > since) : selected,
    cards: since ? cards.filter((r) => r.updated_at > since) : cards,
    pendingWords: since ? pendingWords.filter((r) => r.updated_at > since) : pendingWords,
  };
}

/** Merges rows pulled from the server into local storage. Last-write-wins
 * by `updated_at`, keyed by each table's natural identity — so applying
 * the same remote rows twice (e.g. after a retried push) is always safe. */
export function mergeRemote({ selectedWords = [], cards = [], pendingWords = [] }) {
  const selected = getSelected();
  const selectedByKey = new Map(selected.map((r) => [r.root_word, r]));
  for (const remote of selectedWords) {
    const existing = selectedByKey.get(remote.root_word);
    if (!existing || remote.updated_at > existing.updated_at) {
      selectedByKey.set(remote.root_word, remote);
    }
  }
  save(KEY_SELECTED, [...selectedByKey.values()]);

  const localCards = getCards();
  const cardsByKey = new Map(localCards.map((r) => [r.id, r]));
  for (const remote of cards) {
    const existing = cardsByKey.get(remote.id);
    if (!existing || remote.updated_at > existing.updated_at) {
      cardsByKey.set(remote.id, remote);
    }
  }
  save(KEY_CARDS, [...cardsByKey.values()]);

  const localPending = getAllPendingWords();
  const pendingByKey = new Map(localPending.map((r) => [r.word, r]));
  for (const remote of pendingWords) {
    const existing = pendingByKey.get(remote.word);
    if (!existing || remote.updated_at > existing.updated_at) {
      pendingByKey.set(remote.word, remote);
    }
  }
  save(KEY_PENDING_WORDS, [...pendingByKey.values()]);
}
