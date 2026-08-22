import { loadDictionary } from './dictionary.js';
import { addRandomWord, getNextDue, answerCard, getStats, getRecentWords } from './store.js';
import { startBackgroundSync, scheduleSync, onStatusChange } from './sync.js';
import { initSyncUI } from './sync-ui.js';

const statsEl = document.getElementById('stats');
const addWordBtn = document.getElementById('add-word-btn');
const addWordResult = document.getElementById('add-word-result');
const studyCard = document.getElementById('study-card');
const recentWordsEl = document.getElementById('recent-words');
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
  `;
}

function refreshRecentWords() {
  const words = getRecentWords(25);
  recentWordsEl.innerHTML = words
    .map(
      (w) =>
        `<li><span>${w.root_word}</span><span class="via">${
          w.via_word !== w.root_word ? `via ${w.via_word}` : ''
        }</span></li>`
    )
    .join('');
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
  const { due, nextDueAt } = getNextDue(1);
  if (due.length === 0) {
    currentCard = null;
    studyCard.innerHTML = `<p class="card-empty">${
      nextDueAt ? `All caught up. Next card due ${fmtDue(nextDueAt)}.` : 'No cards yet — add a word to get started.'
    }</p>`;
    return;
  }
  currentCard = due[0];
  studyCard.innerHTML = `
    <div class="card-type">${cardTypeLabel(currentCard.type)}</div>
    ${renderPrompt(currentCard)}
    <button id="show-answer-btn" class="secondary">Show answer</button>
  `;
  document.getElementById('show-answer-btn').addEventListener('click', showAnswer);
}

function showAnswer() {
  if (!currentCard) return;
  studyCard.innerHTML = `
    <div class="card-type">${cardTypeLabel(currentCard.type)}</div>
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
  refreshStats();
  loadNextCard();
  scheduleSync();
}

addWordBtn.addEventListener('click', () => {
  addWordBtn.disabled = true;
  addWordResult.textContent = 'Picking a word…';
  try {
    const result = addRandomWord();
    if (!result.ok) {
      addWordResult.textContent = result.message;
      return;
    }
    const rootsText = result.newRoots.join(', ');
    addWordResult.textContent =
      result.pickedWord === rootsText
        ? `Added "${result.pickedWord}" (${result.cardsAdded} cards).`
        : `Picked "${result.pickedWord}" → added root${
            result.newRoots.length > 1 ? 's' : ''
          } ${rootsText} (${result.cardsAdded} cards).`;
    refreshStats();
    refreshRecentWords();
    loadNextCard();
    scheduleSync();
  } catch (err) {
    addWordResult.textContent = `Error: ${err.message}`;
  } finally {
    addWordBtn.disabled = false;
  }
});

(async function init() {
  studyCard.innerHTML = '<p class="card-empty">Loading dictionary&hellip;</p>';
  addWordBtn.disabled = true;
  try {
    await loadDictionary();
  } catch (err) {
    studyCard.innerHTML = `<p class="card-empty">Failed to load dictionary: ${err.message}</p>`;
    return;
  }
  addWordBtn.disabled = false;
  refreshStats();
  refreshRecentWords();
  loadNextCard();
  initSyncUI(syncPanelEl);
  startBackgroundSync();

  // A background sync can pull in cards/words added on another device —
  // reflect that without yanking away a card mid-review.
  let wasSyncing = false;
  onStatusChange((status) => {
    if (wasSyncing && status.state !== 'syncing') {
      refreshStats();
      refreshRecentWords();
      if (!currentCard) loadNextCard();
    }
    wasSyncing = status.state === 'syncing';
  });
})();
