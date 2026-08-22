'use strict';
/**
 * Minimal SM-2-style spaced repetition scheduler with a binary grade
 * (correct / incorrect), since flashcards here are self-graded flip
 * cards rather than a 1-5 quality scale.
 */

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

/** First two correct-in-a-row intervals, in days; afterwards the interval
 * grows by `ease` each time. */
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;

/** A wrong answer brings the card back soon (10 minutes), so it's
 * re-quizzed more often within the same study session. */
const LAPSE_INTERVAL_DAYS = 10 / (24 * 60);

function initialState(now = new Date()) {
  return {
    interval_days: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    due_at: now.toISOString(),
    last_reviewed_at: null,
  };
}

/** Returns the next SRS state given the current one and whether the
 * answer was correct. Does not mutate the input. */
function schedule(state, correct, now = new Date()) {
  const next = { ...state };
  next.last_reviewed_at = now.toISOString();

  if (correct) {
    next.reps = state.reps + 1;
    if (next.reps === 1) {
      next.interval_days = FIRST_INTERVAL_DAYS;
    } else if (next.reps === 2) {
      next.interval_days = SECOND_INTERVAL_DAYS;
    } else {
      next.interval_days = state.interval_days * state.ease;
    }
    next.ease = state.ease + 0.1;
  } else {
    next.lapses = state.lapses + 1;
    next.reps = 0;
    next.interval_days = LAPSE_INTERVAL_DAYS;
    next.ease = Math.max(MIN_EASE, state.ease - 0.2);
  }

  const dueDate = new Date(now.getTime() + next.interval_days * 24 * 60 * 60 * 1000);
  next.due_at = dueDate.toISOString();
  return next;
}

module.exports = { initialState, schedule, DEFAULT_EASE, MIN_EASE };
