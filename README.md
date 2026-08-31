# Scrabble Study

A personal flashcard app for studying the Scrabble dictionary (NASPA Word
List 2020), built with spaced repetition. It's a fully static site — no
server, no backend, no Node required on the device you study on. Deployed
via GitHub Pages at **https://runbotrobot.github.io/scrabble-study/**.

## How word selection works

New words arrive automatically, tied to a 50-answer correct streak (see
below). You can also queue specific words yourself from the **?** lookup
panel (see "Looking up a word" below) — its Add button joins a queue
(oldest first) that's drained before any random picks the next time a
batch is generated, so words you ask for show up in the very next batch.
Each time a batch is generated:

1. A word is picked — from your queue if it has anything waiting,
   otherwise at random from the *entire* word list (root, conjugated, or
   plural form, with uniform probability — no weighting toward common,
   "useful," or alphabetically-early words).
2. That word is resolved to its dictionary root(s). Most words resolve to
   exactly one root (e.g. `WENT` → `GO`), but some resolve to more than
   one root because they're independently meaningful under different
   parts of speech (e.g. `ARE` is its own noun root — a unit of surface
   measure — *and* the verb form of `BE`), and a plural/invariant word
   like `CATTLE` is simply its own root.
3. For each newly-discovered root, up to four kinds of flashcards are
   created:
   - **Word → Definition** and **Definition → Word** — only for roots 8
     letters or shorter. Longer roots skip these two entirely.
   - **Endings** — also only for roots 8 letters or shorter; see "Endings
     cards" below.
   - **Jumble** — one per distinct conjugated/pluralized form of the
     root that's 8 letters or shorter, plus one for the root word itself
     (also if 8 letters or shorter), with the letters arranged in the
     fixed custom order `QVUWGBFJYOPLKITMDCNHARZXES` (deterministic, not
     a random shuffle) — see "Jumbles and anagram solutions" below.
     Longer forms don't get a jumble card.
   - A root with no dictionary definition on file (some newer Scrabble
     words only have a part of speech, no gloss) only gets jumble cards
     (plus an endings card, if it has conjugations/plurals or the like).
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
shorthand notation into the plain word it refers to; pulling out any
trailing "self-explanatory derived form" pointer (see "Endings cards")
into its own card instead of leaving it stuck in the definition text; and
dropping the part-of-speech tag the source data carries per sense (`n`,
`v`, `adj`, ...) — it's almost always obvious from the definition itself,
so showing it added noise without adding information.

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
eligible, ranked by a priority score. (This is deliberate: a hard due
date means you eventually run out of due cards and hit a dead end with
nothing left to study, even though you have plenty of cards that could
still use review.) Priority combines two things:

- how overdue it is, as a fraction of its own spaced-repetition interval
  — a 1-day-old card that's 2 days late is more urgent than a 30-day-old
  card that's also 2 days late, even though the raw lateness is the same
- how much harder than average it's been recently, via the same `ease`
  value the SM-2 scheduler already tracks (it falls on a miss, rises on
  a streak of correct answers)

The next card is picked at random, weighted toward higher priority,
rather than always strictly the single highest. That matters in
practice: cards that graduated together tend to start out tied (nothing's
overdue yet, so `ease` is the only thing distinguishing them), and always
picking the strict max in a tie means whichever card happens to be ahead
by a hair keeps winning forever — which, if e.g. one card type has taken
a few more early misses than another, can starve that other type out of
the rotation completely. Weighting instead of hard-maxing means a
clearly-more-urgent card is picked far more often, but nothing is ever
fully locked out.

## Tracking recent mistakes

Missing an already-graduated ("review"-phase) card pulls it out of
rotation immediately — it's held in a "recently missed" pile and won't
come up again until the pile is dealt with, rather than staying in normal
rotation where you might see (and re-miss) it again before that happens.
Once the pile reaches 50 distinct cards, all 50 go back into intensive
intro drilling together (the exact same mechanism as a fresh batch of new
words), and the pile resets to build up again from there. Misses on
intro-phase cards don't feed this pile — they're already getting
intensive round-robin drilling (see above), so folding them in here too
would be redundant.

The next card shown never repeats the one you were just graded on, as
long as any other card exists to show instead. Without that, a card that
was the sole (or tied-oldest) remaining intro card would get picked right
back as "the next card" the instant you missed it — a miss resets its
reps to 0, so it never graduates out of intro on its own — and looping
back to the exact same question over and over reads exactly like grading
it wrong isn't doing anything, even though it is.

## Card presentation

