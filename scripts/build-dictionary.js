'use strict';
/**
 * Parses data/source/NWL2020.txt into data/dictionary.json, a single
 * static asset the browser fetches at runtime (no server-side database).
 *
 * Line format (one entry per surface word):
 *   WORD sense1 [pos1 INFL, INFL, ...] / sense2 [pos2 ...] / ...
 * where each sense is either:
 *   - a real definition, optionally containing {otherword=pos} shorthand
 *     refs, and optionally followed by " : OTHERWORD [pos]" — a pointer
 *     to a "self-explanatory" derived word (its own crossref-only entry
 *     elsewhere, e.g. "ANERGY lack of energy [n ANERGIES] : ANERGIC
 *     [adj]" points at ANERGIC, an adjective derived from ANERGY that
 *     needs no separate definition of its own), or
 *   - exactly "<otherword=pos>", meaning WORD (as that pos) is purely an
 *     inflected form of otherword.
 *
 * Output shape:
 *   {
 *     words: {
 *       WORD: {
 *         s?: [{ p: pos, d: definition, i: [inflection, ...], e?: [{ p: pos, w: word }, ...] }, ...],  // real senses, if any ('e' = self-explanatory derived forms)
 *         x?: [{ p: pos, r: rootWord }, ...]                                                            // crossref senses, if any
 *       },
 *       ...
 *     }
 *   }
 * The full word list (for random selection) is just Object.keys(words).
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'data', 'source', 'NWL2020.txt');
const OUT = path.join(__dirname, '..', 'data', 'dictionary.json');

const CROSSREF_RE = /^<([a-z]+)=([a-z]+)>$/i;
const SHORTHAND_RE = /\{([a-z]+)=[a-z]+\}/gi;
// A sense can end in a list of self-explanatory derived words, not just
// one: "ATONE ... [v ATONED, ATONES, ATONING] : ATONABLE [adj],
// ATONEABLE [adj], ATONINGLY [adv]". Matching only a single trailing
// item meant such a line matched nothing here, so nothing was stripped
// — and SENSE_RE's end anchor then took that final "[adv]" for the
// sense's own bracket, leaving the real "[v ATONED, ...]" sitting in
// the middle of what became the definition. 277 entries read that way.
const DERIVED_SUFFIX_RE = /\s*:\s*((?:[A-Z]+\s*\[[a-z]+\]\s*,?\s*)+)$/;
const DERIVED_ITEM_RE = /([A-Z]+)\s*\[([a-z]+)\]/g;
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
  const yearMatch = rest.match(YEAR_SUFFIX_RE);
  if (yearMatch) {
    rest = rest.slice(0, yearMatch.index);
  }

  const senseTexts = rest.split(' / ');
  const senses = [];

  for (const senseText of senseTexts) {
    // Strip any trailing " : OTHERWORD [pos], ..." self-explanatory-
    // derivative pointers *before* matching the sense's own bracket —
    // otherwise the last of their "[pos]"s (with no inflections) is what
    // SENSE_RE's end anchor grabs, stranding the sense's real
    // "[pos INFL, ...]" bracket in the middle of the definition text
    // instead of being parsed out.
    let text = senseText;
    let derived = [];
    const derivedMatch = text.match(DERIVED_SUFFIX_RE);
    if (derivedMatch) {
      derived = [...derivedMatch[1].matchAll(DERIVED_ITEM_RE)].map((item) => ({
        pos: item[2].toLowerCase(),
        word: item[1].toUpperCase(),
      }));
      text = text.slice(0, derivedMatch.index);
    }

    const m = text.match(SENSE_RE);
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
        derived,
      });
    }
  }

  return { word, senses };
}

function main() {
  const raw = fs.readFileSync(SOURCE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const words = {};
  let rootCount = 0;
  let crossrefCount = 0;

  for (const line of lines) {
    const parsed = parseLine(line.trimEnd());
    if (!parsed) continue;
    const { word, senses } = parsed;

    const entry = {};
    const realSenses = senses.filter((s) => s.type === 'real');
    if (realSenses.length > 0) {
      entry.s = realSenses.map((s) => {
        const sense = { p: s.pos, d: s.definition, i: s.inflections };
        if (s.derived.length > 0) sense.e = s.derived.map((d) => ({ p: d.pos, w: d.word }));
        return sense;
      });
      rootCount++;
    }
    const crossrefSenses = senses.filter((s) => s.type === 'crossref');
    if (crossrefSenses.length > 0) {
      entry.x = crossrefSenses.map((s) => ({ p: s.pos, r: s.root }));
      crossrefCount += crossrefSenses.length;
    }
    words[word] = entry;
  }

  fs.writeFileSync(OUT, JSON.stringify({ words }));

  const wordCount = Object.keys(words).length;
  const sizeMb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(2);
  console.log(
    `Parsed ${lines.length} lines -> ${wordCount} words, ${rootCount} roots, ${crossrefCount} crossrefs. ` +
      `Wrote ${OUT} (${sizeMb} MB).`
  );
}

main();
