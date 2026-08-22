const LETTER_ORDER = 'QVUWGBFJYOPLKITMDCNHARZXES';

const RANK = new Map([...LETTER_ORDER].map((ch, i) => [ch, i]));

/** Deterministically "jumbles" a word by sorting its letters into the
 * fixed custom letter order, rather than a random shuffle. Same word
 * always produces the same jumble. */
export function jumble(word) {
  return [...word.toUpperCase()].sort((a, b) => RANK.get(a) - RANK.get(b)).join('');
}

export { LETTER_ORDER };
