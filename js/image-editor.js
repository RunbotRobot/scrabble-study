/**
 * A three-tool paint kit for painting the word out of a picture.
 *
 * Image generators keep printing the word across the top of the
 * illustration however firmly the prompt asks them not to, which hands
 * you the answer on a def2word card. Nothing here can detect that
 * automatically — the browser's own TextDetector has been removed from
 * Chrome, and a WASM OCR build is both a multi-megabyte dependency and
 * useless on the stylised lettering these actually produce — so the
 * tools are manual: pick the background colour, paint over the text,
 * save.
 *
 * The interaction that matters is the eraser's, and it exists because
 * a fingertip covers the very thing it is trying to erase. Offsetting
 * the brush from the finger by a fixed amount only moves the problem:
 * you then have to guess where the brush is before the first stroke
 * lands. So placement and movement are separated. Tapping the picture
 * puts the brush exactly where you tapped — no offset, nothing to
 * judge — and a handle then appears a thumb's width away. Dragging
 * that handle moves the brush with it, so throughout the stroke the
 * brush is somewhere you can see and the finger is somewhere you
 * don't care about.
 */

/** How far the drag handle sits from the brush, in CSS pixels. Enough
 * to clear a fingertip and the visual bulk of a hand. */
const HANDLE_OFFSET = 76;

/** Full-resolution snapshots are held for undo, and each one is
 * width x height x 4 bytes — around 2MB for a typical picture. Six is
 * enough to walk back a bad stroke or two without putting a phone
 * under memory pressure. */
const MAX_UNDO = 6;

/** How far a pixel may stray from the one you tapped and still count
 * as the same region for the fill tool. Generous enough to take a
 * whole slightly-noisy background, tight enough to stop at the edge of
 * the lettering sitting on it. */
const FILL_TOLERANCE = 40;

/** Past this, a PNG of the edited canvas is re-encoded as JPEG rather
 * than pushed at the upload endpoint's 8MB ceiling. PNG is preferred
 * because these edits are flat fills, which JPEG rings badly. */
const PNG_SIZE_LIMIT = 4 * 1024 * 1024;

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // A stored picture is served from the worker, so the canvas would
    // be tainted — and toBlob() would throw at the end of the edit —
    // without an explicit CORS request. The endpoint already sends
    // Access-Control-Allow-Origin (see worker/index.js).
    if (typeof source === 'string') img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load that picture'));
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Replaces the contiguous region of similarly-coloured pixels around
 * (x, y) with `rgb`. Iterative with a typed-array stack of pixel
 * indices: a recursive fill blows the stack on any real picture, and
 * an array of [x, y] pairs spends more time allocating than filling. */
function floodFill(ctx, width, height, x, y, rgb) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const start = (y * width + x) * 4;
  const target = [data[start], data[start + 1], data[start + 2]];
  if (target[0] === rgb[0] && target[1] === rgb[1] && target[2] === rgb[2]) return;

  const matches = (i) =>
    Math.abs(data[i] - target[0]) <= FILL_TOLERANCE &&
    Math.abs(data[i + 1] - target[1]) <= FILL_TOLERANCE &&
    Math.abs(data[i + 2] - target[2]) <= FILL_TOLERANCE;

  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = y * width + x;

  while (top > 0) {
    const p = stack[--top];
    if (seen[p]) continue;
    const i = p * 4;
    if (!matches(i)) continue;
    seen[p] = 1;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
    const px = p % width;
    if (px > 0) stack[top++] = p - 1;
    if (px < width - 1) stack[top++] = p + 1;
    if (p >= width) stack[top++] = p - width;
    if (p < width * (height - 1)) stack[top++] = p + width;
  }
  ctx.putImageData(image, 0, 0);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size <= PNG_SIZE_LIMIT) return resolve(blob);
      canvas.toBlob((jpeg) => resolve(jpeg || blob), 'image/jpeg', 0.92);
    }, 'image/png');
  });
}

/**
 * Opens the editor over the page for `source` (a Blob/File, or the URL
 * of an already-stored picture). Resolves with the edited picture as a
 * Blob, or null if it was closed without saving.
 */
