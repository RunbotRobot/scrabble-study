# Scrabble Study

A personal flashcard app for studying the Scrabble dictionary (NASPA Word
List 2020), built with spaced repetition. It's a fully static site — no
server, no backend, no Node required on the device you study on. Deployed
via GitHub Pages at **https://runbotrobot.github.io/scrabble-study/**.

## How word selection works

There's no manual "add a word" button — new words arrive automatically,
tied to a 50-answer correct streak (see below). Each time a batch is
generated:

1. A word is picked from the *entire* word list — root, conjugated, or
   plural form — with uniform probability. No weighting toward common,
   "useful," or alphabetically-early words.
2. That word is resolved to its dictionary root(s). Most words resolve to
   exactly one root (e.g. `WENT` → `GO`), but some resolve to more than
   one root because they're independently meaningful under different
   parts of speech (e.g. `ARE` is its own noun root — a unit of surface
   measure — *and* the verb form of `BE`), and a plural/invariant word
   like `CATTLE` is simply its own root.
3. For each newly-discovered root, three kinds of flashcards are created:
   - **Word → Definition** and **Definition → Word** — only for roots 8
     letters or shorter. Longer roots skip these two entirely.
   - **Jumble** — one per distinct conjugated/pluralized form of the
     root that's 8 letters or shorter, with the letters arranged in the
     fixed custom order `QVUWGBFJYOPLKITMDCNHARZXES` (deterministic, not
     a random shuffle). Longer inflected forms don't get a jumble card.
   - A root with no dictionary definition on file (some newer Scrabble
     words only have a part of speech, no gloss) only gets jumble cards.
     A root longer than 8 letters with no short inflections either ends
     up contributing no cards at all — it's still recorded as selected,
     it just has nothing to quiz.
4. This repeats — picking further words and building out their roots —
   until the batch has at least 50 cards. Because a single root can
   produce a handful of cards, 50 is a floor, not a ceiling: the root
   that's in progress when the count crosses 50 is always finished out,
   so a batch is usually a bit over 50.

Definitions are shown verbatim from the source dictionary file (see
`data/source/ATTRIBUTION.md`), aside from expanding its `{word=pos}`
shorthand notation into the plain word it refers to.

## Streaks and introducing new cards

Getting an answer right extends your current correct-answer streak;
getting one wrong resets it to zero (shown in the stats bar). Every 50 in
a row — 50, 100, 150, and so on — automatically generates a fresh batch
of new cards (see above).

A freshly-generated batch is drilled intensively: while any of its cards
haven't yet been answered correctly twice, they take over the study queue
entirely (cycled round-robin, ignoring review priority — see below)
ahead of anything else, and the *next* card is picked at random among
however many are equally "least recently seen" — not, say, always the
word→definition card immediately followed by its own definition→word
twin, which would make the second one trivial. Once a card's had two
correct answers, it graduates into the normal review rotation like any
other card, and once every card in the batch has graduated, normal
review resumes.

The very first batch, before you've ever gotten anything right to build a
streak with, is seeded automatically the first time the app has zero
cards (after giving cloud sync, if configured, a chance to pull down
existing progress first).

## Review priority

Once a card's graduated out of intro drilling, there's no due/not-due
cutoff gating whether it can come up — every graduated card is always
eligible, ranked by a priority score, and the highest-priority one is
always what's shown next. (This is deliberate: a hard due date means you
eventually run out of due cards and hit a dead end with nothing left to
study, even though you have plenty of cards that could still use
review.) Priority combines two things:

- how overdue it is, as a fraction of its own spaced-repetition interval
  — a 1-day-old card that's 2 days late is more urgent than a 30-day-old
  card that's also 2 days late, even though the raw lateness is the same
- how much harder than average it's been recently, via the same `ease`
  value the SM-2 scheduler already tracks (it falls on a miss, rises on
  a streak of correct answers)

## Tracking recent mistakes

Missing a graduated card adds it to a running "recently missed" pile;
getting it right again removes it. Once that pile reaches 50 distinct
cards, all 50 go back into intensive intro drilling together (the exact
same mechanism as a fresh batch of new words), and the pile resets to
build up again from there.

## Card presentation

Word↔definition cards always show a **Word** column on the left and a
**Definition** column on the right, regardless of which one is the
question and which is the answer — that positioning *is* the signal for
which kind of card it is, instead of a text label. Whichever side is the
answer is hidden behind a fixed, generic placeholder (not a CSS blur
filter over the real text, which would still leak its length/shape) —
you find out what's actually there by tapping "Show answer" like normal.

## Spaced repetition

