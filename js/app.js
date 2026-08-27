import { loadDictionary } from './dictionary.js';
import {
  generateIntroBatch,
  getNextCard,
  answerCard,
  getStats,
  getDeckAnagramSolutions,
  describeStorageQuota,
} from './store.js';
import { getStreak, recordAnswer, MILESTONE_EVERY } from './streak.js';
import { startBackgroundSync, scheduleSync, onStatusChange, getSyncId } from './sync.js';
import { initSyncUI } from './sync-ui.js';
import { initLookupUI } from './lookup-ui.js';
import { imageHtmlFor } from './images.js';
import { imageSubjectFor } from './dictionary.js';
import { fetchVersion } from './version.js';
import { initPersistence } from './idb-store.js';

const statsEl = document.getElementById('stats');
const milestoneMessageEl = document.getElementById('milestone-message');
const studyCard = document.getElementById('study-card');
const syncPanelEl = document.getElementById('sync-panel');
const lookupBtnEl = document.getElementById('lookup-btn');
const lookupModalEl = document.getElementById('lookup-modal-root');
const optionsBtnEl = document.getElementById('options-btn');
const optionsModalEl = document.getElementById('options-modal-root');
const optionsCloseEl = document.getElementById('options-close');
const versionInfoEl = document.getElementById('version-info');

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

/** One illustration per distinct root among a jumble's deck solutions —
 * a jumble with several valid answers (e.g. STOP/POTS/SPOT/TOPS/OPTS)
 * genuinely depicts several different things, so it gets several
 * pictures, not just one for the card's own answer. Solutions that are
 * inflected forms of the same root (rather than roots of their own)
 * collapse onto that root's single shared image. */
function renderJumbleImages(card) {
  const seenRoots = new Set();
  const subjects = [];
  for (const word of getDeckAnagramSolutions(card.prompt)) {
    const subject = imageSubjectFor(word);
    if (!subject || seenRoots.has(subject.root)) continue;
    seenRoots.add(subject.root);
    subjects.push(subject);
  }
  if (subjects.length === 0) return '';
  const imgs = subjects.map(({ root, definition }) => imageHtmlFor(root, definition)).join('');
  return `<div class="jumble-images">${imgs}</div>`;
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
 * which kind of card this is, instead of a text label.
 *
 * The illustration only ever appears once the definition itself is
 * visible (revealed, or given from the start on a def2word card) — it
 * depicts the definition, so showing it any earlier on a word2def card
 * would spoil the very thing you're being asked to recall. */
function renderWordDefCard(card, revealed) {
  const wordGiven = card.type === 'word2def';
  const word = wordGiven ? card.prompt : card.answer;
  const definition = wordGiven ? card.answer : card.prompt;
  const definitionVisible = revealed || !wordGiven;
  const wordHighlight = revealed && !wordGiven ? ' answer-highlight' : '';
  const defHighlight = revealed && wordGiven ? ' answer-highlight' : '';
  const wordContent =
    revealed || wordGiven ? `<div class="wd-content${wordHighlight}">${word}</div>` : blurBlock('word');
  const defContent = definitionVisible
    ? `<div class="wd-content wd-definition${defHighlight}">${definition}</div>`
    : blurBlock('definition');
  // Uses imageSubjectFor's own (possibly enriched, see dictionary.js)
  // definition for the illustration rather than `definition` above —
  // that text is what's actually quizzed and must stay exactly what
  // the card was built with, but the image is just a visual aid and
  // can afford a richer prompt when the root's definition alone is a
  // thin same-as-another-word pointer.
  const imageSubject = imageSubjectFor(word);
  const imageContent = definitionVisible && imageSubject ? imageHtmlFor(word, imageSubject.definition) : '';
  return `
    <div class="word-def-row">
      <div class="wd-slot">
        <div class="wd-label">Word</div>
        ${wordContent}
      </div>
      <div class="wd-slot">
        <div class="wd-label">Definition</div>
        ${defContent}
        ${imageContent}
      </div>
    </div>
  `;
}

/** An endings card shares its two-column layout with word2def (word on
 * the left, its answer on the right), but the answer is the root's
 * conjugations/plurals, self-explanatory derived forms, and RE-/UN-
 * forms — not a definition — so its background gets its own color,
 * visible even before "Show answer" (not just once revealed), so the
 * card reads as "an endings card" at a glance instead of looking like a
 * word2def card until you flip it. */
function renderEndingsCard(card, revealed) {
  const answerContent = revealed
    ? `<div class="wd-content wd-definition answer-highlight-endings">${card.answer}</div>`
    : `<div class="answer-highlight-endings">${blurBlock('definition')}</div>`;
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
      ? `${renderJumbleTiles(card)}<div class="card-answer answer-highlight">${getDeckAnagramSolutions(card.prompt).join(', ')}</div>${renderJumbleImages(card)}`
      : renderJumbleTiles(card);
  }
  if (card.type === 'endings') return renderEndingsCard(card, revealed);
  return renderWordDefCard(card, revealed);
}

let currentCard = null;
let currentIntroRemaining = 0;

