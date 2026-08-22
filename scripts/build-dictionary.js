'use strict';
/**
 * Parses data/source/NWL2020.txt into data/dictionary.sqlite.
 *
 * Line format (one entry per surface word):
 *   WORD sense1 [pos1 INFL, INFL, ...] / sense2 [pos2 ...] / ...
 * where each sense is either:
 *   - a real definition, optionally containing {otherword=pos} shorthand
 *     refs, or
 *   - exactly "<otherword=pos>", meaning WORD (as that pos) is purely an
 *     inflected form of otherword.
 *
 * Output tables:
 *   roots(word, senses_json)      -- words that have >=1 real sense
 *   crossrefs(word, pos, root)    -- words that are (for that pos) purely
 *                                     an inflected form of `root`
 *   word_index(word)              -- every surface word, for random pick
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = path.join(__dirname, '..', 'data', 'source', 'NWL2020.txt');
const OUT = path.join(__dirname, '..', 'data', 'dictionary.sqlite');

const CROSSREF_RE = /^<([a-z]+)=([a-z]+)>$/i;
const SHORTHAND_RE = /\{([a-z]+)=[a-z]+\}/gi;
const SENSE_RE = /^(.*?)\[([a-z]+)\s*([^\]]*)\]$/i;
const YEAR_SUFFIX_RE = /\s\((\d{4})\)$/;

function cleanDefinition(text) {
  return text.replace(SHORTHAND_RE, '$1').trim();
}

function parseLine(line) {
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx === -1) return null; // shouldn't happen
  const word = line.slice(0, spaceIdx);
  let rest = line.slice(spaceIdx + 1);
  let addedYear = null;
  const yearMatch = rest.match(YEAR_SUFFIX_RE);
  if (yearMatch) {
    addedYear = Number(yearMatch[1]);
    rest = rest.slice(0, yearMatch.index);
  }

  const senseTexts = rest.split(' / ');
  const senses = [];

  for (const senseText of senseTexts) {
    const m = senseText.match(SENSE_RE);
    if (!m) {
      throw new Error(`Could not parse sense in line: ${line}`);
    }
    const [, defPart, pos, inflectionsRaw] = m;
    const crossref = defPart.trim().match(CROSSREF_RE);
    if (crossref) {
      senses.push({ type: 'crossref', pos, root: crossref[1].toUpperCase() });
    } else {
      const inflections = inflectionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      senses.push({
        type: 'real',
        pos,
        definition: cleanDefinition(defPart),
        inflections,
      });
    }
  }

  return { word, senses, addedYear };
}

function main() {
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  const db = new DatabaseSync(OUT);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE roots (
      word TEXT PRIMARY KEY,
      senses_json TEXT NOT NULL
    );
    CREATE TABLE crossrefs (
      word TEXT NOT NULL,
      pos TEXT NOT NULL,
      root TEXT NOT NULL,
      PRIMARY KEY (word, pos, root)
    );
    CREATE TABLE word_index (
      word TEXT PRIMARY KEY
    );
  `);

  const insertRoot = db.prepare('INSERT INTO roots (word, senses_json) VALUES (?, ?)');
  const insertCrossref = db.prepare('INSERT INTO crossrefs (word, pos, root) VALUES (?, ?, ?)');
  const insertWordIndex = db.prepare('INSERT OR IGNORE INTO word_index (word) VALUES (?)');

  const raw = fs.readFileSync(SOURCE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  db.exec('BEGIN');
  let rootCount = 0;
  let crossrefCount = 0;
  for (const line of lines) {
    const parsed = parseLine(line.trimEnd());
    if (!parsed) continue;
    const { word, senses } = parsed;

    insertWordIndex.run(word);

    const realSenses = senses.filter((s) => s.type === 'real');
    if (realSenses.length > 0) {
      insertRoot.run(
        word,
        JSON.stringify(
          realSenses.map((s) => ({
            pos: s.pos,
            definition: s.definition,
            inflections: s.inflections,
          }))
        )
      );
      rootCount++;
    }

    for (const s of senses) {
      if (s.type === 'crossref') {
        insertCrossref.run(word, s.pos, s.root);
        crossrefCount++;
      }
    }
  }
  db.exec('COMMIT');

  db.exec('CREATE INDEX idx_crossrefs_word ON crossrefs (word)');

  const wordCount = db.prepare('SELECT COUNT(*) AS c FROM word_index').get().c;
  console.log(`Parsed ${lines.length} lines -> ${wordCount} words, ${rootCount} roots, ${crossrefCount} crossrefs.`);
  db.close();
}

main();
