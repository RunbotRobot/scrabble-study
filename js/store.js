/**
 * Persists study state (selected root words + flashcards + SRS progress)
 * in this browser's localStorage. Everything lives on-device only — there
 * is no server, so progress isn't synced across browsers or devices.
 */

import { pickRandomWord, resolveRoots, wordCount } from './dictionary.js';
import { buildCardSpecs } from './cards.js';
import { initialState, schedule } from './srs.js';

const KEY_SELECTED = 'scrabbleStudy.selectedWords';
const KEY_CARDS = 'scrabbleStudy.cards';
const KEY_NEXT_ID = 'scrabbleStudy.nextId';

const MAX_PICK_ATTEMPTS = 1000;

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

function nextId() {
  const id = load(KEY_NEXT_ID, 1);
  save(KEY_NEXT_ID, id + 1);
  return id;
}

function getSelected() {
  return load(KEY_SELECTED, []);
}

function getCards() {
  return load(KEY_CARDS, []);
}

function addRootToStudy(rootWord, viaWord, now, selected, cards) {
  const specs = buildCardSpecs(rootWord);
  if (!specs) return 0;

  selected.push({ root_word: rootWord, via_word: viaWord, selected_at: now.toISOString() });

  const base = initialState(now);
  for (const spec of specs) {
    cards.push({
      id: nextId(),
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
      created_at: now.toISOString(),
    });
  }
  return specs.length;
}

/** Picks a uniformly-random word from the whole dictionary (root,
 * conjugated, or plural forms all equally likely), resolves it to its
 * root(s), and adds any not-yet-studied root(s) with their flashcards. */
export function addRandomWord() {
  const now = new Date();
  const selected = getSelected();
  const selectedSet = new Set(selected.map((s) => s.root_word));

  for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
    const word = pickRandomWord();
    const roots = resolveRoots(word);
    const newRoots = roots.filter((r) => !selectedSet.has(r));
    if (newRoots.length === 0) continue;

    const cards = getCards();
    let cardsAdded = 0;
    for (const root of newRoots) {
      cardsAdded += addRootToStudy(root, word, now, selected, cards);
    }
    save(KEY_SELECTED, selected);
    save(KEY_CARDS, cards);
    return { ok: true, pickedWord: word, roots, newRoots, cardsAdded };
  }
  return { ok: false, message: `Could not find an unstudied word after ${MAX_PICK_ATTEMPTS} attempts.` };
}

export function getNextDue(limit = 1) {
  const now = new Date().toISOString();
  const cards = getCards();
  const due = cards
    .filter((c) => c.due_at <= now)
    .sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0))
    .slice(0, limit);
  if (due.length > 0) return { due };
  const nextDueAt = cards.reduce((min, c) => (min === null || c.due_at < min ? c.due_at : min), null);
  return { due: [], nextDueAt };
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
  Object.assign(card, next);
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
    dueNow: cards.filter((c) => c.due_at <= now).length,
    cardsByType: byType,
  };
}

export function getRecentWords(limit = 25) {
  return getSelected()
    .slice()
    .sort((a, b) => (a.selected_at < b.selected_at ? 1 : a.selected_at > b.selected_at ? -1 : 0))
    .slice(0, limit);
}
