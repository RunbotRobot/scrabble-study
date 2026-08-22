# Scrabble Study

A personal flashcard app for studying the Scrabble dictionary (NASPA Word
List 2020), built with spaced repetition. It's a fully static site — no
server, no backend, no Node required on the device you study on. Deployed
via GitHub Pages at **https://runbotrobot.github.io/scrabble-study/**.

## How word selection works

1. **Add a random word** picks one word from the *entire* word list —
   root, conjugated, or plural form — with uniform probability. No
   weighting toward common, "useful," or alphabetically-early words.
2. That word is resolved to its dictionary root(s). Most words resolve to
   exactly one root (e.g. `WENT` → `GO`), but some resolve to more than
   one root because they're independently meaningful under different
   parts of speech (e.g. `ARE` is its own noun root — a unit of surface
   measure — *and* the verb form of `BE`), and a plural/invariant word
   like `CATTLE` is simply its own root.
3. For each newly-discovered root, three kinds of flashcards are created:
   - **Word → Definition**
   - **Definition → Word**
   - **Jumble** — one per distinct conjugated/pluralized form of the
     root, with the letters arranged in the fixed custom order
     `QVUWGBFJYOPLKITMDCNHARZXES` (deterministic, not a random shuffle).
   - A root with no dictionary definition on file (some newer Scrabble
     words only have a part of speech, no gloss) only gets jumble cards.

Definitions are shown verbatim from the source dictionary file (see
`data/source/ATTRIBUTION.md`), aside from expanding its `{word=pos}`
shorthand notation into the plain word it refers to.

## Spaced repetition

Each flashcard tracks its own simplified SM-2 state (interval, ease,
reps/lapses). Answering a card correctly pushes its next appearance
further out; answering incorrectly brings it back soon (10 minutes) and
shrinks its ease, so missed cards resurface more often.

## Where your progress lives

There's no account and no server: the browser you use it in stores your
selected words and card progress in `localStorage`, on that device only.
It isn't synced between devices/browsers, and clearing that browser's
site data for this page erases it. If you study from multiple devices
you'll build up separate progress on each.

## Running it locally

```bash
npm run build:dictionary   # parses data/source/NWL2020.txt -> data/dictionary.json (only needed if you edit the source data)
npm run serve               # zero-dependency static file server, for local preview only
```

Then open http://localhost:8080. `npm run serve` is purely a local dev
convenience — the deployed site on GitHub Pages serves the same static
files directly, no server involved.

## Deploying

GitHub Pages is configured to deploy from the `main` branch, `/` (root).
Since Pages just serves whatever's committed (no build step), the built
`data/dictionary.json` is committed to the repo — regenerate it with
`npm run build:dictionary` and commit the result whenever
`data/source/NWL2020.txt` changes.

## Project layout

- `index.html`, `style.css`, `js/` — the static site (ES modules, no
  bundler, no framework).
  - `js/dictionary.js` — fetches/parses `data/dictionary.json`, random
    word selection, root resolution.
  - `js/cards.js` — builds flashcard specs (word↔definition, jumbles)
    for a root word.
  - `js/jumble.js` — the custom-letter-order jumble function.
  - `js/srs.js` — the spaced-repetition scheduler.
  - `js/store.js` — persists selected words + cards + SRS state in
    `localStorage`.
  - `js/app.js` — UI wiring.
- `data/source/` — the raw Scrabble word list + attribution notes.
- `data/dictionary.json` — built dictionary asset the browser fetches
  (committed, since GitHub Pages doesn't run a build step).
- `scripts/build-dictionary.js` — regenerates `data/dictionary.json` from
  the raw word list.
- `scripts/serve.js` — local-only static file server for previewing.
