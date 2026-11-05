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

/** The root an "obvious" RE- word is really just the root again, or null
 * when `word` is not one: REALLOT is "to allot again", and nothing more
 * needs saying about it once ALLOT is known.
 *
 * Obvious is decided from the definition, since that is the only thing
 * that separates REALLOT from REPORTER ("one that reports" — not "to
 * porter again") or RELAY (which does mean "to lay again", and also a
 * second, unrelated thing, so it has to be learned in its own right).
 * Every sense has to be the plain "to <root> again"; REDO is allowed its
 * noun sense, "something that is done again", which is that same thing
 * seen from the other side. The root has to be a word in its own right,
 * so RELUME ("to light again", with no LUME to be found) is left alone.
 *
 * Such a word is never given definition cards of its own, and a lookup of
 * it lands on the root (see resolveStudyRoots). */
export function obviousReBase(word) {
  requireLoaded();
  if (!word.startsWith('RE')) return null;
  const base = word.slice(2);
  const entry = words[word];
  if (!entry || !entry.s || !words[base] || !words[base].s) return null;
  const again = `to ${base.toLowerCase()} again`;
  const noun = /^something that is \w+ again$/;
  let sawVerb = false;
  for (const sense of entry.s) {
    const d = (sense.d || '').toLowerCase();
    if (d === again) sawVerb = true;
    else if (!(sense.p === 'n' && noun.test(d))) return null;
  }
  return sawVerb ? base : null;
}

/** `resolveRoots`, but with each obvious RE- word (see obviousReBase)
 * replaced by the root it is built on, so the word is studied as part of
 * that root's set rather than as a root of its own. REALLOT, or
 * REALLOTTED, gives ALLOT. Chains collapse all the way down. */
export function resolveStudyRoots(word) {
  return [...new Set(resolveRoots(word).map(studyRootOf))];
}

/** The root `root` is studied under: itself, or for an obvious RE- word
 * the root it is built on. */
export function studyRootOf(root) {
  let base = root;
  for (let next = obviousReBase(base); next; next = obviousReBase(base)) base = next;
  return base;
}

/** Every part of speech `word` is listed under — from its own senses
 * and from any crossref. The crossref matters: most of the dictionary's
 * -LY adverbs (COZILY, NAGGINGLY) have no sense of their own at all,
 * only a crossref back to the root they derive from, and that crossref
 * is the only record of what they are. */
export function partsOfSpeechFor(word) {
  requireLoaded();
  const entry = words[word];
  if (!entry) return [];
  const positions = new Set();
  for (const sense of entry.s || []) positions.add(sense.p);
  for (const crossref of entry.x || []) positions.add(crossref.p);
  return [...positions];
}

/** How the dictionary words a noun meaning "the state of being <word>":
 * TIDINESS is "the state of being tidy", LOUDNESS "the quality of being
 * loud", SLYNESS "the quality or state of being sly". The source states
 * this in a very regular way and the definition is the only thing that
 * actually ties such a noun to its adjective, so that is what is read.
 *
 * Reading the definition rather than building candidates from the
 * spelling is deliberate. It catches the irregular spellings a suffix
 * rule can't (CAGINESS belongs to CAGEY, HOMINESS to HOMEY), and it
 * can't be fooled by words that merely end in -NESS and mean something
 * else: WITNESS, BUSINESS, CHESS, LIONESS and NESS itself. */
const STATE_OF_BEING_RE =
  /^the (?:(?:quality|state) or )?(?:quality|state|condition|property|characteristic) of being (\w+)$/i;

let stateOfBeingIndex = null;

function buildStateOfBeingIndex() {
  stateOfBeingIndex = new Map();
  for (const word of wordList) {
    if (!word.endsWith('NESS')) continue;
    for (const sense of words[word].s || []) {
      if (sense.p !== 'n' || !sense.d) continue;
      const match = sense.d.match(STATE_OF_BEING_RE);
      if (!match) continue;
      const root = match[1].toUpperCase();
      // Only an adjective has a "state of being" in this sense; TWONESS
      // and IRONNESS point at a noun and a verb and are something else.
      if (!(words[root]?.s || []).some((rootSense) => rootSense.p === 'adj')) continue;
      if (!stateOfBeingIndex.has(root)) stateOfBeingIndex.set(root, []);
      const list = stateOfBeingIndex.get(root);
      if (!list.includes(word)) list.push(word);
    }
  }
}

