import { WORKER_URL } from './sync.js';

/** One-time cache-buster, and hopefully the last one. The image
 * endpoint used to answer with `max-age=31536000, immutable`, which was
 * simply untrue of a URL that PUT replaces and DELETE evicts: browsers
 * that had displayed a picture were entitled to keep serving those
 * bytes for a year without ever asking again, so the whole original set
 * of generated images stayed visible on exactly the devices that had
 * seen them even after being deleted server-side. The worker now sends
 * `no-cache` (see IMAGE_CACHE_HEADERS there), but that only governs
 * responses it still gets asked for — an entry already stored as
 * immutable is unreachable by any header, and a *different URL* is the
 * only thing that dislodges it. Bumping this number gives every word a
 * cache key no browser has an old entry under. Nothing should need to
 * bump it again now that the endpoint revalidates. */
const IMAGE_CACHE_BUST = 2;

/** URL for a root word's cached illustration — 404s until one's been
 * uploaded (see mountImageSlots). Images are global/shared, not per
 * sync ID — the same word always gets the same picture for everyone,
 * from whoever generated and uploaded it first. */
export function imageUrlFor(word) {
  return `${WORKER_URL}/image/${encodeURIComponent(word)}?v=${IMAGE_CACHE_BUST}`;
}

/** Pictures fetched before anything asks to display them, keyed by
 * word. Holding the Image objects matters as much as firing the
 * requests: a browser keeps a decoded copy alive while one is
 * referenced, so revealing an answer paints from memory instead of
 * re-reading and re-decoding the file — and since the endpoint answers
 * `no-cache` (see the worker), an unreferenced picture would still owe
 * a revalidation round-trip at the moment it's needed, which is the
 * moment this exists to protect. Bounded, because a long session
 * touches every root in the deck and a decoded bitmap is far larger
 * than the file it came from. */
const PRELOAD_LIMIT = 24;
const preloaded = new Map();

/** Starts loading these roots' pictures now, so that a card whose
 * illustration only appears on "Show answer" (see app.js) has it ready
 * the instant it's revealed rather than beginning the download then.
 * Words with no picture uploaded yet simply 404 and cost nothing. */
export function preloadImages(words) {
  for (const word of words) {
    if (preloaded.has(word)) continue;
    const img = new Image();
    img.src = imageUrlFor(word);
    preloaded.set(word, img);
    // Map iterates in insertion order, so the first key is the oldest.
    if (preloaded.size > PRELOAD_LIMIT) preloaded.delete(preloaded.keys().next().value);
  }
}

/** Text to copy into Gemini (or any other image generator) — this app
 * never calls an image-generation API itself (see README's "Root word
 * images": every free option tried either had no usable free tier or,
 * worse, produced unsafe content unprompted), so generating is a
 * manual step: copy this prompt, generate elsewhere, paste/upload the
 * result back in. */
