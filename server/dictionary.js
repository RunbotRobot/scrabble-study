'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const DICTIONARY_PATH = path.join(__dirname, '..', 'data', 'dictionary.sqlite');

function ensureBuilt() {
  if (!fs.existsSync(DICTIONARY_PATH)) {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-dictionary.js')], {
      stdio: 'inherit',
    });
  }
}

ensureBuilt();
const db = new DatabaseSync(DICTIONARY_PATH, { readOnly: true });

const wordCountRow = db.prepare('SELECT COUNT(*) AS c FROM word_index').get();
const WORD_COUNT = wordCountRow.c;

const stmts = {
  randomWord: db.prepare('SELECT word FROM word_index ORDER BY random() LIMIT 1'),
  root: db.prepare('SELECT senses_json FROM roots WHERE word = ?'),
  crossrefs: db.prepare('SELECT pos, root FROM crossrefs WHERE word = ?'),
};

/** Picks one uniformly-random surface word from the entire word list
 * (root, conjugated, or plural forms all equally likely). */
function pickRandomWord() {
  return stmts.randomWord.get().word;
}

/** Returns { pos, definition, inflections }[] for a root word's own real
 * senses, or null if `word` isn't a root for any sense. */
function getRootSenses(word) {
  const row = stmts.root.get(word);
  return row ? JSON.parse(row.senses_json) : null;
}

/** Returns the distinct root words that `word` resolves to: itself (if it
 * has real senses) plus any words it's a crossref/inflection of. A word
 * can resolve to more than one root (e.g. "ARE" is its own root as a noun,
 * and an inflected form of "BE" as a verb; "MEN" is a plural of both "MAN"
 * and "MON"). */
function resolveRoots(word) {
  const roots = new Set();
  if (getRootSenses(word)) roots.add(word);
  for (const row of stmts.crossrefs.all(word)) {
    roots.add(row.root);
  }
  return [...roots];
}

module.exports = { WORD_COUNT, pickRandomWord, getRootSenses, resolveRoots };
