/**
 * Tracks the current run of consecutive correct answers, on this device.
 * Every 50 in a row is a milestone (50, 100, 150, ...) that the app uses
 * to trigger generating a fresh batch of flashcards — see js/app.js.
 */

import { get, set } from './idb-store.js';

const KEY_STREAK = 'scrabbleStudy.streak';
export const MILESTONE_EVERY = 50;

export function getStreak() {
  return Number(get(KEY_STREAK, 0));
}

function setStreak(n) {
  return set(KEY_STREAK, n);
}

/** Starts the count again without a wrong answer having happened — used
 * when a batch of new cards finishes its intensive drilling (see
 * js/app.js). The streak is meant to measure how you do against the
 * whole repertoire, and a run built up while cycling the same handful
 * of brand-new cards round-robin isn't that; carrying it over would
 * mean arriving back at full review already most of the way to the next
 * milestone, on the strength of the easiest questions in the deck. */
export async function resetStreak() {
  await setStreak(0);
}

/** Call after every graded answer. Returns the streak and whether it
 * just crossed a fresh multiple of MILESTONE_EVERY.
 *
 * `countsTowardStreak` is false for an answer given while drilling a
 * freshly introduced set, or a mistake pile put back through the same
 * drilling — neither is the main repertoire, which is the only thing
 * the streak is meant to measure. Such an answer leaves the count
 * exactly where it was: it neither builds it up on questions you are
 * seeing for the third time in five minutes, nor tears down a run
 * earned in real review because a brand-new word was missed.
 *
 * Excluding them is also what stops milestones compounding. They used
 * to count, so drilling a batch could earn another batch partway
 * through, and the arithmetic never closed: clearing 50 cards takes
 * about 100 correct answers at two reps each, while every 50 correct
 * answers earned roughly 52 more cards. A run of perfect answers grew
 * the queue faster than it drained it, and only missing often enough to
 * keep resetting the streak got you out. */
export async function recordAnswer(correct, countsTowardStreak = true) {
  if (!countsTowardStreak) return { streak: getStreak(), milestoneHit: false };
  const streak = correct ? getStreak() + 1 : 0;
  await setStreak(streak);
  const milestoneHit = correct && streak % MILESTONE_EVERY === 0;
  return { streak, milestoneHit };
}
