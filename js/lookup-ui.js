import { getWordInfo, queueWord, describeStorageQuota, searchByDefinition } from './store.js';
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

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One hit from a definition search: the word, why it matched, and
 * whether it's already in your deck. A button rather than a link — it
 * hands the word to the lookup view in the same panel, which already
 * knows how to show a definition, conjugations, a picture and your
 * stats on it. */
function renderSearchHit(hit) {
  const definition = hit.senses.map((s) => `${escapeHtml(s.definition)} (${escapeHtml(s.pos)})`).join(' / ');
  const badge = hit.inDeck ? '<span class="search-badge">in deck</span>' : '';
  return `
    <button type="button" class="search-hit" data-word="${escapeHtml(hit.root)}">
      <span class="search-hit-word">${escapeHtml(hit.root)}${badge}</span>
      <span class="search-hit-def">${definition}</span>
    </button>
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

/** The lookup panel, which works in both directions.
 *
 * In word mode ("?"): type any word to see its definition,
 * conjugations/plurals, and your quizzing stats on it — or, if it isn't
 * in your deck yet, an "Add" button that queues it the same way as
 * typing it used to via the old standalone "Add word" button.
 *
 * In search mode ("🔎"): type words from a definition to get back the
 * words that match, optionally only the ones in your deck. The two
 * share this panel rather than sitting in separate ones because they
 * are two ends of the same question: picking a search hit switches to
 * word mode for it, which is the view that can already answer "so what
 * is this word, and am I studying it?" — and a Back button returns to
 * the results, since scanning a list is the point of searching. */
export function initLookupUI(buttonEl, modalRootEl, searchButtonEl) {
  let open = false;
  let mode = 'word';
  let word = '';
  let info = null;
  let message = '';
  let query = '';
  // Kept across searches within a session: someone narrowing to their
  // own words is usually about to do it again.
  let deckOnly = false;
  let searchResult = null;
  let cameFromSearch = false;

  function close() {
    open = false;
    modalRootEl.innerHTML = '';
  }

  function refresh(newWord) {
    word = newWord;
    info = word ? getWordInfo(word) : null;
    render();
  }

  function renderSearchBody() {
    if (!searchResult) return '<p class="lookup-muted">Type a word or two from a definition.</p>';
    if (searchResult.results.length === 0) {
      return `<p class="lookup-muted">Nothing matches “${escapeHtml(query)}”${
        deckOnly ? ' among the words in your deck' : ''
      }.</p>`;
    }
    const count = searchResult.truncated
      ? `${searchResult.results.length} of ${searchResult.total} matches`
      : `${searchResult.total} match${searchResult.total === 1 ? '' : 'es'}`;
    return `
      <p class="lookup-muted">${count}</p>
      <div class="search-hits">${searchResult.results.map(renderSearchHit).join('')}</div>
    `;
  }

  function renderBody() {
    if (mode === 'search') return renderSearchBody();
    if (!word) return '';
    if (!info.exists) {
      return `<p class="lookup-phony">PHONY — not in the Scrabble dictionary.</p>`;
    }
    const rootsHtml = info.roots.map(renderRoot).join('');
    const statsHtml = info.added
      ? renderStats(info.cards)
      : `<button id="lookup-add-btn" type="button" class="secondary">Add ${info.word}</button>`;
    const messageHtml = message ? `<p class="lookup-message">${message}</p>` : '';
    const backHtml = cameFromSearch
      ? '<button type="button" id="lookup-back" class="secondary">← Back to results</button>'
      : '';
    return `${backHtml}${rootsHtml}<div class="lookup-stats">${statsHtml}</div>${messageHtml}`;
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
            ${
              mode === 'search'
                ? `<form id="search-form" class="lookup-form">
                     <input id="search-input" type="text" placeholder="words from a definition" value="${escapeHtml(query)}" autocapitalize="off" autocorrect="off" spellcheck="false" />
                     <button type="submit">Search</button>
                   </form>`
                : `<form id="lookup-form" class="lookup-form">
                     <input id="lookup-input" type="text" placeholder="a Scrabble word" value="${escapeHtml(word)}" autocapitalize="off" autocorrect="off" spellcheck="false" />
                     <button type="submit">Look up</button>
                   </form>`
            }
            <button id="lookup-close" class="secondary" type="button" aria-label="Close">✕</button>
          </div>
          ${
            mode === 'search'
              ? `<label class="search-scope">
                   <input type="checkbox" id="search-deck-only" ${deckOnly ? 'checked' : ''} />
                   Only words in my collection
                 </label>`
              : ''
          }
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

    const lookupForm = modalRootEl.querySelector('#lookup-form');
    if (lookupForm) {
      lookupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        message = '';
        cameFromSearch = false;
        refresh(modalRootEl.querySelector('#lookup-input').value);
      });
    }

    const searchForm = modalRootEl.querySelector('#search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        runSearch(modalRootEl.querySelector('#search-input').value);
      });
    }

    const deckOnlyEl = modalRootEl.querySelector('#search-deck-only');
    if (deckOnlyEl) {
      deckOnlyEl.addEventListener('change', () => {
        deckOnly = deckOnlyEl.checked;
        // Re-run rather than filter what's on screen: narrowing the
        // scan can surface matches the unfiltered top-100 cut off.
        if (searchResult) runSearch(query);
        else render();
      });
    }

    for (const hit of modalRootEl.querySelectorAll('.search-hit')) {
      hit.addEventListener('click', () => {
        mode = 'word';
        message = '';
        cameFromSearch = true;
        refresh(hit.dataset.word);
      });
    }

    const backBtn = modalRootEl.querySelector('#lookup-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        mode = 'search';
        cameFromSearch = false;
        render();
      });
    }

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

    const input = modalRootEl.querySelector('#lookup-input') || modalRootEl.querySelector('#search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function runSearch(rawQuery) {
    query = rawQuery;
    searchResult = query.trim().length >= 2 ? searchByDefinition(query, { deckOnly }) : null;
    render();
  }

  buttonEl.addEventListener('click', () => {
    open = true;
    mode = 'word';
    word = '';
    info = null;
    message = '';
    cameFromSearch = false;
    render();
  });

  if (searchButtonEl) {
    searchButtonEl.addEventListener('click', () => {
      open = true;
      mode = 'search';
      message = '';
      cameFromSearch = false;
      render();
    });
  }
}