Word↔definition cards always show a **Word** column on the left and a
**Definition** column on the right, regardless of which one is the
question and which is the answer — that positioning *is* the signal for
which kind of card it is, instead of a text label. Whichever side is the
answer is hidden behind a fixed, generic placeholder (not a CSS blur
filter over the real text, which would still leak its length/shape) —
you find out what's actually there by tapping "Show answer" like normal.
Once revealed, the answer side gets a background tint distinct from the
"given" side, so it's obvious at a glance which piece you were actually
asked to produce.

Whenever a definition is visible — revealed on a word2def card, or given
from the start on a def2word card — a small illustration appears beneath
it, generated from that definition (see "Root word images" below). It
never appears before the definition itself does, since it would
otherwise give away the answer on a word2def card.

## Endings cards

Some root senses point at a "self-explanatory" derived word instead of
carrying their own definition — e.g. `ANERGY`'s noun sense ("lack of
energy") also derives the adjective `ANERGIC`, whose meaning follows
straightforwardly once you know `ANERGY` and doesn't need spelling out
separately. Rather than leaving that pointer stuck inside the definition
text, it gets its own **Endings** card, along with the root's
conjugations/plurals and its `RE-`/`UN-`-prefixed form(s) (`READD`,
`UNPALATABLE`, etc.), whichever of those exist and are valid Scrabble
words. Forms are ordered rather than alphabetized: verb conjugations
read `-ED, -ING, -S` (e.g. `PREVISED, PREVISING, PREVISES`), and where a
root has both a regular and an irregular plural, the regular one comes
first (e.g. `MACULAS, MACULAE`). Endings cards share
the word2def two-column layout (root word on the left) but carry an
"Endings" label and a background color distinct from a definition's,
visible even before "Show answer" so it reads as an endings card at a
glance rather than looking like a word2def card until you flip it.

## Jumbles and anagram solutions

A jumble's letters are always shown in a fixed custom order — dubbed a
**valuegram**, after the "alphagram" terminology from competitive
Scrabble study — rather than alphabetically or shuffled randomly:
`QVUWGBFJYOPLKITMDCNHARZXES`. That order isn't arbitrary; it runs from
the tiles most valuable to hold (rarest/highest-scoring, like Q and V)
down to the least (most common, like E and S), by true relative Scrabble
value rather than the point value printed on the tile.

Some jumbles have more than one valid solution — anagrams of each other
that are both real dictionary words (e.g. `BOITNARE` solves to both
`BARITONE` and `REOBTAIN`, among others). Since only one of them was
necessarily the word the card was built from, guessing any correct
solution should count as getting it right. The card tells you upfront how
many solutions exist, and "Show answer" lists all of them, each also in
valuegram order — but only the ones that are actually in your deck (i.e.
you have a jumble card for that exact word). The dictionary usually has
more anagram solutions than that; the rest aren't shown, since they're
not something you're being asked to already know. On "Show answer", each
distinct root among the deck's solutions gets its own illustration (see
"Root word images" below) laid out in a row — a jumble with several
valid answers genuinely depicts several different things, so a solution
that's an inflected form of another solution's root (rare, since the two
would need identical letters) collapses onto that root's one shared
picture instead of generating its own.

## Root word images

Each root with a definition gets a small illustration slot — shown on
word2def/def2word cards and endings cards (see "Card presentation"
above), on jumble cards (see above), and in the lookup panel.

When the picture appears differs by card, and follows one rule: it
shows as soon as it can't give away what's being asked. On a def2word
card the definition is the prompt, so it's up from the start; on a
word2def card the definition *is* the answer and a picture of it would
spoil the recall, so it waits for "Show answer". An endings card asks
for conjugations, plurals and RE-/UN- forms — nothing a picture of the
root's meaning hints at, and the word itself is printed right above it
— so there it's up from the start too, where it can actually help you
place the word while you dig for its endings. It sits under the word,
in the left column, rather than in the answer column. Nothing in this app calls
an image-generation API itself: every free option tried was a dead
end, one way or another —

- **Pollinations.ai** was free and keyless, but its free tier turns out
  to serve exactly one underlying model (Sana — its documented `model=`
  param for flux/turbo/etc. is silently ignored, confirmed by
  requesting both and diffing the bytes, not just trusting the docs).
  Left to describe an abstract dictionary definition directly, it
  strongly favors rendering human faces/figures, including a real,
  repeatable tendency toward outright nudity for entirely G-rated
  definitions — verified directly, more than once, not a hypothetical —
  and doesn't reliably honor negative instructions like "no nudity"
  stated in the prompt. Framing the prompt around a concrete inanimate
  object ("product photography of X," not "an illustration of X")
  mostly sidestepped it, but "mostly" isn't good enough odds for
  something generating unprompted, uncensored images.
- **Gemini's API** free tier reports a request limit of **0** for every
  image-capable model, confirmed directly against a real key via the
  API's own error responses — image generation there currently requires
  a billed Google Cloud project, not just an API key.
