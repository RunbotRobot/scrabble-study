/**
 * Persists study state (selected root words + flashcards + SRS progress)
 * in this browser's localStorage, which is always the fast/offline
 * source of truth for the UI. js/sync.js layers cloud backup/cross-device
 * sync on top of this — see there for how remote merges happen.
 */

import { pickRandomWord, resolveRoots, wordCount } from './dictionary.js';
import { buildCardSpecs } from './cards.js';
import { initialState, schedule } from './srs.js';

const KEY_SELECTED = 'scrabbleStudy.selectedWords';
const KEY_CARDS = 'scrabbleStudy.cards';

const MAX_PICK_ATTEMPTS = 1000;

/** New cards graduate out of the intensive "intro" rotation once they've
 * been answered correctly this many times (matches the SM-2 scheduler's
 * own first two learning steps — see js/srs.js). */
const INTRO_GRADUATION_REPS = 2;

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
  // Defensive default for cards persisted before `phase` existed.
  return load(KEY_CARDS, []).map((c) => (c.phase ? c : { ...c, phase: 'review' }));
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
    });
  }
  return specs.length;
}

/** Picks a uniformly-random word from the whole dictionary (root,
 * conjugated, or plural forms all equally likely), resolves it to its
 * root(s), and adds any not-yet-studied root(s) — with their flashcards —
 * to `selected`/`cards` (mutated in place). Returns how many cards were
 * added, or 0 if the dictionary is exhausted of new words. */
function addOneNewRootBatch(now, phase, selected, selectedSet, cards) {
  for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
    const word = pickRandomWord();
    const roots = resolveRoots(word);
    const newRoots = roots.filter((r) => !selectedSet.has(r));
    if (newRoots.length === 0) continue;

    let cardsAdded = 0;
    for (const root of newRoots) {
      cardsAdded += addRootToStudy(root, word, now, phase, selected, cards);
      selectedSet.add(root);
    }
    return { pickedWord: word, roots, newRoots, cardsAdded };
  }
  return null;
}

/** Generates a fresh batch of at least `minCards` new flashcards (tagged
 * for intensive "intro" drilling — see getNextCard) by repeatedly picking
 * random words and building out their roots. Since a single root can
 * produce several cards, `minCards` is a floor, not a ceiling: the batch
 * always finishes out the root it's partway through rather than cutting
 * a root's cards off mid-way. */
export function generateIntroBatch(minCards = 50) {
  const now = new Date();
  const selected = getSelected();
  const selectedSet = new Set(selected.map((s) => s.root_word));
  const cards = getCards();

  let cardsAdded = 0;
  let wordsAdded = 0;
  const roots = [];
  while (cardsAdded < minCards) {
    const result = addOneNewRootBatch(now, 'intro', selected, selectedSet, cards);
    if (!result) break; // dictionary exhausted of unstudied words
    cardsAdded += result.cardsAdded;
    wordsAdded += result.newRoots.length;
    roots.push(...result.newRoots);
  }

  save(KEY_SELECTED, selected);
  save(KEY_CARDS, cards);
  return { ok: cardsAdded > 0, cardsAdded, wordsAdded, roots };
}

/** The card to show next: any card still in its intensive "intro"
 * rotation takes priority over everything else (least-recently-shown
 * first), regardless of due date — that's what makes it intensive. Once
 * there are no intro cards left, falls back to normal due-date-gated
 * review. */
export function getNextCard() {
  const cards = getCards();

  const intro = cards.filter((c) => c.phase === 'intro');
  if (intro.length > 0) {
    intro.sort((a, b) => {
      const av = a.last_reviewed_at || '';
      const bv = b.last_reviewed_at || '';
      if (av !== bv) return av < bv ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
    return { card: intro[0], introRemaining: intro.length };
  }

  const now = new Date().toISOString();
  const due = cards.filter((c) => c.due_at <= now).sort((a, b) => (a.due_at < b.due_at ? -1 : 1));
  if (due.length > 0) return { card: due[0], introRemaining: 0 };

  const nextDueAt = cards.reduce((min, c) => (min === null || c.due_at < min ? c.due_at : min), null);
  return { card: null, introRemaining: 0, nextDueAt };
}

export function answerCard(id, correct) {
  const cards = getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  const now = new Date();
  const next = schedule(
    { interval_days: card.interval_days, ease: card.ease, reps: card.reps, lapses: card.lapses },
    correct,
    now
  );
  Object.assign(card, next, { updated_at: now.toISOString() });
  if (card.phase === 'intro' && card.reps >= INTRO_GRADUATION_REPS) {
    card.phase = 'review';
  }
  save(KEY_CARDS, cards);
  return card;
}

export function getStats() {
  const now = new Date().toISOString();
  const cards = getCards();
  const byType = {};
  for (const c of cards) byType[c.type] = (byType[c.type] || 0) + 1;
  return {
    dictionaryWordCount: wordCount(),
    selectedRootCount: getSelected().length,
    totalCards: cards.length,
    dueNow: cards.filter((c) => c.due_at <= now && c.phase !== 'intro').length,
    introducing: cards.filter((c) => c.phase === 'intro').length,
    cardsByType: byType,
  };
}

export function getRecentWords(limit = 25) {
  return getSelected()
    .slice()
    .sort((a, b) => (a.selected_at < b.selected_at ? 1 : a.selected_at > b.selected_at ? -1 : 0))
    .slice(0, limit);
}

// --- Sync support (see js/sync.js) -----------------------------------

/** Rows changed strictly after `since` (or all rows, if `since` is
 * null/undefined) — what this device needs to push. */
export function getChangedSince(since) {
  const selected = getSelected();
  const cards = getCards();
  return {
    selectedWords: since ? selected.filter((r) => r.updated_at > since) : selected,
    cards: since ? cards.filter((r) => r.updated_at > since) : cards,
  };
}

/** Merges rows pulled from the server into local storage. Last-write-wins
 * by `updated_at`, keyed by each table's natural identity — so applying
 * the same remote rows twice (e.g. after a retried push) is always safe. */
export function mergeRemote({ selectedWords = [], cards = [] }) {
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
}
