import { loadDictionary } from './dictionary.js';
import { generateIntroBatch, getNextCard, answerCard, getStats } from './store.js';
import { getStreak, recordAnswer, MILESTONE_EVERY } from './streak.js';
import { startBackgroundSync, scheduleSync, onStatusChange, getSyncId } from './sync.js';
import { initSyncUI } from './sync-ui.js';

const statsEl = document.getElementById('stats');
const milestoneMessageEl = document.getElementById('milestone-message');
const studyCard = document.getElementById('study-card');
const syncPanelEl = document.getElementById('sync-panel');

function fmtDue(dueAtIso) {
  const ms = new Date(dueAtIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hr`;
  return `in ${Math.round(hours / 24)} days`;
}

function refreshStats() {
  const stats = getStats();
  statsEl.innerHTML = `
    <div><dt>Words selected</dt><dd>${stats.selectedRootCount.toLocaleString()}</dd></div>
    <div><dt>Total cards</dt><dd>${stats.totalCards.toLocaleString()}</dd></div>
    <div><dt>Due now</dt><dd>${stats.dueNow.toLocaleString()}</dd></div>
    ${stats.introducing > 0 ? `<div><dt>Introducing</dt><dd>${stats.introducing.toLocaleString()}</dd></div>` : ''}
    <div><dt>Streak</dt><dd>${getStreak().toLocaleString()}</dd></div>
  `;
}

function cardTypeLabel(type) {
  if (type === 'word2def') return 'Word → Definition';
  if (type === 'def2word') return 'Definition → Word';
  if (type === 'jumble') return 'Jumble';
  return type;
}

function renderPrompt(card) {
  if (card.type === 'jumble') {
    const tiles = [...card.prompt].map((ch) => `<span class="tile">${ch}</span>`).join('');
    return `<div class="jumble-tiles">${tiles}</div>`;
  }
  return `<div class="card-prompt">${card.prompt}</div>`;
}

let currentCard = null;

function loadNextCard() {
  const { card, introRemaining, nextDueAt } = getNextCard();
  if (!card) {
    currentCard = null;
    studyCard.innerHTML = `<p class="card-empty">${
      nextDueAt ? `All caught up. Next card due ${fmtDue(nextDueAt)}.` : 'No cards yet.'
    }</p>`;
    return;
  }
  currentCard = card;
  const typeLabel =
    card.phase === 'intro' ? `${cardTypeLabel(card.type)} · New (${introRemaining} left)` : cardTypeLabel(card.type);
  studyCard.innerHTML = `
    <div class="card-type">${typeLabel}</div>
    ${renderPrompt(card)}
    <button id="show-answer-btn" class="secondary">Show answer</button>
  `;
  document.getElementById('show-answer-btn').addEventListener('click', showAnswer);
}

function showAnswer() {
  if (!currentCard) return;
  const typeLabel = currentCard.phase === 'intro' ? `${cardTypeLabel(currentCard.type)} · New` : cardTypeLabel(currentCard.type);
  studyCard.innerHTML = `
    <div class="card-type">${typeLabel}</div>
    ${renderPrompt(currentCard)}
    <div class="card-answer">${currentCard.answer}</div>
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
  answerCard(currentCard.id, correct);

  const { streak, milestoneHit } = recordAnswer(correct);
  if (milestoneHit) {
    const result = generateIntroBatch(MILESTONE_EVERY);
    milestoneMessageEl.textContent = result.ok
      ? `🔥 ${streak} in a row! Added ${result.cardsAdded} new card${result.cardsAdded === 1 ? '' : 's'} across ${result.wordsAdded} word${result.wordsAdded === 1 ? '' : 's'} to learn.`
      : `🔥 ${streak} in a row! Couldn't find any new words to add — you may have studied the whole dictionary.`;
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