- **Hugging Face's Inference Providers** free tier is real but tiny
  ($0.10/month in credits) — nowhere near enough to keep up with adding
  50 words at a time.

So image generation here is a manual step instead: for a root with no
picture yet, its slot shows a **Copy Gemini prompt** button — copies a
ready-made prompt (word + definition, worded to read as a plain literal
illustration) to your clipboard — plus three ways to get the picture
back in once you've generated it yourself, in Gemini's own app or
anything else:

- **Paste image**, which reads the clipboard directly
  (`navigator.clipboard.read()`). This is the one that matters on a
  phone, where copying the picture out of Gemini and tapping this
  button never involves the camera roll. The browser may ask
  permission, or interpose its own paste confirmation, the first time.
- **Long-press the box and pick Paste.** The box is `contenteditable`
  for exactly this reason: a phone offers its paste menu over editable
  targets only, so while this was a focusable-but-not-editable `div`
  there was simply no Paste to tap, and the only route left was saving
  to storage and using "Choose a file". Desktop Ctrl+V lands here too.
  A paste that arrives as markup rather than on the event — Safari
  likes to insert an `<img>` and leave `clipboardData` empty — is read
  back out of the box and uploaded the same way.
- **Choose a file**, for a picture that's already saved somewhere. That upload goes to the worker's `PUT /image/:word`
(raw image bytes, `Content-Type: image/*`) and is stored in Cloudflare
R2, shared globally rather than per-device — every other device, and
every other word that happens to share a root, benefits from that one
upload. `GET /image/:word` 404s until something's been uploaded
(nothing is ever generated automatically); `DELETE /image/:word` evicts
a stored image, e.g. to redo one you're not happy with. The slot's own
"Replace image" button doesn't call that — it just reopens the
upload UI, and the replacement `PUT` overwrites in place — so `DELETE`
is for genuinely removing a picture rather than swapping it.

Those URLs are cached with `no-cache` plus an ETag: the browser may
store the bytes but has to revalidate before reusing them, which is a
cheap 304 whenever the picture hasn't changed. That matters because
`/image/:word` is *mutable* — the same URL answers differently after a
`PUT` or `DELETE`. It was originally served as
`max-age=31536000, immutable`, which was a promise the endpoint
couldn't keep: when the entire first generation of images was deleted,
every browser that had displayed one went on showing it anyway, with
`immutable` suppressing even a reload's revalidation and no header able
to reach an entry already stored under it. Dislodging those needed a
new URL, hence the `?v=` on `imageUrlFor` (`js/images.js`) — a one-time
bump, not a per-image version.

Roots with no definition on file get no image slot at all; there's
nothing meaningful to illustrate.

