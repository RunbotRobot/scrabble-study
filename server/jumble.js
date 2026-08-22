'use strict';

const LETTER_ORDER = 'QVUWGBFJYOPLKITMDCNHARZXES';

if (new Set(LETTER_ORDER).size !== 26) {
  throw new Error('LETTER_ORDER must contain each letter A-Z exactly once');
}

const RANK = new Map([...LETTER_ORDER].map((ch, i) => [ch, i]));

/** Deterministically "jumbles" a word by sorting its letters into the
 * fixed custom letter order, rather than a random shuffle. Same word
 * always produces the same jumble. */
function jumble(word) {
  return [...word.toUpperCase()].sort((a, b) => RANK.get(a) - RANK.get(b)).join('');
}

module.exports = { jumble, LETTER_ORDER };
