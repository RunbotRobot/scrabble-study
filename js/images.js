import { WORKER_URL } from './sync.js';

/** URL for a root word's illustration, generated (and cached forever)
 * on first request by the worker's /image endpoint — see worker/index.js.
 * `definition` only matters on the very first request for a given word;
 * once cached, it's ignored. Images are global/shared, not per sync ID —
 * the same word always gets the same picture for everyone.
 *
 * Pollinations' free tier currently only serves one underlying model
 * (Sana — its documented `model=` param for flux/turbo/etc. is silently
 * ignored, confirmed by requesting both and diffing the bytes). Left to
 * its own devices it strongly favors rendering human faces/figures for
 * abstract prompts, including a real, repeatable tendency toward
 * generating nudity for entirely G-rated definitions (verified
 * directly — not a one-off) — and it doesn't reliably honor negative
 * instructions like "no nudity" stated in the prompt, so the fix isn't
 * asking it not to. Steering the prompt toward a concrete inanimate
 * object instead — described as product photography, not "an
 * illustration of" — sidesteps the figure-rendering bias close to
 * entirely instead of fighting it head-on, as a side effect also
 * reading as far more literal than the moody/painterly default style. */
export function imageUrlFor(word, definition) {
  const url = `${WORKER_URL}/image/${encodeURIComponent(word)}`;
  const subject = definition ? `${word}: ${definition}` : word;
  const prompt = `A single inanimate object as a visual metaphor for: ${subject}. Still life product photography, plain background, no people, no faces, no human body`;
  return `${url}?prompt=${encodeURIComponent(prompt)}`;
}

/** Markup for a root's illustration, including a loading indicator for
 * the (common) case where this is the very first request for that word
 * and the worker has to actually generate it — that can take several
 * seconds, during which an `<img>` alone just looks broken (an empty
 * box, no feedback that anything's happening). Since there's no way to
 * know real progress, the bar fills toward a deliberately generous
 * guess at the longest case and eases off rather than stalling dead —
 * it's a "this is still working" signal, not a real ETA. Swaps over to
 * the actual image once it arrives — or, on failure (e.g. a transient
 * generation error), a small "couldn't load" placeholder rather than
 * just vanishing, which otherwise reads as a rendering glitch instead
 * of a word that's momentarily not illustrated. A later view retries
 * from scratch, since a failure is never cached. */
export function imageHtmlFor(word, definition) {
  const src = imageUrlFor(word, definition);
  return `
    <div class="wd-image-wrap">
      <div class="wd-image-progress"><div class="wd-image-progress-bar"></div></div>
      <div class="wd-image-error">picture unavailable</div>
      <img class="wd-image" src="${src}" alt="" loading="lazy"
        onload="this.closest('.wd-image-wrap').classList.add('wd-image-loaded')"
        onerror="this.closest('.wd-image-wrap').classList.add('wd-image-failed')" />
    </div>
  `;
}
