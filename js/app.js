import { loadDictionary } from './dictionary.js';
import { generateIntroBatch, getNextCard, answerCard, getStats, getDeckAnagramSolutions } from './store.js';
import { getStreak, recordAnswer, MILESTONE_EVERY } from './streak.js';
import { startBackgroundSync, scheduleSync, onStatusChange, getSyncId } from './sync.js';
import { initSyncUI } from './sync-ui.js';
import { initLookupUI } from './lookup-ui.js';

const statsEl = document.getElementById('stats');
const milestoneMessageEl = document.getElementById('milestone-message');
const studyCard = document.getElementById('study-card');
const syncPanelEl = document.getElementById('sync-panel');
const lookupBtnEl = document.getElementById('lookup-btn');
const lookupModalEl = document.getElementById('lookup-modal-root');
const optionsBtnEl = document.getElementById('options-btn');
const optionsModalEl = document.getElementById('options-modal-root');
const optionsCloseEl = document.getElementById('options-close');

function closeOptions() {
  optionsModalEl.hidden = true;
}

optionsBtnEl.addEventListener('click', () => {
  optionsModalEl.hidden = false;
});
optionsCloseEl.addEventListener('click', closeOptions);
optionsModalEl.addEventListener('click', (e) => {
  if (e.target === optionsModalEl) closeOptions();
});
lookupBtnEl.addEventListener('click', closeOptions);

function refreshStats() {
  const stats = getStats();
  statsEl.innerHTML = `
    <div><dt>Words selected</dt><dd>${stats.selectedRootCount.toLocaleString()}</dd></div>
    <div><dt>Total cards</dt><dd>${stats.totalCards.toLocaleString()}</dd></div>
    ${stats.introducing > 0 ? `<div><dt>Introducing</dt><dd>${stats.introducing.toLocaleString()}</dd></div>` : ''}
    ${stats.recentlyWrong > 0 ? `<div><dt>Recently wrong</dt><dd>${stats.recentlyWrong.toLocaleString()}/50</dd></div>` : ''}
    ${stats.queuedWords > 0 ? `<div><dt>Queued</dt><dd>${stats.queuedWords.toLocaleString()}</dd></div>` : ''}
    <div><dt>Streak</dt><dd>${getStreak().toLocaleString()}</dd></div>
  `;
}

function renderJumbleTiles(card) {
  const tiles = [...card.prompt].map((ch) => `<span class="tile">${ch}</span>`).join('');
  return `<div class="jumble-tiles">${tiles}</div>`;
}

/** The small label above a card, if any — only needed for card types that
 * would otherwise be visually ambiguous (a jumble looks like a jumble
 * regardless, but an endings card shares its layout with word2def, so it
 * needs a label to tell you what kind of answer to prepare). */
function typeLineFor(card, introRemaining) {
  const introNote = card.phase === 'intro' ? `New (${introRemaining} left)` : '';
  if (card.type === 'jumble') {
    const solutions = getDeckAnagramSolutions(card.prompt);
    const solutionNote = `${solutions.length} solution${solutions.length === 1 ? '' : 's'}`;
    return `<div class="card-type">${['Jumble', introNote, solutionNote].filter(Boolean).join(' · ')}</div>`;
  }
  if (card.type === 'endings') {
    return `<div class="card-type">${['Endings', introNote].filter(Boolean).join(' · ')}</div>`;
  }
  return '';
}

/** A fixed, content-independent placeholder standing in for a hidden
 * answer. Deliberately not derived from the real text at all (not even
 * via CSS blur on it) — same shape every time, so nothing about the
 * actual word or definition (least of all its length) is visible before
 * "Show answer". `kind` only picks a shape that reads as "a word" vs "a
 * definition" in general, never anything about this specific answer. */
function blurBlock(kind) {
  const widths = kind === 'word' ? ['65%'] : ['100%', '55%'];
  const lines = widths.map((w) => `<span class="blur-line" style="width:${w}"></span>`).join('');
  return `<div class="blur-block" aria-label="hidden">${lines}</div>`;
}

/** word2def: the word is given, the definition is the (hidden) answer.
 * def2word: the definition is given, the word is the (hidden) answer.
 * Either way the word always renders on the left and the definition
 * always renders on the right — that positioning is what tells you
 * which kind of card this is, instead of a text label. */
function renderWordDefCard(card, revealed) {
  const wordGiven = card.type === 'word2def';
  const word = wordGiven ? card.prompt : card.answer;
  const definition = wordGiven ? card.answer : card.prompt;
  const wordHighlight = revealed && !wordGiven ? ' answer-highlight' : '';
  const defHighlight = revealed && wordGiven ? ' answer-highlight' : '';
  const wordContent =
    revealed || wordGiven ? `<div class="wd-content${wordHighlight}">${word}</div>` : blurBlock('word');
  const defContent =
    revealed || !wordGiven
      ? `<div class="wd-content wd-definition${defHighlight}">${definition}</div>`
      : blurBlock('definition');
  return `
    <div class="word-def-row">
      <div class="wd-slot">
        <div class="wd-label">Word</div>
        ${wordContent}
      </div>
      <div class="wd-slot">
        <div class="wd-label">Definition</div>
        ${defContent}
      </div>
    </div>
  `;
}

