import { WORKER_URL } from './sync.js';

/** URL for a root word's illustration, generated (and cached forever)
 * on first request by the worker's /image endpoint — see worker/index.js.
 * `prompt` (typically the word's definition) only matters on the very
 * first request for a given word; once cached, it's ignored. Images are
 * global/shared, not per sync ID — the same word always gets the same
 * picture for everyone. */
export function imageUrlFor(word, prompt) {
  const url = `${WORKER_URL}/image/${encodeURIComponent(word)}`;
  return prompt ? `${url}?prompt=${encodeURIComponent(prompt)}` : url;
}