export function openImageEditor(source, { title = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', 'ie-overlay');
    overlay.innerHTML = `
      <div class="ie-bar ie-tools">
        <button type="button" class="ie-tool secondary" data-tool="erase">Erase</button>
        <button type="button" class="ie-tool secondary" data-tool="pick">Pick colour</button>
        <button type="button" class="ie-tool secondary" data-tool="fill">Fill</button>
        <span class="ie-swatch" title="Current colour"></span>
        <button type="button" class="ie-undo secondary" disabled>Undo</button>
      </div>
      <div class="ie-stage">
        <canvas class="ie-canvas"></canvas>
        <div class="ie-brush" hidden></div>
        <div class="ie-handle" hidden></div>
      </div>
      <div class="ie-bar ie-bottom">
        <label class="ie-size">Size <input type="range" min="4" max="160" value="36" /></label>
        <div class="ie-actions">
          <button type="button" class="ie-cancel secondary">Cancel</button>
          <button type="button" class="ie-save">Use picture</button>
        </div>
      </div>
      <p class="ie-hint"></p>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.ie-canvas');
    const stage = overlay.querySelector('.ie-stage');
    const brushEl = overlay.querySelector('.ie-brush');
    const handleEl = overlay.querySelector('.ie-handle');
    const swatchEl = overlay.querySelector('.ie-swatch');
    const undoBtn = overlay.querySelector('.ie-undo');
    const sizeInput = overlay.querySelector('.ie-size input');
    const hintEl = overlay.querySelector('.ie-hint');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let tool = null;
    let colour = [255, 255, 255];
    let brush = null; // { x, y } in CSS px within the stage
    let handleBelow = true;
    const undoStack = [];

    function setHint(text) {
      hintEl.textContent = text;
    }

    function finish(value) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') finish(null);
    }
    document.addEventListener('keydown', onKey);

    // --- coordinate helpers -------------------------------------------
    // The canvas is displayed at whatever size fits the screen, so every
    // CSS-pixel position has to be scaled into the picture's own pixels
    // before anything is painted with it.
    function scale() {
      const rect = canvas.getBoundingClientRect();
      return { k: canvas.width / rect.width, rect };
    }
    function toStage(clientX, clientY) {
      const s = stage.getBoundingClientRect();
      return { x: clientX - s.left, y: clientY - s.top };
    }
    function stageToCanvas(p) {
      const { k, rect } = scale();
      const s = stage.getBoundingClientRect();
      return { x: (p.x - (rect.left - s.left)) * k, y: (p.y - (rect.top - s.top)) * k };
    }
    function overCanvas(p) {
      const { rect } = scale();
      const s = stage.getBoundingClientRect();
      const left = rect.left - s.left;
      const top = rect.top - s.top;
      return p.x >= left && p.x <= left + rect.width && p.y >= top && p.y <= top + rect.height;
    }

    // --- undo ----------------------------------------------------------
    function snapshot() {
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      undoBtn.disabled = false;
    }
    undoBtn.addEventListener('click', () => {
      const last = undoStack.pop();
      if (last) ctx.putImageData(last, 0, 0);
      undoBtn.disabled = undoStack.length === 0;
    });

    // --- brush visuals -------------------------------------------------
    function brushPx() {
      return Number(sizeInput.value);
    }
    function placeHandle() {
      // Below the brush normally, above it when the brush is near the
      // bottom, so the handle can't end up off the bottom of the screen
      // where it can't be dragged.
      handleBelow = brush.y + HANDLE_OFFSET < stage.clientHeight - 8;
      handleEl.style.left = `${brush.x}px`;
      handleEl.style.top = `${brush.y + (handleBelow ? HANDLE_OFFSET : -HANDLE_OFFSET)}px`;
    }
    function drawBrush() {
      if (!brush) {
        brushEl.hidden = true;
        handleEl.hidden = true;
        return;
      }
      const d = brushPx();
      brushEl.hidden = false;
      brushEl.style.width = `${d}px`;
      brushEl.style.height = `${d}px`;
      brushEl.style.left = `${brush.x}px`;
      brushEl.style.top = `${brush.y}px`;
      handleEl.hidden = tool !== 'erase';
      if (tool === 'erase') placeHandle();
    }
    sizeInput.addEventListener('input', drawBrush);

    // --- painting ------------------------------------------------------
    function dab(from, to) {
      const a = stageToCanvas(from);
      const b = stageToCanvas(to);
      const { k } = scale();
      ctx.strokeStyle = rgbCss(colour);
      ctx.fillStyle = rgbCss(colour);
      ctx.lineWidth = brushPx() * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    function pickAt(p) {
      const c = stageToCanvas(p);
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(c.x)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(c.y)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      colour = [d[0], d[1], d[2]];
      swatchEl.style.background = rgbCss(colour);
      setHint(`Colour picked: ${rgbCss(colour)}`);
    }

    function fillAt(p) {
      const c = stageToCanvas(p);
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(c.x)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(c.y)));
      snapshot();
      floodFill(ctx, canvas.width, canvas.height, x, y, colour);
    }

    // --- tools ---------------------------------------------------------
    function setTool(next) {
      tool = next;
      brush = null;
      drawBrush();
      for (const b of overlay.querySelectorAll('.ie-tool')) {
        b.classList.toggle('ie-tool-on', b.dataset.tool === tool);
      }
      setHint(
        tool === 'erase'
          ? 'Tap the picture where you want to start. Then drag the handle below it.'
          : tool === 'pick'
            ? 'Tap a colour in the picture to paint with.'
            : tool === 'fill'
              ? 'Tap an area to flood it with the current colour.'
              : ''
      );
    }
    for (const btn of overlay.querySelectorAll('.ie-tool')) {
      // Tapping the active tool again turns it off, which is one of the
      // ways out of erasing.
      btn.addEventListener('click', () => setTool(btn.dataset.tool === tool ? null : btn.dataset.tool));
    }

    // --- pointer handling ----------------------------------------------
    let stroke = null; // { last } while painting
    let drag = null; // { startPointer, startBrush } while dragging the handle

    handleEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEl.setPointerCapture(e.pointerId);
      drag = { pointer: toStage(e.clientX, e.clientY), brush: { ...brush } };
      snapshot();
    });

    stage.addEventListener('pointerdown', (e) => {
      const p = toStage(e.clientX, e.clientY);
      if (!overCanvas(p)) {
        // Tapping off the picture puts the eraser away, as does the
        // tool button — both listed as ways to stop.
        brush = null;
        drawBrush();
        return;
      }
      if (tool === 'pick') return pickAt(p);
      if (tool === 'fill') return fillAt(p);
      if (tool !== 'erase') return;
      // Placement is exact: the brush lands where the tap landed, so
      // there is no offset to judge before the first mark is made.
      brush = p;
      snapshot();
      dab(p, p);
      drawBrush();
      stroke = { last: p };
      stage.setPointerCapture(e.pointerId);
    });

    stage.addEventListener('pointermove', (e) => {
      const p = toStage(e.clientX, e.clientY);
      if (drag) {
        const next = {
          x: drag.brush.x + (p.x - drag.pointer.x),
          y: drag.brush.y + (p.y - drag.pointer.y),
        };
        dab(brush, next);
        brush = next;
        drawBrush();
        return;
      }
      if (stroke) {
        dab(stroke.last, p);
        stroke.last = p;
        brush = p;
        drawBrush();
      }
    });

    function endPointer() {
      stroke = null;
      drag = null;
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    handleEl.addEventListener('pointerup', endPointer);
    handleEl.addEventListener('pointercancel', endPointer);

    // --- actions ---------------------------------------------------------
    overlay.querySelector('.ie-cancel').addEventListener('click', () => finish(null));
    overlay.querySelector('.ie-save').addEventListener('click', async () => {
      const blob = await canvasToBlob(canvas);
      finish(blob);
    });

    // --- go ---------------------------------------------------------------
    loadImage(source).then(
      (img) => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        // A corner pixel is very nearly always the flat background these
        // titles are printed on, so it is a better starting colour than
        // white and often the only one needed.
        const d = ctx.getImageData(0, 0, 1, 1).data;
        colour = [d[0], d[1], d[2]];
        swatchEl.style.background = rgbCss(colour);
        setTool('erase');
        overlay.dataset.ready = 'true';
      },
      (err) => {
        setHint(`⚠️ ${err.message}`);
        overlay.dataset.ready = 'error';
      }
    );

    if (title) overlay.setAttribute('aria-label', `Editing the picture for ${title}`);
  });
}
