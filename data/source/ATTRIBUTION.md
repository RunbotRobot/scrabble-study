# Source data

`NWL2020.txt` is the NASPA Word List 2020 (the current North American
tournament Scrabble dictionary), in the headword+definition+inflections
format maintained by the [scrabblewords/scrabblewords](https://github.com/scrabblewords/scrabblewords)
project.

Per that project's `words/README`, the word definitions trace back to the
OSPD definitions file obtained "with permission" for that word-list format,
and have been used in personal Scrabble study/lookup tools (e.g. Zyzzyva)
for many years.

This app uses the file strictly for **personal, non-commercial study
flashcards** (generating quiz cards from the words and definitions), not
redistribution of the dictionary itself as a product.

## File format

Each line is one entry:

```
WORD definition-for-sense-1 [pos1 INFLECTION1, INFLECTION2, ...] / definition-for-sense-2 [pos2 ...]
```

- A definition of the exact form `<otherword=pos>` means this entry is a
  pure inflected form of `otherword` (used as that part of speech) — the
  "root" for that sense lives at `otherword`'s entry.
- A `{otherword=pos}` appearing *inside* a definition is shorthand for
  "see `otherword`" and is expanded to just `otherword` when building
  flashcards.
- A single word can be a root for one part of speech and an inflected form
  of a *different* word for another part of speech (e.g. `ARE` is its own
  noun root — a unit of surface measure — and also the verb form of `BE`).
