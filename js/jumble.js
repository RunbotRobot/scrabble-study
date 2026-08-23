const LETTER_ORDER = 'QVUWGBFJYOPLKITMDCNHARZXES';

const RANK = new Map([...LETTER_ORDER].map((ch, i) => [ch, i]));

/** Deterministically "jumbles" a word by sorting its letters into the
 * fixed custom letter order, rather than a random shuffle. Same word
 * always produces the same jumble. */
export function jumble(word) {
  return [...word.toUpperCase()].sort((a, b) => RANK.get(a) - RANK.get(b)).join('');
}

/** Compares two words the way a dictionary would, but under the custom
 * "valuegram" letter order instead of A-Z — used to order a jumble's
 * multiple valid solutions for display. Named after "alphagram" (the
 * competitive-Scrabble term for a word's letters sorted alphabetically):
 * this is the same idea, sorted by each tile's true relative value in
 * Scrabble instead of by the printed point cost. */
export function compareByValuegram(a, b) {
  const upperA = a.toUpperCase();
  const upperB = b.toUpperCase();
  const len = Math.min(upperA.length, upperB.length);
  for (let i = 0; i < len; i++) {
    const diff = RANK.get(upperA[i]) - RANK.get(upperB[i]);
    if (diff !== 0) return diff;
  }
  return upperA.length - upperB.length;
}

export { LETTER_ORDER };