function loadNextCard() {
  const { card, introRemaining } = getNextCard(currentCard ? currentCard.id : null);
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

function showMilestoneMessage(text, isError = false) {
  milestoneMessageEl.textContent = text;
  milestoneMessageEl.classList.toggle('milestone-message-error', isError);
}

/** Appends the browser's own storage-usage numbers to whatever error
 * message is currently shown, once they're available — the message
 * itself renders immediately (this is async), then gets the concrete
 * "X of Y MB" detail appended a moment later. No-ops if the message has
 * since changed (e.g. the user moved on to another card) or the
 * browser doesn't support the estimate API. */
async function appendQuotaDiagnostics(baseText) {
  const info = await describeStorageQuota();
  if (!info || milestoneMessageEl.textContent !== baseText) return;
  milestoneMessageEl.textContent = `${baseText} (${info})`;
}

/** Grading can throw or come back empty in ways a click handler would
 * otherwise swallow silently (e.g. this exact card's id no longer
 * exists in local storage — nothing left for the UI to visibly get
 * stuck on, so "Got it right/wrong" would just look like it did
 * nothing). Surface that instead of failing silently, and recover by
 * loading whatever card *does* exist rather than leaving the answered
 * card frozen on screen. */
async function grade(correct) {
  if (!currentCard) return;
  try {
    const result = await answerCard(currentCard.id, correct);
    if (!result) {
      throw new Error(`card ${currentCard.id} no longer exists locally`);
    }
    const { mistakeBatch } = result;

    const { streak, milestoneHit } = await recordAnswer(correct);
    if (milestoneHit) {
      const batchResult = await generateIntroBatch(MILESTONE_EVERY);
      showMilestoneMessage(
        batchResult.ok
          ? `🔥 ${streak} in a row! Added ${batchResult.cardsAdded} new card${batchResult.cardsAdded === 1 ? '' : 's'} across ${batchResult.wordsAdded} word${batchResult.wordsAdded === 1 ? '' : 's'} to learn.`
          : `🔥 ${streak} in a row! Couldn't find any new words to add — you may have studied the whole dictionary.`
      );
    } else if (mistakeBatch) {
      showMilestoneMessage(
        `📌 ${mistakeBatch.cardCount} recently-missed card${
          mistakeBatch.cardCount === 1 ? '' : 's'
        } — let's drill ${mistakeBatch.cardCount === 1 ? 'it' : 'them'} intensively.`
      );
    }
  } catch (err) {
    console.error('Grading failed:', err);
    const advice = err.quotaExceeded ? '' : ' Try reloading the page.';
    const text = `⚠️ Couldn't record that answer: ${err.message}.${advice}`;
    showMilestoneMessage(text, true);
    if (err.quotaExceeded) appendQuotaDiagnostics(text);
  }

  refreshStats();
  loadNextCard();
  scheduleSync();
}

// A brand-new install has zero cards and no streak yet to trigger
// generating any — so if it's still empty after we've had a chance to
// pull down any existing cloud data, seed a first batch automatically.
async function bootstrapIfEmpty() {
  if (getStats().totalCards > 0) return;
  try {
    const result = await generateIntroBatch(MILESTONE_EVERY);
    if (result.ok) {
      showMilestoneMessage(
        `Added ${result.cardsAdded} card${result.cardsAdded === 1 ? '' : 's'} across ${result.wordsAdded} word${
          result.wordsAdded === 1 ? '' : 's'
        } to get you started.`
      );
    }
  } catch (err) {
    console.error('Bootstrapping the first batch failed:', err);
    const advice = err.quotaExceeded ? '' : ' Try reloading the page.';
    const text = `⚠️ Couldn't create your first cards: ${err.message}.${advice}`;
    showMilestoneMessage(text, true);
    if (err.quotaExceeded) appendQuotaDiagnostics(text);
  }
  refreshStats();
  loadNextCard();
  scheduleSync();
}

// ES modules never hot-reload — a tab left open across a deploy keeps
// running whatever code was current when it loaded, no matter how long
// that's been, since nothing about normal use ever re-fetches app.js.
// A stale-enough copy isn't just "missing a feature": card ids and data
// shapes can drift from what current code (and the synced server data)
// expects, breaking things in ways that look like silent no-ops rather
// than an obvious error.
//
// `loadedVersion` is whatever version.json this page itself was served
// (not a cache-bypassing fetch — it should reflect reality, the same
// as every other shell asset loaded at the same time). Periodically
// re-checking with `bypassCache: true` and comparing catches a deploy
// that happened after this page loaded — including one the browser's
// HTTP cache would otherwise have hidden from a plain reload — rather
// than the previous blind "reload after 12 hours regardless" heuristic,
// which reacted slowly and unnecessarily reloaded even when nothing
// had actually changed. Checks (and reloads) only in the foreground,
// so it can't interrupt a session no one's looking at.
let loadedVersion = null;
const CHECK_VERSION_INTERVAL_MS = 5 * 60 * 1000;

async function checkForNewVersion() {
  if (document.hidden || !loadedVersion) return;
  const latest = await fetchVersion({ bypassCache: true });
  if (latest && latest !== loadedVersion) {
    location.reload();
  }
}
setInterval(checkForNewVersion, CHECK_VERSION_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForNewVersion();
});

(async function init() {
  studyCard.innerHTML = '<p class="card-empty">Loading dictionary&hellip;</p>';
  try {
    await loadDictionary();
  } catch (err) {
    studyCard.innerHTML = `<p class="card-empty">Failed to load dictionary: ${err.message}</p>`;
    return;
  }
  try {
    await initPersistence();
  } catch (err) {
    studyCard.innerHTML = `<p class="card-empty">Failed to open local storage: ${err.message}</p>`;
    return;
  }
  refreshStats();
  loadNextCard();
  initSyncUI(syncPanelEl);
  initLookupUI(lookupBtnEl, lookupModalEl);
  startBackgroundSync();

  fetchVersion().then((version) => {
    loadedVersion = version;
    if (versionInfoEl) versionInfoEl.textContent = version ? `Running ${version}` : "Couldn't determine version.";
  });

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
