import { WORKER_URL } from './sync.js';

/** URL for a root word's illustration, generated (and cached forever)
 * on first request by the worker's /image endpoint — see worker/index.js.
 * `definition` only matters on the very first request for a given word;
 * once cached, it's ignored. Images are global/shared, not per sync ID —
 * the same word always gets the same picture for everyone.
 *
 * The word itself is folded into the generation prompt (not just the
 * bare definition) — a dictionary gloss like "to find fault
 * incessantly" is abstract enough on its own that an image model has
 * nothing concrete to latch onto, so pairing it with the word gives it
 * more to work with. */
export function imageUrlFor(word, definition) {
  const url = `${WORKER_URL}/image/${encodeURIComponent(word)}`;
  const prompt = definition ? `${word}: ${definition}` : word;
  return `${url}?prompt=${encodeURIComponent(prompt)}`;
}
