let words = null;
let wordList = null;

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

/** Returns { pos, definition, inflections }[] for a root word's own real
 * senses, or null if `word` isn't a root for any sense. */
export function getRootSenses(word) {
  requireLoaded();
  const entry = words[word];
  if (!entry || !entry.s) return null;
  return entry.s.map((s) => ({ pos: s.p, definition: s.d, inflections: s.i }));
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