export function geminiPromptFor(word, definition) {
  const gloss = definition || 'no definition on file';
  return `A simple, clear illustration representing the Scrabble word "${word}": ${gloss}. Plain background, no text, no watermark.`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Placeholder markup for a root's illustration slot — inert until
 * mountImageSlots (below) finds it in the DOM and wires it up. Callers
 * that build HTML via innerHTML should include this, then call
 * mountImageSlots() on the container right after setting it. */
export function imageSlotHtml(word, definition) {
  return `
    <div class="wd-image-wrap" data-image-word="${escapeAttr(word)}" data-image-definition="${escapeAttr(definition || '')}">
      <div class="wd-image-checking"></div>
    </div>
  `;
}

/** Whether the one-tap "Paste image" button is worth showing. The
 * async clipboard API is the only way to *pull* an image off the
 * clipboard on a phone; without it the only paste route is the
 * browser's own long-press menu over an editable element (see
 * PASTE_ZONE_HINT). Secure-context only, which the deployed site is. */
const CAN_READ_CLIPBOARD = typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

const PASTE_ZONE_HINT = CAN_READ_CLIPBOARD
  ? 'or long-press here and pick Paste'
  : 'Tap here, then paste an image';

function missingStateHtml() {
  return `
    <div class="wd-image-add">
      <button type="button" class="wd-image-copy-btn secondary">Copy Gemini prompt</button>
      ${CAN_READ_CLIPBOARD ? '<button type="button" class="wd-image-paste-btn secondary">Paste image</button>' : ''}
      <div
        class="wd-image-paste-zone"
        contenteditable="true"
        role="textbox"
        spellcheck="false"
        aria-label="Paste an image here"
        data-placeholder="${escapeAttr(PASTE_ZONE_HINT)}"
      ></div>
      <button type="button" class="wd-image-choose-btn secondary">Choose a file</button>
      <input type="file" accept="image/*" class="wd-image-file-input" hidden />
      <p class="wd-image-upload-status"></p>
    </div>
  `;
}

/** Pulls whatever image is on the clipboard and uploads it — the phone
 * path, where there's no Ctrl+V and the long-press menu is the only
 * alternative. Must call navigator.clipboard.read() *before* awaiting
 * anything else: Safari only honours it while the tap that triggered it
 * still counts as user activation, and an intervening await spends
 * that. */
async function pasteFromClipboard(wrapEl) {
  const statusEl = wrapEl.querySelector('.wd-image-upload-status');
  const word = wrapEl.dataset.imageWord;
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    // NotAllowedError covers both a denied permission prompt and a
    // gesture the browser decided had expired; neither is worth a
    // stack trace at someone trying to add a picture.
    statusEl.textContent =
      err.name === 'NotAllowedError'
        ? "⚠️ The browser wouldn't share the clipboard. Long-press the box below and pick Paste, or choose a file."
        : `⚠️ Couldn't read the clipboard: ${err.message}`;
    return;
  }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    await uploadImage(word, await item.getType(type), wrapEl);
    return;
  }
  statusEl.textContent = 'No image on the clipboard — copy one in Gemini first.';
}

/** Recovers an image that a paste dropped into the editable box as
 * markup rather than handing over on the event. Safari in particular
 * will happily insert an <img src="blob:..."> and leave
 * clipboardData.items empty, so the picture is *there*, just not where
 * the paste handler looked for it. */
async function imageFromPasteZone(zoneEl) {
  const img = zoneEl.querySelector('img');
  if (!img?.src) return null;
  try {
    const res = await fetch(img.src);
    const blob = await res.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}

async function uploadImage(word, file, wrapEl) {
  const statusEl = wrapEl.querySelector('.wd-image-upload-status');
  if (statusEl) statusEl.textContent = 'Uploading…';
  try {
    const res = await fetch(imageUrlFor(word), {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `upload failed (HTTP ${res.status})`);
    }
    showImage(wrapEl, URL.createObjectURL(file));
  } catch (err) {
    console.error('Image upload failed:', err);
    if (statusEl) statusEl.textContent = `⚠️ ${err.message}`;
  }
}

function wireMissing(wrapEl) {
  const word = wrapEl.dataset.imageWord;
  const definition = wrapEl.dataset.imageDefinition;

  const copyBtn = wrapEl.querySelector('.wd-image-copy-btn');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(geminiPromptFor(word, definition));
      copyBtn.textContent = 'Copied!';
    } catch {
      copyBtn.textContent = "Couldn't copy";
    }
    setTimeout(() => {
      copyBtn.textContent = 'Copy Gemini prompt';
    }, 1500);
  });

  const pasteBtn = wrapEl.querySelector('.wd-image-paste-btn');
  if (pasteBtn) pasteBtn.addEventListener('click', () => pasteFromClipboard(wrapEl));

  const fileInput = wrapEl.querySelector('.wd-image-file-input');
  wrapEl.querySelector('.wd-image-choose-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) uploadImage(word, file, wrapEl);
  });

  const zone = wrapEl.querySelector('.wd-image-paste-zone');
  zone.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      uploadImage(word, item.getAsFile(), wrapEl);
      return;
    }
    // Nothing usable on the event itself — but the box is editable, so
    // the paste may still land in it as markup a tick from now (see
    // imageFromPasteZone). Let it, look again, then empty the box
    // either way so a stray screenful of pasted text can't sit there
    // looking like it did something.
    setTimeout(async () => {
      const blob = await imageFromPasteZone(zone);
      zone.replaceChildren();
      if (blob) uploadImage(word, blob, wrapEl);
    }, 0);
  });
  // Enter in a contenteditable inserts a newline, which does nothing
  // here but push the hint text around.
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
}

