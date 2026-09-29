import { getRootSenses, wordExists, partsOfSpeechFor } from './dictionary.js';
import { jumble } from './jumble.js';

/** No jumble cards for inflected forms longer than this many letters. */
const MAX_JUMBLE_LENGTH = 8;

/** No word<->definition or endings cards for roots longer than this many
 * letters. */
const MAX_DEFINITION_ROOT_LENGTH = 8;

/** True for an inflection that none of the regular endings explain.
 * What such a form actually *is* can't be read off the letters — that
 * depends on the part of speech that produced it (see
 * irregularVerbForms below). */
function isIrregularForm(form) {
  return !form.endsWith('ED') && !form.endsWith('ING') && !form.endsWith('S');
}

/** Separates the two plural spellings a root ending in -O can take, so
 * that -OS comes before -OES (ZEROS, ZEROES). Both end in S, so the
 * ranking above cannot tell them apart and they fell out in whatever
 * order the source data listed them — which is not even consistent
 * between entries: ZERO and CARGO list the -OES form first, SOLO the
 * -OS form. Returned as a tiebreaker rather than folded into the main
 * ranking because it only ever decides between two forms that already
 * rank the same. Verbs get the same treatment, since -O verbs have the
 * same pair for the third person (ECHOS, ECHOES). */
function oPluralRank(form, rootWord) {
  if (!rootWord.endsWith('O')) return 0;
  return form === `${rootWord}ES` ? 1 : 0;
}

/** Sorts inflected forms into a natural reading order — verb
 * conjugations as past, past participle, -ING, then the -S form (e.g.
 * PREVISED, PREVISING, PREVISES), and for plurals, the regular -S/-ES
 * form before an irregular one (e.g. MACULAS before MACULAE) — rather
 * than whatever order the source data or alphabetization happens to
 * produce. Stable, so forms within the same group keep their relative
 * order.
 *
 * The past tense used to be found by looking for -ED, which quietly
 * assumed every verb has a regular one. MISDEAL's past is MISDEALT, so
 * it matched nothing and fell to the bottom, printing as MISDEALING,
 * MISDEALS, MISDEALT — the conjugations in an order no dictionary would
 * use. The fix isn't to guess harder at the letters: -T here, a vowel
 * change in BEGAN, a whole different word in WENT. It's that a form
 * matching none of the regular endings is by elimination the irregular
 * one, and on a verb the irregular slots are exactly the past and the
 * past participle — so it belongs with the conjugations regardless of
 * how it's spelled, and regardless of whether a regular -ED is there
 * too (SHOW has both, as SHOWED then SHOWN).
 *
 * Which is why this needs the part of speech and can't work from the
 * word alone: the same "matches nothing" test picks out an irregular
 * plural on a noun (OXEN, ALAE) and a comparative on an adjective
 * (APTER, APTEST), and those belong nowhere near the front. Across the
 * dictionary they are the large majority of irregular forms — 1794
 * noun and 4104 adjective against 866 verb — so promoting on the
 * spelling alone would misplace six forms for every one it fixed. */
function inflectionRank(form, irregularVerbForms) {
  if (form.endsWith('ED')) return 0;
  if (irregularVerbForms.has(form)) return 1;
  if (form.endsWith('ING')) return 2;
  if (form.endsWith('S')) return 3;
  return 4;
}

/** Which group each of a root's RE-/UN- forms belongs with, once the
 * endings are split by part of speech. Such a form is a fact about the
 * word rather than about any one sense, so it has no group of its own,
 * and it has to be put somewhere: repeating it on every card teaches it
 * twice, and dropping it loses a valid word.
 *
 * Each form is placed on its own, since RE- and UN- need not agree.
 * A verb group wins when the prefixed word has a verb sense, because
 * that is what these prefixes attach to: REDO and UNDO are each listed
 * as both noun and verb, so merely taking the first part of speech they
 * share with the root put them on DO (n) — whose sense is the musical
 * tone, and whose only ending is DOS. Failing that, any part of speech
 * shared with the root will do, and failing that the first group, so
 * the word still appears somewhere. */
