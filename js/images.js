import { WORKER_URL } from './sync.js';

/** URL for a root word's cached illustration — 404s until one's been
 * uploaded (see mountImageSlots). Images are global/shared, not per
 * sync ID — the same word always gets the same picture for everyone,
 * from whoever generated and uploaded it first. */
export function imageUrlFor(word) {
  return `${WORKER_URL}/image/${encodeURIComponent(word)}`;
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

function missingStateHtml() {
  return `
    <div class="wd-image-add">
      <button type="button" class="wd-image-copy-btn secondary">Copy Gemini prompt</button>
      <div class="wd-image-paste-zone" tabindex="0">Click here, then paste an image (Ctrl+V)</div>
      <button type="button" class="wd-image-choose-btn secondary">Choose a file</button>
      <input type="file" accept="image/*" class="wd-image-file-input" hidden />
      <p class="wd-image-upload-status"></p>
    </div>
  `;
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

  const fileInput = wrapEl.querySelector('.wd-image-file-input');
  wrapEl.querySelector('.wd-image-choose-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) uploadImage(word, file, wrapEl);
  });

  wrapEl.querySelector('.wd-image-paste-zone').addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    uploadImage(word, item.getAsFile(), wrapEl);
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
