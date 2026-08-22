'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STUDY_DB_PATH = path.join(__dirname, '..', 'data', 'study.sqlite');

const db = new DatabaseSync(STUDY_DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS selected_words (
    root_word TEXT PRIMARY KEY,
    selected_at TEXT NOT NULL,
    via_word TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_word TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    interval_days REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (root_word, type, prompt)
  );
  CREATE INDEX IF NOT EXISTS idx_cards_due_at ON cards (due_at);
`);

module.exports = { db, STUDY_DB_PATH };