function prefixHomes(prefixForms, groups) {
  const positions = [...groups.keys()];
  const homes = new Map();
  for (const form of prefixForms) {
    const shared = (getRootSenses(form) || []).map((sense) => sense.pos).filter((pos) => groups.has(pos));
    const home = shared.includes('v') ? 'v' : shared[0] || positions[0];
    if (!homes.has(home)) homes.set(home, []);
    homes.get(home).push(form);
  }
  return homes;
}

/** The -ILY adverb of a root ending in -Y, when the dictionary has one:
 * TIDY gives TIDILY. Worth stating on every such card, because it is a
 * word you can play and the source data only sometimes bothers to
 * record it — of the 549 that exist, it lists barely a handful as
 * derived forms.
 *
 * Built by replacing the -Y and then checking the result is really an
 * adverb, not merely a word. Stripping letters and appending three more
 * lands on unrelated entries often enough to matter: OY would otherwise
 * claim OILY, DAY would claim DAILY and HOMY would claim HOMILY, none
 * of which are adverbs of anything. That test has to look at crossrefs
 * as well as senses, since most of these adverbs (COZILY, ICKILY) have
 * no sense of their own — only a crossref recording what they are. */
function adverbFormFor(rootWord) {
  if (!rootWord.endsWith('Y')) return null;
  const candidate = `${rootWord.slice(0, -1)}ILY`;
  if (!wordExists(candidate)) return null;
  return partsOfSpeechFor(candidate).includes('adv') ? candidate : null;
}

/** Which group the -ILY adverb belongs with. An adverb in -ILY is the
 * adverb of an adjective — tidily is the manner of being tidy, not of
 * the verb to tidy — so an adjective group takes it whenever the root
 * has one, which covers 528 of the 549. The rest have no adjective
 * sense carrying endings at all, and fall to the first group so the
 * word still gets said somewhere. */
function adverbHome(groups) {
  const positions = [...groups.keys()];
  return positions.includes('adj') ? 'adj' : positions[0];
}

/** One endings card per part of speech the root is defined under.
 *
 * TIDY is an adjective that goes TIDIER, TIDIEST and a verb that goes
 * TIDIED, TIDYING, TIDIES, and merging those into a single list asked
 * you to recall two unrelated paradigms at once while implying they
 * were one. Splitting them also makes the ordering rules mean something
 * per card: SOLO's noun list runs SOLOS, SOLI and its verb list SOLOED,
 * SOLOING, SOLOS, SOLOES, where merged they interleaved.
 *
 * The part of speech goes into the prompt, which is both what the card
 * shows and what distinguishes the two cards' identities (a card's id
 * is type + root + prompt). It's added only when the root actually has
 * more than one — a lone "TUBER (n)" would be the part-of-speech tag
 * this app deliberately drops from definitions for adding noise without
 * information, and it would also change the identity of every endings
 * card in every existing deck to no purpose. */
