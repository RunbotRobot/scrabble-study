import { getRootSenses, wordExists } from './dictionary.js';
import { jumble } from './jumble.js';

/** No jumble cards for inflected forms longer than this many letters. */
const MAX_JUMBLE_LENGTH = 8;

/** No word<->definition or endings cards for roots longer than this many
 * letters. */
const MAX_DEFINITION_ROOT_LENGTH = 8;

/** Sorts inflected forms into a natural reading order — verb
 * conjugations as -ED, -ING, then the -S form (e.g. PREVISED, PREVISING,
 * PREVISES), and for plurals, the regular -S/-ES form before an
 * irregular one (e.g. MACULAS before MACULAE) — rather than whatever
 * order the source data or alphabetization happens to produce. Stable,
 * so forms within the same group keep their relative order. */
function inflectionRank(form) {
  if (form.endsWith('ED')) return 0;
  if (form.endsWith('ING')) return 1;
  if (form.endsWith('S')) return 2;
  return 3;
}

/** Builds the flashcard specs for a root word: a word->definition card,
 * a definition->word card, an endings card (all three only for roots up
 * to MAX_DEFINITION_ROOT_LENGTH letters), and one jumble card per
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

  const inflectionSet = new Set();
  for (const s of senses) {
    for (const form of s.inflections) inflectionSet.add(form);
  }
  const inflections = [...inflectionSet].sort((a, b) => inflectionRank(a) - inflectionRank(b));

  const derivedForms = [];
  const seenDerived = new Set();
  for (const s of senses) {
    for (const d of s.derived) {
      if (seenDerived.has(d.word)) continue;
      seenDerived.add(d.word);
      derivedForms.push(d);
    }
  }

  const prefixForms = [`RE${rootWord}`, `UN${rootWord}`].filter((w) => wordExists(w));

  const specs = [];
  if (rootWord.length <= MAX_DEFINITION_ROOT_LENGTH) {
    if (definitionText) {
      specs.push({ type: 'word2def', prompt: rootWord, answer: definitionText });
      specs.push({ type: 'def2word', prompt: definitionText, answer: rootWord });
    }
    if (inflections.length > 0 || derivedForms.length > 0 || prefixForms.length > 0) {
      const endingsAnswer = [
        ...inflections,
        ...derivedForms.map((d) => `${d.word} (${d.pos})`),
        ...prefixForms,
      ].join(', ');
      specs.push({ type: 'endings', prompt: rootWord, answer: endingsAnswer });
    }
  }
  const jumbleForms = new Set(inflections);
  jumbleForms.add(rootWord);
  for (const form of jumbleForms) {
    if (form.length > MAX_JUMBLE_LENGTH) continue;
    specs.push({ type: 'jumble', prompt: jumble(form), answer: form });
  }

  return specs;
}