Each slot (`js/images.js`'s `mountImageSlots`) checks whether a picture
already exists (a quick, near-instant `GET`, unlike the old
auto-generate-on-miss design — no reason for a progress bar anymore)
and shows one of two things: the image itself, or the copy-prompt/
paste-a-picture flow. Pasting an image (`Ctrl+V`/`Cmd+V` after clicking
the paste zone) or choosing a file both `PUT` the bytes straight to the
worker; a preview shows immediately via `URL.createObjectURL()` rather
than waiting on a round-trip re-fetch. An upload failure shows inline
next to the paste zone rather than failing silently.

## Options panel and looking up a word

The **⚙** button in the header opens an Options panel with two things:
Cloud sync (see below), and a **?** button that opens the word lookup
panel. Type any word there to see whether it's valid ("PHONY" if not),
its root(s)' definition(s), and its conjugations/plurals. If every root
the word resolves to is already in your deck, you'll also see your
current quizzing stats for each of its cards (learning vs. reviewing,
miss count); otherwise an **Add** button queues it — see "How word
selection works" above.

## Installing as an app

The site is a PWA — on a phone, use your browser's "Add to Home Screen" /
"Install app" option to get it as a standalone app icon, launching without
browser chrome. A service worker caches the app shell and dictionary data
on first visit, so it keeps working offline after that.

The service worker's app-shell strategy is meant to be network-first —
an online visit should always pick up whatever's actually deployed. But
a plain `fetch()` can still be silently served from the *browser's own*
HTTP cache underneath the service worker, if the host sends cacheable
headers on static files (GitHub Pages does) — "network-first" only
means "don't fall back to the service worker's own cache unless the
network fetch fails," not "always actually reach the network." When
that happens, no amount of reloading picks up a new deploy until that
HTTP cache entry expires on its own. The shell fetch now explicitly
forces `cache: 'no-store'` to close that gap.

## App version

The Options panel shows the running version (from `version.json`,
bumped by hand on every deploy that changes client-visible behavior —
there's no build step to derive it from the git commit automatically).
Besides being a way to confirm what you're actually running, it's also
how the app detects a stale tab: every 5 minutes, and whenever the tab
comes back to the foreground, it re-fetches `version.json` with
`cache: 'no-store'` (bypassing every caching layer, including the HTTP
cache issue above) and reloads if that disagrees with what was loaded
at startup — catching a deploy that happened after this page loaded
far sooner, and only when something actually changed, than the blind
"reload after 12 hours regardless" heuristic this replaced.

## Spaced repetition

Each flashcard tracks its own simplified SM-2 state (interval, ease,
reps/lapses). Answering a card correctly pushes its next appearance
further out; answering incorrectly brings it back soon (10 minutes) and
shrinks its ease, so missed cards resurface more often.

## Where your progress lives

Every read/write always goes through this browser's IndexedDB first
(see `js/idb-store.js`), so the app is fully usable offline and never
blocks on the network. On top of that, a small Cloudflare Worker + D1
database (see `worker/`) acts as a durable backup and cross-device sync
layer:

- Open the **⚙** Options panel and tap **Start cloud sync**. This generates a
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

This app used to store everything directly in `localStorage`, which
turned out to be a bad fit specifically because it's hosted on GitHub
Pages: `localStorage` is shared per *origin*, not per site/path, so
every project under `runbotrobot.github.io` — this one, and any other
unrelated app — draws from the exact same small (historically ~5MB)
quota. One app filling it starves every other app at that origin
regardless of how little any individual app writes, which is exactly
what happened here (another project's page was writing several MB into
that shared bucket). `js/idb-store.js` now persists everything in
IndexedDB instead — a separate, much larger quota (see
`navigator.storage.estimate()`) that isn't susceptible to the same
collision. The first time this runs on a browser that still has data
under the old `localStorage` keys, it's migrated into IndexedDB once
and then removed from `localStorage`, so it stops competing for that
shared quota too; any other app's keys there are left untouched.

IndexedDB is inherently asynchronous, but this app's data is small
enough to keep entirely in memory once loaded — so the design is:
await one async load at startup, then read/write the in-memory copy
synchronously from there (writes also flush through to IndexedDB in
the background), rather than threading `async`/`await` through every
single read across the whole app.

A "storage quota exceeded" error is still possible in principle — this
app's own data stays in the tens-to-low-hundreds of KB even after
months of daily use, nowhere near IndexedDB's typical multi-GB quota —
but now that quota is the same one `navigator.storage.estimate()`
reports, so that diagnostic (shown in the error message, appended a
moment after it renders since the check itself is async) is actually
meaningful here, unlike it was for `localStorage`'s own separate,
unrelated quota.

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
it back up. Same for the `scrabble-study-images` R2 bucket the image
endpoint reads/writes/deletes — no API key needed, since nothing here
calls an image-generation service (see "Root word images").

## Project layout

- `index.html`, `style.css`, `js/` — the static site (ES modules, no
  bundler, no framework).
  - `js/dictionary.js` — fetches/parses `data/dictionary.json`, random
    word selection, root resolution, and the lazily-built anagram index
    behind `getAnagramSolutions()`.
  - `js/cards.js` — builds flashcard specs (word↔definition, endings,
    jumbles) for a root word.
  - `js/jumble.js` — the custom-letter-order jumble function and
    `compareByValuegram()`, the sort it also powers.
  - `js/srs.js` — the spaced-repetition scheduler.
  - `js/streak.js` — tracks the consecutive-correct streak and its
    every-50 milestones.
  - `js/idb-store.js` — the async-loaded, sync-thereafter IndexedDB
    key/value layer everything else in this list persists through (see
    "Where your progress lives" above).
  - `js/store.js` — selected words + cards + SRS state + queued words;
    batch generation, intro-vs-review card selection, and the merge
    primitives `js/sync.js` uses.
  - `js/sync.js` — cloud backup/sync engine (push/pull against the
    worker, last-write-wins merge, retry-friendly).
  - `js/images.js` — the copy-prompt/paste-a-picture illustration
    slots (see "Root word images" above).
  - `js/sync-ui.js` — the Cloud sync panel.
  - `js/lookup-ui.js` — the "?" word lookup panel.
  - `js/app.js` — UI wiring.
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA install manifest,
  service worker, and app icons.
- `data/source/` — the raw Scrabble word list + attribution notes.
- `data/dictionary.json` — built dictionary asset the browser fetches
  (committed, since GitHub Pages doesn't run a build step).
- `scripts/build-dictionary.js` — regenerates `data/dictionary.json` from
  the raw word list.
- `scripts/serve.js` — local-only static file server for previewing.
- `worker/` — the Cloudflare Worker (`index.js`) + its config
  (`wrangler.toml`) for the sync backend.
- `.github/workflows/deploy-worker.yml` — auto-deploys `worker/` on push.