function endingsSpecs(rootWord, senses) {
  const groups = new Map();
  for (const s of senses) {
    if (s.inflections.length === 0 && s.derived.length === 0) continue;
    if (!groups.has(s.pos)) groups.set(s.pos, []);
    groups.get(s.pos).push(s);
  }

  const prefixForms = [`RE${rootWord}`, `UN${rootWord}`].filter((w) => wordExists(w));
  const adverb = adverbFormFor(rootWord);
  // With no group to attach them to there is still a card to make: a
  // root whose only extra facts are that UNFOO and FOOILY exist should
  // say so. CURSORY is the shape of this — no inflections at all, but
  // CURSORILY is a word.
  if (groups.size === 0) {
    const loose = [...(adverb ? [`${adverb} (adv)`] : []), ...prefixForms];
    if (loose.length === 0) return [];
    return [{ type: 'endings', prompt: rootWord, answer: loose.join(', ') }];
  }
  const prefixHomesByPos = prefixHomes(prefixForms, groups);
  // Only add the adverb where the source data hasn't already placed it
  // somewhere itself — and that check has to span the whole root, not
  // the group being built. SAVVY lists SAVVILY under its verb sense
  // while the rule below would file it under the adjective, so a
  // per-group check saw no clash and put it on both cards.
  const adverbAlreadyListed =
    adverb !== null && senses.some((sense) => sense.derived.some((d) => d.word === adverb));
  const adverbPos = adverb && !adverbAlreadyListed ? adverbHome(groups) : null;
  const labelled = groups.size > 1;

  const specs = [];
  for (const [pos, group] of groups) {
    const inflectionSet = new Set();
    // Scoped to this group, so "irregular" is judged against the part of
    // speech that actually produced the form.
    const irregularVerbForms = new Set();
    for (const s of group) {
      for (const form of s.inflections) {
        inflectionSet.add(form);
        if (pos === 'v' && isIrregularForm(form)) irregularVerbForms.add(form);
      }
    }
    const inflections = [...inflectionSet].sort(
      (a, b) =>
        inflectionRank(a, irregularVerbForms) - inflectionRank(b, irregularVerbForms) ||
        oPluralRank(a, rootWord) - oPluralRank(b, rootWord)
    );

    const derivedForms = [];
    const seenDerived = new Set();
    for (const s of group) {
      for (const d of s.derived) {
        if (seenDerived.has(d.word)) continue;
        seenDerived.add(d.word);
        derivedForms.push(d);
      }
    }
    if (pos === adverbPos) derivedForms.push({ word: adverb, pos: 'adv' });

    const mine = prefixHomesByPos.get(pos) || [];
    const answer = [...inflections, ...derivedForms.map((d) => `${d.word} (${d.pos})`), ...mine].join(', ');
    if (!answer) continue;
    specs.push({ type: 'endings', prompt: labelled ? `${rootWord} (${pos})` : rootWord, answer });
  }
  return specs;
}

/** Builds the flashcard specs for a root word: a word->definition card,
 * a definition->word card, an endings card per part of speech the root
 * is defined under (all only for roots up to
 * MAX_DEFINITION_ROOT_LENGTH letters), and one jumble card per
 * distinct conjugated/pluralized form plus the root word itself (each up
 * to MAX_JUMBLE_LENGTH letters) listed across all of the root's senses.
 *
 * The endings card quizzes everything about the root *besides* its core
 * meaning: its conjugations/plurals, any "self-explanatory" derived
 * forms (e.g. ANERGY's noun sense derives the adjective ANERGIC — no
 * separate definition needed once you know the root), and its RE-/UN-
 * prefixed form(s), when those are valid Scrabble words.
 *
 * Returns null if `rootWord` isn't actually a root (has no real senses).
 */
export function buildCardSpecs(rootWord) {
  const senses = getRootSenses(rootWord);
  if (!senses) return null;

  const definedSenses = senses.filter((s) => s.definition);
  const definitionText = definedSenses.map((s) => s.definition).join(' / ');

  // The union across every sense, for jumbles — which quiz the letters
  // of a form and don't care which part of speech produced it.
  const allForms = new Set();
  for (const s of senses) for (const form of s.inflections) allForms.add(form);

  const specs = [];
  if (rootWord.length <= MAX_DEFINITION_ROOT_LENGTH) {
    if (definitionText) {
      specs.push({ type: 'word2def', prompt: rootWord, answer: definitionText });
      specs.push({ type: 'def2word', prompt: definitionText, answer: rootWord });
    }
    specs.push(...endingsSpecs(rootWord, senses));
  }
  const jumbleForms = new Set(allForms);
  jumbleForms.add(rootWord);
  for (const form of jumbleForms) {
    if (form.length > MAX_JUMBLE_LENGTH) continue;
    specs.push({ type: 'jumble', prompt: jumble(form), answer: form });
  }

  return specs;
}
