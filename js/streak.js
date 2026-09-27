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

/** Call after every graded answer. Returns the new streak and whether it
 * just crossed a fresh multiple of MILESTONE_EVERY. */
export async function recordAnswer(correct) {
  const streak = correct ? getStreak() + 1 : 0;
  await setStreak(streak);
  const milestoneHit = correct && streak % MILESTONE_EVERY === 0;
  return { streak, milestoneHit };
}
