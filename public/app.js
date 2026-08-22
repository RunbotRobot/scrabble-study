'use strict';

const statsEl = document.getElementById('stats');
const addWordBtn = document.getElementById('add-word-btn');
const addWordResult = document.getElementById('add-word-result');
const studyCard = document.getElementById('study-card');
const recentWordsEl = document.getElementById('recent-words');

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

function fmtDue(dueAtIso) {
  const ms = new Date(dueAtIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hr`;
  return `in ${Math.round(hours / 24)} days`;
}

async function refreshStats() {
  const stats = await api('/stats');
  statsEl.innerHTML = `
    <div><dt>Words selected</dt><dd>${stats.selectedRootCount.toLocaleString()}</dd></div>
    <div><dt>Total cards</dt><dd>${stats.totalCards.toLocaleString()}</dd></div>
    <div><dt>Due now</dt><dd>${stats.dueNow.toLocaleString()}</dd></div>
  `;
}

async function refreshRecentWords() {
  const words = await api('/words/recent?limit=25');
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
    const tiles = [...card.prompt]
      .map((ch) => `<span class="tile">${ch}</span>`)
      .join('');
    return `<div class="jumble-tiles">${tiles}</div>`;
  }
  return `<div class="card-prompt">${card.prompt}</div>`;
}

let currentCard = null;

async function loadNextCard() {
  const { due, nextDueAt } = await api('/study/next');
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

async function grade(correct) {
  if (!currentCard) return;
  await api(`/study/${currentCard.id}/answer`, {
    method: 'POST',
    body: JSON.stringify({ correct }),
  });
  await Promise.all([refreshStats(), loadNextCard()]);
}

addWordBtn.addEventListener('click', async () => {
  addWordBtn.disabled = true;
  addWordResult.textContent = 'Picking a word…';
  try {
    const result = await api('/words/add-random', { method: 'POST' });
    const rootsText = result.newRoots.join(', ');
    addWordResult.textContent =
      result.pickedWord === rootsText
        ? `Added "${result.pickedWord}" (${result.cardsAdded} cards).`
        : `Picked "${result.pickedWord}" → added root${
            result.newRoots.length > 1 ? 's' : ''
          } ${rootsText} (${result.cardsAdded} cards).`;
    await Promise.all([refreshStats(), refreshRecentWords(), loadNextCard()]);
  } catch (err) {
    addWordResult.textContent = `Error: ${err.message}`;
  } finally {
    addWordBtn.disabled = false;
  }
});

(async function init() {
  await Promise.all([refreshStats(), refreshRecentWords(), loadNextCard()]);
})();
