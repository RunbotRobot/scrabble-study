'use strict';

const { db } = require('./db');
const { pickRandomWord, resolveRoots, WORD_COUNT } = require('./dictionary');
const { buildCardSpecs } = require('./cards');
const { initialState, schedule } = require('./srs');

const MAX_PICK_ATTEMPTS = 1000;

const stmts = {
  isSelected: db.prepare('SELECT 1 FROM selected_words WHERE root_word = ?'),
  insertSelected: db.prepare('INSERT INTO selected_words (root_word, selected_at, via_word) VALUES (?, ?, ?)'),
  insertCard: db.prepare(`
    INSERT INTO cards (root_word, type, prompt, answer, interval_days, ease, reps, lapses, due_at, last_reviewed_at, created_at)
    VALUES (@root_word, @type, @prompt, @answer, @interval_days, @ease, @reps, @lapses, @due_at, @last_reviewed_at, @created_at)
  `),
  getCard: db.prepare('SELECT * FROM cards WHERE id = ?'),
  updateCard: db.prepare(`
    UPDATE cards SET interval_days = ?, ease = ?, reps = ?, lapses = ?, due_at = ?, last_reviewed_at = ?
    WHERE id = ?
  `),
  dueCards: db.prepare('SELECT * FROM cards WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?'),
  nextDueAt: db.prepare('SELECT MIN(due_at) AS due_at FROM cards'),
  countSelected: db.prepare('SELECT COUNT(*) AS c FROM selected_words'),
  countCards: db.prepare('SELECT COUNT(*) AS c FROM cards'),
  countDue: db.prepare('SELECT COUNT(*) AS c FROM cards WHERE due_at <= ?'),
  countByType: db.prepare('SELECT type, COUNT(*) AS c FROM cards GROUP BY type'),
  recentWords: db.prepare('SELECT root_word, via_word, selected_at FROM selected_words ORDER BY selected_at DESC LIMIT ?'),
};

function isSelected(rootWord) {
  return !!stmts.isSelected.get(rootWord);
}

function addRootToStudy(rootWord, viaWord, now) {
  const specs = buildCardSpecs(rootWord);
  if (!specs) return 0;

  stmts.insertSelected.run(rootWord, now.toISOString(), viaWord);

  const base = initialState(now);
  let count = 0;
  for (const spec of specs) {
    stmts.insertCard.run({
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
    count++;
  }
  return count;
}

/** Picks a uniformly-random word from the whole dictionary (root,
 * conjugated, or plural forms all equally likely), resolves it to its
 * root(s), and adds any not-yet-studied root(s) with their flashcards. */
function addRandomWord() {
  const now = new Date();
  for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
    const word = pickRandomWord();
    const roots = resolveRoots(word);
    const newRoots = roots.filter((r) => !isSelected(r));
    if (newRoots.length === 0) continue;

    let cardsAdded = 0;
    for (const root of newRoots) {
      cardsAdded += addRootToStudy(root, word, now);
    }
    return { ok: true, pickedWord: word, roots, newRoots, cardsAdded };
  }
  return { ok: false, message: `Could not find an unstudied word after ${MAX_PICK_ATTEMPTS} attempts.` };
}

function getNextDue(limit = 1) {
  const now = new Date().toISOString();
  const due = stmts.dueCards.all(now, limit);
  if (due.length > 0) return { due };
  const next = stmts.nextDueAt.get();
  return { due: [], nextDueAt: next ? next.due_at : null };
}

function answerCard(id, correct) {
  const card = stmts.getCard.get(id);
  if (!card) return null;
  const now = new Date();
  const next = schedule(
    {
      interval_days: card.interval_days,
      ease: card.ease,
      reps: card.reps,
      lapses: card.lapses,
    },
    correct,
    now
  );
  stmts.updateCard.run(next.interval_days, next.ease, next.reps, next.lapses, next.due_at, next.last_reviewed_at, id);
  return { ...card, ...next };
}

function getStats() {
  const now = new Date().toISOString();
  const byType = {};
  for (const row of stmts.countByType.all()) byType[row.type] = row.c;
  return {
    dictionaryWordCount: WORD_COUNT,
    selectedRootCount: stmts.countSelected.get().c,
    totalCards: stmts.countCards.get().c,
    dueNow: stmts.countDue.get(now).c,
    cardsByType: byType,
  };
}

function getRecentWords(limit = 25) {
  return stmts.recentWords.all(limit);
}

module.exports = { addRandomWord, getNextDue, answerCard, getStats, getRecentWords };
