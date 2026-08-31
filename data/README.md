# Verse data

## What's here now

`verses.sample.json` — ten well-known verses, used so the project runs immediately after
clone. **It is a development placeholder, not an authoritative text.** The wording is
approximately WEB but has not been verified against the source; replace it before going live.

## Installing the real translation

Drop a file named `verses.<translation>.json` here — e.g. `verses.web.json` — and
`loadVerses()` picks it up automatically in preference to the sample. Nothing else to change.

Expected shape: a flat array of ~31,102 objects, roughly 4–5 MB.

```json
[
  { "book": "Genesis", "chapter": 1, "verse": 1, "text": "In the beginning..." }
]
```

## Where to get it

Public domain translations, safe to bundle and redistribute:

| Translation | Notes |
| --- | --- |
| **WEB** (World English Bible) | Modern readable English, unambiguously public domain. `ebible.org` is its canonical home. **Recommended.** |
| **KJV** | Traditional. Public domain in the US and most of the world; technically under perpetual Crown copyright in the UK — irrelevant in practice here, but worth knowing. |
| **ASV** (1901) | Public domain, more literal, slightly archaic. |

Several GitHub repos publish these as ready-made JSON. Whichever you use, check:

- **Verse count** — around 31,102 for a complete Protestant canon.
- **Book naming** — must be consistent, since `"<book> <chapter>:<verse>"` is the no-repeat key.
  Decide between `Psalms` and `Psalm` and stick to it.
- **Encoding** — UTF-8, and watch for curly vs straight quotes; both are fine, but they affect
  character counts against the 500-char cap.
- **Stated license** — confirm it actually says public domain.

After installing, run `npm run preview` and check the split stats line. A small fraction of a
percent needing a split is expected; hundreds would suggest the punctuation is worth a look.

## Why bundled rather than fetched from an API

48 posts a day is trivial for any API, but a local file has no rate limits, no key rotation, no
network failure mid-stream, and no licensing terms to honour. See the "Decisions locked in"
table in `TWITCH_BIBLE_BOT_PLAN.md`.
