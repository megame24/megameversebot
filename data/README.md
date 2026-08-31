# Verse data

## What's here

| File | Purpose |
| --- | --- |
| `verses.web.json` | **The World English Bible — 31,098 verses, 5.4 MB.** What the bot actually uses. |
| `verses.sample.json` | Ten verses, kept as a fallback so the project runs before the real file is fetched. Development placeholder; not authoritative. |

`loadVerses()` prefers `verses.<translation>.json` and falls back to the sample with a warning.

## Regenerating

```bash
npm run fetch-web
```

Downloads all 66 books, flattens them, validates, and writes `verses.web.json`. Idempotent —
safe to re-run.

The source stores each book as a stream of typed entries carrying paragraph and poetry
structure for printing, so a single verse can span several entries when a break falls
mid-verse. The script concatenates them in document order and normalises whitespace.

## About the five dropped verses

The fetch reports dropping five verses with no body text:

```
Luke 17:36 · Acts 8:37 · Acts 15:34 · Acts 24:7 · Romans 16:25
```

**This is expected, not corruption.** These passages appear in the Textus Receptus (and so in
the KJV) but are absent from the critical text the WEB follows. The WEB keeps the verse number
as a placeholder and moves the content to a footnote. There is nothing to post, so they are
excluded. 31,103 parsed − 5 empty = 31,098 usable.

## The divine name reads "Yahweh"

The classic WEB transliterates the Tetragrammaton as **Yahweh** (~6,800 times), so chat shows
*"Yahweh is my shepherd; I shall lack nothing"* rather than the *"the LORD"* convention familiar
from the KJV, NIV and NKJV. This is deliberate on the translators' part and shows up in a good
share of Old Testament verses.

**Do not try to fix this with find-and-replace.** It was attempted and reverted. `Yahweh` is a
proper name taking no article; `LORD` conventionally takes one. Substitution yields *"LORD is
my shepherd"* and *"is LORD of Armies"* — ungrammatical in thousands of places, and no regex can
decide reliably (`Yahweh said` → *the LORD said*, but `O Yahweh` → *O the LORD* is wrong).
Handling `Lord Yahweh` → `Lord GOD` is easy; the article problem is not.

If the LORD convention matters more than everything else, the real options are the WEB **British
Edition (WEBBE)**, which uses it natively with proper editorial handling, or the **KJV**. Both
are public domain. WEBBE was investigated and the JSON sources found were stale and
poorly-structured; ebible.org distributes it as USFM, which needs a real parser. That is the
work required — not a substitution pass.

## Why the WEB

Modern readable English and unambiguously public domain — no key, no rate limits, no network
dependency, no attribution obligation, no terms to honour. Alternatives if you ever want to
switch: **KJV** (public domain; technically perpetual Crown copyright in the UK, not a
practical concern) and **ASV 1901** (public domain, more literal).

Copyrighted translations — NKJV, NIV, ESV, NLT — cannot be bundled. ESV and NET offer free
non-commercial APIs, but that means a key, rate limits, network failure handling mid-stream,
and required attribution eating into the 500-character budget.

## If you swap in a different translation

Check:

- **Verse count** — roughly 31,000 for a complete Protestant canon.
- **Book naming** — must be internally consistent, since `"<book> <chapter>:<verse>"` is the
  no-repeat key. Pick `Psalms` or `Psalm` and never mix.
- **Encoding** — UTF-8. Curly vs straight quotes both work but change character counts against
  the 500-char cap.
- **License** — confirm it actually says public domain.

Then run `npm run preview` and read the split-stats line. For the WEB it is **1 verse out of
31,098** (Esther 8:9, 491 characters). Hundreds would mean the punctuation splits badly and is
worth investigating.

## Why bundled rather than fetched from an API

48 posts a day is trivial for any API, but a local file has no rate limits, no key rotation, no
network failure mid-stream, and no licensing terms to honour. See the "Decisions locked in"
table in `TWITCH_BIBLE_BOT_PLAN.md`.