Each flashcard tracks its own simplified SM-2 state (interval, ease,
reps/lapses). Answering a card correctly pushes its next appearance
further out; answering incorrectly brings it back soon (10 minutes) and
shrinks its ease, so missed cards resurface more often.

## Where your progress lives

Every read/write always goes through this browser's `localStorage`
first, so the app is fully usable offline and never blocks on the
network. On top of that, a small Cloudflare Worker + D1 database (see
`worker/`) acts as a durable backup and cross-device sync layer:

- Tap **Start cloud sync** in the Cloud sync panel. This generates a
  random "sync code" (there's no account/password — the code itself is
  the credential, like a share link) and starts pushing your local
  progress to the cloud.
- On another device, enter the same code under "I already have a sync
  code" to pull everything down.
- If you lose or wipe this device, your progress isn't gone — set up a
  fresh device with the same sync code.
- Conflicts (e.g. answering the same card on two devices before they
  sync) resolve last-write-wins per card. Removing a card doesn't delete
  its row outright — it's flagged and hidden everywhere, so the removal
  itself has something to sync (an outright delete would just look like
  "nothing happened" to a device that already has the card).
- If you never set up sync, or the network's unavailable, everything
  still works exactly as before — just local to this browser.

**Write your sync code down somewhere safe once you generate it** — it's
the only way to link a second device or recover after losing this one.

Two things are intentionally **not** synced, since they're per-device
session bookkeeping rather than study data: your current correct-answer
streak, and the "recently missed" pile. Study from more than one device
and each builds up its own streak/pile independently.

## Running it locally

```bash
npm run build:dictionary   # parses data/source/NWL2020.txt -> data/dictionary.json (only needed if you edit the source data)
npm run serve               # zero-dependency static file server, for local preview only
```

Then open http://localhost:8080. `npm run serve` is purely a local dev
convenience — the deployed site on GitHub Pages serves the same static
files directly, no server involved.

## Deploying

### The site (GitHub Pages)

GitHub Pages is configured to deploy from the `main` branch, `/` (root).
Since Pages just serves whatever's committed (no build step), the built
`data/dictionary.json` is committed to the repo — regenerate it with
`npm run build:dictionary` and commit the result whenever
`data/source/NWL2020.txt` changes.

### The sync worker (Cloudflare)

`.github/workflows/deploy-worker.yml` deploys `worker/` to Cloudflare
Workers automatically on every push to `main` that touches `worker/`.
One-time setup, in the Cloudflare dashboard and this repo's GitHub
settings:

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** →
   use the **"Edit Cloudflare Workers"** template (covers Workers
   Scripts + D1). Copy the token.
2. This repo's GitHub **Settings → Secrets and variables → Actions**,
   add two repository secrets:
   - `CLOUDFLARE_API_TOKEN` — the token from step 1.
   - `CLOUDFLARE_ACCOUNT_ID` — found on the right sidebar of any page in
     the Cloudflare dashboard.
3. Push (or re-run the workflow) — it deploys the worker and prints its
   `*.workers.dev` URL in the run log.
4. Paste that URL into `WORKER_URL` in `js/sync.js`, commit, push.

The D1 database (`scrabble-study-db`) and its schema already exist —
`worker/wrangler.toml` references it by ID, so a fresh deploy just picks
it back up.

## Project layout

- `index.html`, `style.css`, `js/` — the static site (ES modules, no
  bundler, no framework).
  - `js/dictionary.js` — fetches/parses `data/dictionary.json`, random
    word selection, root resolution.
  - `js/cards.js` — builds flashcard specs (word↔definition, jumbles)
    for a root word.
  - `js/jumble.js` — the custom-letter-order jumble function.
  - `js/srs.js` — the spaced-repetition scheduler.
  - `js/streak.js` — tracks the consecutive-correct streak and its
    every-50 milestones.
  - `js/store.js` — persists selected words + cards + SRS state in
    `localStorage`; batch generation, intro-vs-review card selection,
    and the merge primitives `js/sync.js` uses.
  - `js/sync.js` — cloud backup/sync engine (push/pull against the
    worker, last-write-wins merge, retry-friendly).
  - `js/sync-ui.js` — the Cloud sync panel.
  - `js/app.js` — UI wiring.
- `data/source/` — the raw Scrabble word list + attribution notes.
- `data/dictionary.json` — built dictionary asset the browser fetches
  (committed, since GitHub Pages doesn't run a build step).
- `scripts/build-dictionary.js` — regenerates `data/dictionary.json` from
  the raw word list.
- `scripts/serve.js` — local-only static file server for previewing.
- `worker/` — the Cloudflare Worker (`index.js`) + its config
  (`wrangler.toml`) for the sync backend.
- `.github/workflows/deploy-worker.yml` — auto-deploys `worker/` on push.
