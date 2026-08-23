import { loadDictionary } from './dictionary.js';
import { generateIntroBatch, getNextCard, answerCard, getStats } from './store.js';
import { getStreak, recordAnswer, MILESTONE_EVERY } from './streak.js';
import { startBackgroundSync, scheduleSync, onStatusChange, getSyncId } from './sync.js';
import { initSyncUI } from './sync-ui.js';

const statsEl = document.getElementById('stats');
const milestoneMessageEl = document.getElementById('milestone-message');
const studyCard = document.getElementById('study-card');
const syncPanelEl = document.getElementById('sync-panel');

function refreshStats() {
  const stats = getStats();
  statsEl.innerHTML = `
    <div><dt>Words selected</dt><dd>${stats.selectedRootCount.toLocaleString()}</dd></div>
    <div><dt>Total cards</dt><dd>${stats.totalCards.toLocaleString()}</dd></div>
    ${stats.introducing > 0 ? `<div><dt>Introducing</dt><dd>${stats.introducing.toLocaleString()}</dd></div>` : ''}
    ${stats.recentlyWrong > 0 ? `<div><dt>Recently wrong</dt><dd>${stats.recentlyWrong.toLocaleString()}/50</dd></div>` : ''}
    <div><dt>Streak</dt><dd>${getStreak().toLocaleString()}</dd></div>
  `;
}

function renderJumbleTiles(card) {
  const tiles = [...card.prompt].map((ch) => `<span class="tile">${ch}</span>`).join('');
  return `<div class="jumble-tiles">${tiles}</div>`;
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
  const wordContent = revealed || wordGiven ? `<div class="wd-content">${word}</div>` : blurBlock('word');
  const defContent = revealed || !wordGiven ? `<div class="wd-content">${definition}</div>` : blurBlock('definition');
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

let currentCard = null;

function loadNextCard() {
  const { card, introRemaining } = getNextCard();
  if (!card) {
    currentCard = null;
    studyCard.innerHTML = '<p class="card-empty">No cards yet.</p>';
    return;
  }
  currentCard = card;
  const isJumble = card.type === 'jumble';
  const typeLine = isJumble
    ? `<div class="card-type">${card.phase === 'intro' ? `Jumble · New (${introRemaining} left)` : 'Jumble'}</div>`
    : '';
  studyCard.innerHTML = `
    ${typeLine}
    ${isJumble ? renderJumbleTiles(card) : renderWordDefCard(card, false)}
    <button id="show-answer-btn" class="secondary">Show answer</button>
  `;
  document.getElementById('show-answer-btn').addEventListener('click', showAnswer);
}

function showAnswer() {
  if (!currentCard) return;
  const isJumble = currentCard.type === 'jumble';
  const typeLine = isJumble
    ? `<div class="card-type">${currentCard.phase === 'intro' ? 'Jumble · New' : 'Jumble'}</div>`
    : '';
  const body = isJumble
    ? `${renderJumbleTiles(currentCard)}<div class="card-answer">${currentCard.answer}</div>`
    : renderWordDefCard(currentCard, true);
  studyCard.innerHTML = `
    ${typeLine}
    ${body}
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

// With no manual "add a word" button, a brand-new install has zero cards
// and no streak yet to trigger generating any — so if it's still empty
// after we've had a chance to pull down any existing cloud data, seed a
// first batch automatically.
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
