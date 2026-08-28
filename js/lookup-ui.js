import { getWordInfo, queueWord, describeStorageQuota } from './store.js';
import { scheduleSync } from './sync.js';
import { imageSlotHtml, mountImageSlots } from './images.js';
import { imageSubjectFor } from './dictionary.js';

const CARD_TYPE_LABELS = {
  word2def: 'Word → Definition',
  def2word: 'Definition → Word',
  jumble: 'Jumble',
  endings: 'Endings',
};

function renderRoot(r) {
  const definition =
    r.senses.length > 0 ? r.senses.map((s) => `${s.definition} (${s.pos})`).join(' / ') : 'No definition on file.';
  const inflections = r.inflections.length > 0 ? r.inflections.join(', ') : '—';
  // imageSubjectFor's definition may be enriched beyond the raw senses
  // text above (see dictionary.js) — fine for the image prompt, which
  // doesn't need to match the displayed definition word-for-word.
  const imageSubject = r.senses.length > 0 ? imageSubjectFor(r.root) : null;
  const imageMarkup = imageSubject ? imageSlotHtml(r.root, imageSubject.definition) : '';
  return `
    <div class="lookup-root">
      <div class="lookup-root-name">${r.root}</div>
      <div class="lookup-definition">${definition}</div>
      ${imageMarkup}
      <div class="lookup-inflections"><span class="lookup-label">Conjugations/plurals</span> ${inflections}</div>
    </div>
  `;
}

function renderStats(cards) {
  if (cards.length === 0) return '<p class="lookup-muted">No flashcards yet for this word.</p>';
  const rows = cards
    .map((c) => {
      const label = CARD_TYPE_LABELS[c.type] || c.type;
      const status = c.phase === 'intro' ? 'Learning' : 'Reviewing';
      return `<div class="lookup-stat-row"><span>${label}</span><span>${status} · ${c.lapses} miss${
        c.lapses === 1 ? '' : 'es'
      }</span></div>`;
    })
    .join('');
  return `<div class="lookup-stat-list">${rows}</div>`;
}

/** The "?" word lookup panel: type any word to see its definition,
 * conjugations/plurals, and your quizzing stats on it — or, if it isn't
 * in your deck yet, an "Add" button that queues it the same way as
 * typing it used to via the old standalone "Add word" button. */
export function initLookupUI(buttonEl, modalRootEl) {
  let open = false;
  let word = '';
  let info = null;
  let message = '';

  function close() {
    open = false;
    modalRootEl.innerHTML = '';
  }

  function refresh(newWord) {
    word = newWord;
    info = word ? getWordInfo(word) : null;
    render();
  }

  function renderBody() {
    if (!word) return '';
    if (!info.exists) {
      return `<p class="lookup-phony">PHONY — not in the Scrabble dictionary.</p>`;
    }
    const rootsHtml = info.roots.map(renderRoot).join('');
    const statsHtml = info.added
      ? renderStats(info.cards)
      : `<button id="lookup-add-btn" type="button" class="secondary">Add ${info.word}</button>`;
    const messageHtml = message ? `<p class="lookup-message">${message}</p>` : '';
    return `${rootsHtml}<div class="lookup-stats">${statsHtml}</div>${messageHtml}`;
  }

  function render() {
    if (!open) {
      modalRootEl.innerHTML = '';
      return;
    }
    modalRootEl.innerHTML = `
      <div class="lookup-overlay">
        <div class="lookup-dialog">
          <div class="lookup-top">
            <form id="lookup-form" class="lookup-form">
              <input id="lookup-input" type="text" placeholder="a Scrabble word" value="${word}" autocapitalize="off" autocorrect="off" spellcheck="false" />
              <button type="submit">Look up</button>
            </form>
            <button id="lookup-close" class="secondary" type="button" aria-label="Close">✕</button>
          </div>
          <div class="lookup-body">${renderBody()}</div>
        </div>
      </div>
    `;
    mountImageSlots(modalRootEl);

    const overlay = modalRootEl.querySelector('.lookup-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    modalRootEl.querySelector('#lookup-close').addEventListener('click', close);
    modalRootEl.querySelector('#lookup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      message = '';
      refresh(modalRootEl.querySelector('#lookup-input').value);
    });

    const addBtn = modalRootEl.querySelector('#lookup-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        try {
          const result = await queueWord(word);
          if (result.ok) scheduleSync();
          message = result.ok
            ? `Queued ${result.word} — it'll be added next time we earn more words.`
            : result.message;
        } catch (err) {
          console.error('Queueing word failed:', err);
          const advice = err.quotaExceeded ? '' : ' Try reloading the page.';
          message = `⚠️ Couldn't queue that word: ${err.message}.${advice}`;
          if (err.quotaExceeded) {
            const forWord = word;
            const baseMessage = message;
            describeStorageQuota().then((info) => {
              if (!info || word !== forWord || message !== baseMessage) return;
              message = `${baseMessage} (${info})`;
              refresh(word);
            });
          }
        }
        refresh(word);
      });
    }

    const input = modalRootEl.querySelector('#lookup-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  buttonEl.addEventListener('click', () => {
    open = true;
    word = '';
    info = null;
    message = '';
    render();
  });
}
