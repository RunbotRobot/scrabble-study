import { getRootSenses } from './dictionary.js';
import { jumble } from './jumble.js';

/** No jumble cards for inflected forms longer than this many letters. */
const MAX_JUMBLE_LENGTH = 8;

/** Builds the flashcard specs for a root word: a word->definition card,
 * a definition->word card, and one jumble card per distinct conjugated /
 * pluralized form (up to MAX_JUMBLE_LENGTH letters) listed across all of
 * the root's senses.
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

  const specs = [];
  if (definitionText) {
    specs.push({ type: 'word2def', prompt: rootWord, answer: definitionText });
    specs.push({ type: 'def2word', prompt: definitionText, answer: rootWord });
  }
  for (const form of inflections) {
    if (form.length > MAX_JUMBLE_LENGTH) continue;
    specs.push({ type: 'jumble', prompt: jumble(form), answer: form });
  }

  return specs;
}
