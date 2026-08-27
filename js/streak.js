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

/** Call after every graded answer. Returns the new streak and whether it
 * just crossed a fresh multiple of MILESTONE_EVERY. */
export async function recordAnswer(correct) {
  const streak = correct ? getStreak() + 1 : 0;
  await setStreak(streak);
  const milestoneHit = correct && streak % MILESTONE_EVERY === 0;
  return { streak, milestoneHit };
}
