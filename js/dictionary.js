import { jumble, compareByValuegram } from './jumble.js';

let words = null;
let wordList = null;
let anagramIndex = null;

/** Fetches and parses data/dictionary.json once. Safe to call more than
 * once (subsequent calls reuse the same in-memory copy). */
export async function loadDictionary(url = 'data/dictionary.json') {
  if (words) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load dictionary: ${res.status}`);
  const data = await res.json();
  words = data.words;
  wordList = Object.keys(words);
}

function requireLoaded() {
  if (!words) throw new Error('Dictionary not loaded yet — call loadDictionary() first.');
}

export function wordCount() {
  requireLoaded();
  return wordList.length;
}

/** Picks one uniformly-random surface word from the entire word list
 * (root, conjugated, or plural forms all equally likely). */
export function pickRandomWord() {
  requireLoaded();
  const i = Math.floor(Math.random() * wordList.length);
  return wordList[i];
}

/** Returns { pos, definition, inflections, derived }[] for a root word's
 * own real senses, or null if `word` isn't a root for any sense.
 * `derived` is that sense's "self-explanatory" derived forms (e.g.
 * ANERGY's noun sense derives the adjective ANERGIC) — each itself a
 * crossref-only entry elsewhere in the dictionary, so its own meaning
 * follows straightforwardly from the root and doesn't need a definition
 * of its own; { pos, word }[], possibly empty. */
export function getRootSenses(word) {
  requireLoaded();
  const entry = words[word];
  if (!entry || !entry.s) return null;
  return entry.s.map((s) => ({
    pos: s.p,
    definition: s.d,
    inflections: s.i,
    derived: (s.e || []).map((d) => ({ pos: d.p, word: d.w })),
  }));
}

/** Returns the distinct root words that `word` resolves to: itself (if it
 * has real senses) plus any words it's a crossref/inflection of. A word
 * can resolve to more than one root (e.g. "ARE" is its own root as a noun,
 * and an inflected form of "BE" as a verb; "MEN" is a plural of both "MAN"
 * and "MON"). */
export function resolveRoots(word) {
  requireLoaded();
  const entry = words[word];
  const roots = new Set();
  if (entry && entry.s) roots.add(word);
  if (entry && entry.x) {
    for (const x of entry.x) roots.add(x.r);
  }
  return [...roots];
}

/** True if `word` appears anywhere in the dictionary (as a root or as an
 * inflected form of one) — i.e. it's a legal Scrabble play. */
export function wordExists(word) {
  requireLoaded();
  return Boolean(words[word]);
}

/** The { root, definition } an illustration for `word` should be
 * generated/cached under — always the root's own image, never a
 * separate one per inflected form, so e.g. MACULAS and MACULAE (both
 * inflections of MACULA) share MACULA's picture instead of each
 * generating their own. Returns null if `word` has no root with a real
 * definition to draw from. */
export function imageSubjectFor(word) {
  const roots = resolveRoots(word);
  const root = roots[0];
  if (!root) return null;
  const senses = getRootSenses(root);
  if (!senses) return null;
  const definition = senses
    .map((s) => s.definition)
    .filter(Boolean)
    .join(' / ');
  if (!definition) return null;
  return { root, definition };
}

function buildAnagramIndex() {
  anagramIndex = new Map();
  for (const w of wordList) {
    if (w.length > 8) continue; // jumbles are never built from longer forms
    const key = jumble(w);
    let bucket = anagramIndex.get(key);
    if (!bucket) {
      bucket = [];
      anagramIndex.set(key, bucket);
    }
    bucket.push(w);
  }
}

/** All dictionary words that are anagrams of `jumbleKey` (the same
 * jumbled letters as produced by jumble()), in valuegram order. A jumble
 * card's own `answer` is always one of these, but isn't necessarily the
 * only one — e.g. BOITNARE resolves to both BARITONE and OBTAINER. Built
 * lazily (once) on first use rather than at load time, since it's a full
 * pass over the word list. */
export function getAnagramSolutions(jumbleKey) {
  requireLoaded();
  if (!anagramIndex) buildAnagramIndex();
  const bucket = anagramIndex.get(jumbleKey) || [];
  return bucket.slice().sort(compareByValuegram);
}