/** The -NESS nouns meaning "the state of being `adjective`", e.g.
 * TIDINESS for TIDY. Empty when `adjective` is not an adjective or has
 * none. */
export function statesOfBeingFor(adjective) {
  requireLoaded();
  if (!stateOfBeingIndex) buildStateOfBeingIndex();
  return stateOfBeingIndex.get(adjective) || [];
}

/** True if `word` appears anywhere in the dictionary (as a root or as an
 * inflected form of one) — i.e. it's a legal Scrabble play. */
export function wordExists(word) {
  requireLoaded();
  return Boolean(words[word]);
}

/** Matches a definition that's nothing but "(a/an/to) OTHERWORD" — the
 * dictionary source's `{otherword=pos}` shorthand for "this means the
 * same as that word" (e.g. STOTT's definition is literally "to stot",
 * pointing at STOT). Fine as reading text once you already know
 * OTHERWORD, but if OTHERWORD is itself an obscure Scrabble-only word,
 * an image model has nothing to latch onto either. */
const THIN_DEFINITION_RE = /^(?:to|an?)\s+([a-z]+)$/i;

/** `definition`, enriched with the referenced word's own definition if
 * `definition` is a thin same-as-OTHERWORD pointer (see
 * THIN_DEFINITION_RE) and that word has one — e.g. "to stot" becomes
 * "to stot (to bound with a stiff-legged gait)". Otherwise returned
 * unchanged, including when the reference resolves to nothing richer
 * (plenty of these are already perfectly depictable as-is, e.g. AD:
 * "an advertisement"). */
function enrichThinDefinition(definition, root) {
  const m = definition.match(THIN_DEFINITION_RE);
  if (!m) return definition;
  const referenced = m[1].toUpperCase();
  if (referenced === root) return definition;
  const referencedSenses = getRootSenses(referenced);
  const referencedDefinition = referencedSenses
    ? referencedSenses
        .map((s) => s.definition)
        .filter(Boolean)
        .join(' / ')
    : '';
  return referencedDefinition ? `${definition} (${referencedDefinition})` : definition;
}

/** The { root, definition } an illustration for `word` should be
 * generated/cached under — always the root's own image, never a
 * separate one per inflected form, so e.g. MACULAS and MACULAE (both
 * inflections of MACULA) share MACULA's picture instead of each
 * generating their own. Returns null if `word` has no root with a real
 * definition to draw from. */
export function imageSubjectFor(word) {
  // REDRY has no picture of its own: it is DRY's.
  const roots = resolveStudyRoots(word);
  const root = roots[0];
  if (!root) return null;
  const senses = getRootSenses(root);
  if (!senses) return null;
  const definition = senses
    .map((s) => enrichThinDefinition(s.definition, root))
    .filter(Boolean)
    .join(' / ');
  if (!definition) return null;
  return { root, definition };
}

/** Roots whose definition text contains `query`, case-insensitively.
 * The inverse of looking a word up: you remember roughly what it means
 * and want the word back.
 *
 * A plain scan of every sense, with no index built or held: the whole
 * dictionary is 93k senses and about 1.4MB of definition text, which
 * searches in tens of milliseconds — fast enough for a search that runs
 * on submit rather than per keystroke, and cheaper than carrying a
 * second copy of that text around in memory for the life of the page.
 *
 * `accept` narrows the scan itself rather than filtering afterwards, so
 * that `total` counts what the caller actually asked for and the limit
 * is applied to those. Returns { results, total, truncated }, results
 * alphabetical and capped at `limit`. */
export function searchDefinitions(query, { limit = 100, accept = null } = {}) {
  requireLoaded();
  const needle = (query || '').trim().toLowerCase();
  // One letter matches most of the dictionary and tells you nothing.
  if (needle.length < 2) return { results: [], total: 0, truncated: false };

  const matches = [];
  for (const word of wordList) {
    const entry = words[word];
    if (!entry.s) continue;
    if (accept && !accept(word)) continue;
    if (!entry.s.some((sense) => sense.d && sense.d.toLowerCase().includes(needle))) continue;
    matches.push(word);
  }
  matches.sort();

  return {
    total: matches.length,
    truncated: matches.length > limit,
    results: matches.slice(0, limit).map((root) => ({
      root,
      senses: words[root].s.map((sense) => ({ pos: sense.p, definition: sense.d })),
    })),
  };
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
