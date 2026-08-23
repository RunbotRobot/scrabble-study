import { getRootSenses, wordExists } from './dictionary.js';
import { jumble } from './jumble.js';

/** No jumble cards for inflected forms longer than this many letters. */
const MAX_JUMBLE_LENGTH = 8;

/** No word<->definition or endings cards for roots longer than this many
 * letters. */
const MAX_DEFINITION_ROOT_LENGTH = 8;

/** Builds the flashcard specs for a root word: a word->definition card,
 * a definition->word card, an endings card (all three only for roots up
 * to MAX_DEFINITION_ROOT_LENGTH letters), and one jumble card per
 * distinct conjugated/pluralized form (up to MAX_JUMBLE_LENGTH letters)
 * listed across all of the root's senses.
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
  const definitionText = definedSenses.map((s) => `${s.definition} (${s.pos})`).join(' / ');

  const inflections = new Set();
  for (const s of senses) {
    for (const form of s.inflections) inflections.add(form);
  }

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
    if (inflections.size > 0 || derivedForms.length > 0 || prefixForms.length > 0) {
      const endingsAnswer = [
        ...inflections,
        ...derivedForms.map((d) => `${d.word} (${d.pos})`),
        ...prefixForms,
      ].join(', ');
      specs.push({ type: 'endings', prompt: rootWord, answer: endingsAnswer });
    }
  }
  for (const form of inflections) {
    if (form.length > MAX_JUMBLE_LENGTH) continue;
    specs.push({ type: 'jumble', prompt: jumble(form), answer: form });
  }

  return specs;
}