function showMissing(wrapEl) {
  wrapEl.classList.remove('wd-image-loaded');
  wrapEl.classList.add('wd-image-missing');
  wrapEl.innerHTML = missingStateHtml();
  wireMissing(wrapEl);
}

/** Full-screen viewer for one picture. A slot is 110-160px wide, which
 * suits the plain illustration the prompt asks for but not what an
 * image model often returns for an abstract definition — a labelled
 * diagram, where the labels are the whole value and are illegible that
 * small. One overlay is built once and reused, since only one picture
 * can be open at a time. */
let lightboxEl = null;

function closeLightbox() {
  if (lightboxEl) lightboxEl.hidden = true;
}

function openLightbox(src) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'wd-lightbox';
    lightboxEl.hidden = true;
    lightboxEl.innerHTML = `
      <img alt="" />
      <button type="button" class="wd-lightbox-close secondary" aria-label="Close">×</button>
    `;
    // Tapping the backdrop (or the close button) leaves; tapping the
    // picture switches between fit-to-screen and its real size, which
    // is the only way to actually read a diagram's labels on a phone.
    lightboxEl.addEventListener('click', closeLightbox);
    lightboxEl.querySelector('img').addEventListener('click', (e) => {
      e.stopPropagation();
      lightboxEl.classList.toggle('wd-lightbox-actual');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
    document.body.appendChild(lightboxEl);
  }
  lightboxEl.querySelector('img').src = src;
  // Always open fitted, whatever the last picture was left as.
  lightboxEl.classList.remove('wd-lightbox-actual');
  lightboxEl.scrollTo(0, 0);
  lightboxEl.hidden = false;
}

function showImage(wrapEl, src) {
  wrapEl.classList.remove('wd-image-missing');
  wrapEl.classList.add('wd-image-loaded');
  wrapEl.innerHTML = `
    <img class="wd-image" src="${src}" alt="" />
    <button type="button" class="wd-image-replace-btn secondary">Replace image</button>
  `;
  wrapEl.querySelector('.wd-image').addEventListener('click', () => openLightbox(src));
  wrapEl.querySelector('.wd-image-replace-btn').addEventListener('click', () => showMissing(wrapEl));
}

/** Finds every image slot placeholder (see imageSlotHtml) inside `root`
 * and brings it to life: checks whether a picture already exists for
 * that word, then shows either the picture (with a way to replace it)
 * or the copy-prompt/paste-a-picture flow. Call this once right after
 * setting innerHTML on anything that might contain image slots. */
export function mountImageSlots(root) {
  for (const wrapEl of root.querySelectorAll('[data-image-word]')) {
    const word = wrapEl.dataset.imageWord;
    // A preload that has already settled has answered the very
    // question the probe below exists to ask, so don't ask it again:
    // whether the picture loaded or 404'd is readable straight off it.
    // Saves a request, and more to the point saves the round-trip's
    // worth of blank slot between revealing an answer and seeing the
    // picture, which is the whole reason for preloading.
    const ready = preloaded.get(word);
    if (ready && ready.complete) {
      if (ready.naturalWidth > 0) showImage(wrapEl, ready.src);
      else showMissing(wrapEl);
      continue;
    }
    const probe = new Image();
    probe.onload = () => showImage(wrapEl, imageUrlFor(word));
    probe.onerror = () => showMissing(wrapEl);
    probe.src = imageUrlFor(word);
  }
}
