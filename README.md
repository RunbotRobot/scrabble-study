# Scrabble Study

A personal flashcard app for studying the Scrabble dictionary (NASPA Word
List 2020), built with spaced repetition.

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

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000. The dictionary is parsed from
`data/source/NWL2020.txt` into `data/dictionary.sqlite` automatically on
first run (this is gitignored, derived data). Your selected words and
review progress live in `data/study.sqlite` (also gitignored — it's your
personal, growing study state, not something to check in).

## Project layout

- `data/source/` — the raw Scrabble word list + attribution notes.
- `scripts/build-dictionary.js` — parses the raw word list into
  `data/dictionary.sqlite` (roots, senses, inflections, cross-references).
- `server/` — Express API + study/SRS logic (`node:sqlite`, no native
  dependencies).
- `public/` — plain HTML/CSS/JS frontend.
