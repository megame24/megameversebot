# Twitch Bible Verse Bot

Posts a Bible verse into Twitch chat on a configurable interval (default 30 minutes).
Runs locally on the streaming PC. Send-only — it never reads chat.

Full design and rationale: **[TWITCH_BIBLE_BOT_PLAN.md](./TWITCH_BIBLE_BOT_PLAN.md)**

## Status

| Phase | State |
| --- | --- |
| 0 — Twitch setup | not started |
| 1 — Auth + token refresh | not started |
| **2 — Verses, formatting, splitting** | **done** |
| 3 — Sending to chat | not started |
| 4 — Loop + live-gating | not started |
| 5 — Process management | not started |

Phase 2 is entirely offline — no credentials, no network.

## Requirements

Node **22.6+**. TypeScript runs directly via `--experimental-strip-types`, so there is no build
step. **Zero runtime dependencies**; `typescript` and `@types/node` are devDependencies used
only for `npm run typecheck`.

## Quick start

```bash
npm install          # devDeps only
npm run preview      # 20 random formatted verses
npm run preview -- 50
npm run typecheck
```

`preview` works immediately against a small sample file. See
[`data/README.md`](./data/README.md) to install a full translation — drop
`verses.web.json` into `data/` and it's picked up automatically.

## Layout

```
src/
├── config.ts        # env parsing; Twitch creds validated separately so offline work needs none
├── domain/types.ts  # Verse, VerseId
├── verses.ts        # load, random select with no-repeat memory, recent-list persistence
├── format.ts        # reference formatting + long-verse splitting
└── preview.ts       # offline CLI

data/                # bundled translation (public domain)
state/               # gitignored — tokens.json, recent.json
```

## How verses are chosen and formatted

**Selection** is a uniform random draw across the whole text, excluding the last
`RECENT_MEMORY` verses used (persisted to `state/recent.json` so it survives restarts). If the
cooldown ever consumes the entire pool it relaxes rather than failing — the same
cooldown-then-relax shape as `stream_cohost`'s prompt selector.

**Formatting** has to live inside Twitch's 500-character message cap. Most verses fit in one
message with the reference last:

```
"For God so loved the world..." — John 3:16 (WEB)
```

The rare long verse splits across two, with the reference on **both** parts so neither is
orphaned if other chatters separate them:

```
Esther 8:9 (WEB) 1/2 — "Then the king's scribes were called..."
Esther 8:9 (WEB) 2/2 — "which are from India to Ethiopia..."
```

Splits land on the clause boundary nearest the midpoint (`;` `:` `.` `,` in that order,
falling back to a word boundary) — never mid-word. Two parts always suffice: the longest
verse in the Bible is ~530 characters against a ~890-character two-message budget.

Run `npm run preview` to see the real split count for your translation.

## Configuration

Copy `.env.example` to `.env`. Nothing in it is needed for Phase 2. `.env` and `state/` are
gitignored — **they hold live credentials, so keep it that way.**
