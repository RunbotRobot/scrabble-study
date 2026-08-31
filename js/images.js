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

function showImage(wrapEl, src) {
  wrapEl.classList.remove('wd-image-missing');
  wrapEl.classList.add('wd-image-loaded');
  wrapEl.innerHTML = `
    <img class="wd-image" src="${src}" alt="" />
    <button type="button" class="wd-image-replace-btn secondary">Replace image</button>
  `;
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
    const probe = new Image();
    probe.onload = () => showImage(wrapEl, imageUrlFor(word));
    probe.onerror = () => showMissing(wrapEl);
    probe.src = imageUrlFor(word);
  }
}