/** An endings card shares its two-column layout with word2def (word on
 * the left, its answer on the right), but the answer is the root's
 * conjugations/plurals, self-explanatory derived forms, and RE-/UN-
 * forms — not a definition — so its revealed background gets its own
 * color (see typeLineFor for the label that distinguishes it before
 * reveal, when the layout alone can't). */
function renderEndingsCard(card, revealed) {
  const answerContent = revealed
    ? `<div class="wd-content answer-highlight-endings">${card.answer}</div>`
    : blurBlock('definition');
  return `
    <div class="word-def-row">
      <div class="wd-slot">
        <div class="wd-label">Word</div>
        <div class="wd-content">${card.prompt}</div>
      </div>
      <div class="wd-slot">
        <div class="wd-label">Endings</div>
        ${answerContent}
      </div>
    </div>
  `;
}

function renderCardBody(card, revealed) {
  if (card.type === 'jumble') {
    return revealed
      ? `${renderJumbleTiles(card)}<div class="card-answer answer-highlight">${getDeckAnagramSolutions(card.prompt).join(', ')}</div>`
      : renderJumbleTiles(card);
  }
  if (card.type === 'endings') return renderEndingsCard(card, revealed);
  return renderWordDefCard(card, revealed);
}

let currentCard = null;
let currentIntroRemaining = 0;

function loadNextCard() {
  const { card, introRemaining } = getNextCard();
  if (!card) {
    currentCard = null;
    studyCard.innerHTML = '<p class="card-empty">No cards yet.</p>';
    return;
  }
  currentCard = card;
  currentIntroRemaining = introRemaining;
  studyCard.innerHTML = `
    ${typeLineFor(card, introRemaining)}
    ${renderCardBody(card, false)}
    <button id="show-answer-btn" class="secondary">Show answer</button>
  `;
  document.getElementById('show-answer-btn').addEventListener('click', showAnswer);
}

function showAnswer() {
  if (!currentCard) return;
  studyCard.innerHTML = `
    ${typeLineFor(currentCard, currentIntroRemaining)}
    ${renderCardBody(currentCard, true)}
    <div class="card-actions">
      <button class="grade-incorrect">Got it wrong</button>
      <button class="grade-correct">Got it right</button>
    </div>
  `;
  studyCard.querySelector('.grade-correct').addEventListener('click', () => grade(true));
  studyCard.querySelector('.grade-incorrect').addEventListener('click', () => grade(false));
}

function grade(correct) {
  if (!currentCard) return;
  const { mistakeBatch } = answerCard(currentCard.id, correct);

  const { streak, milestoneHit } = recordAnswer(correct);
  if (milestoneHit) {
    const result = generateIntroBatch(MILESTONE_EVERY);
    milestoneMessageEl.textContent = result.ok
      ? `🔥 ${streak} in a row! Added ${result.cardsAdded} new card${result.cardsAdded === 1 ? '' : 's'} across ${result.wordsAdded} word${result.wordsAdded === 1 ? '' : 's'} to learn.`
      : `🔥 ${streak} in a row! Couldn't find any new words to add — you may have studied the whole dictionary.`;
  } else if (mistakeBatch) {
    milestoneMessageEl.textContent = `📌 ${mistakeBatch.cardCount} recently-missed card${
      mistakeBatch.cardCount === 1 ? '' : 's'
    } — let's drill ${mistakeBatch.cardCount === 1 ? 'it' : 'them'} intensively.`;
  }

  refreshStats();
  loadNextCard();
  scheduleSync();
}

// A brand-new install has zero cards and no streak yet to trigger
// generating any — so if it's still empty after we've had a chance to
// pull down any existing cloud data, seed a first batch automatically.
function bootstrapIfEmpty() {
  if (getStats().totalCards > 0) return;
  const result = generateIntroBatch(MILESTONE_EVERY);
  if (result.ok) {
    milestoneMessageEl.textContent = `Added ${result.cardsAdded} card${
      result.cardsAdded === 1 ? '' : 's'
    } across ${result.wordsAdded} word${result.wordsAdded === 1 ? '' : 's'} to get you started.`;
  }
  refreshStats();
  loadNextCard();
  scheduleSync();
}

(async function init() {
  studyCard.innerHTML = '<p class="card-empty">Loading dictionary&hellip;</p>';
  try {
    await loadDictionary();
  } catch (err) {
    studyCard.innerHTML = `<p class="card-empty">Failed to load dictionary: ${err.message}</p>`;
    return;
  }
  refreshStats();
  loadNextCard();
  initSyncUI(syncPanelEl);
  initLookupUI(lookupBtnEl, lookupModalEl);
  startBackgroundSync();

  let didBootstrapCheck = false;
  function maybeBootstrap() {
    if (didBootstrapCheck) return;
    didBootstrapCheck = true;
    bootstrapIfEmpty();
  }

  if (getSyncId()) {
    // A device with sync configured might just be waiting on its first
    // pull to find out it already has cards from elsewhere — don't seed
    // until that first sync round has actually settled.
  } else {
    maybeBootstrap();
  }

  // A background sync can pull in cards/words added on another device —
  // reflect that without yanking away a card mid-review.
  let wasSyncing = false;
  onStatusChange((status) => {
    if (wasSyncing && status.state !== 'syncing') {
      refreshStats();
      if (!currentCard) loadNextCard();
      maybeBootstrap();
    }
    wasSyncing = status.state === 'syncing';
  });
})();
