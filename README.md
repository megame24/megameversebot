# Twitch Bible Verse Bot

Posts a Bible verse into Twitch chat on a configurable interval (default 30 minutes).
Runs locally on the streaming PC. Send-only — it never reads chat.

Full design and rationale: **[TWITCH_BIBLE_BOT_PLAN.md](./TWITCH_BIBLE_BOT_PLAN.md)**

## Status

| Phase | State |
| --- | --- |
| 0 — Twitch setup | **your turn** — see below |
| **1 — Auth + token refresh** | **code done**, needs credentials to run |
| **2 — Verses, formatting, splitting** | **done** |
| 3 — Sending to chat | not started |
| 4 — Loop + live-gating | not started |
| 5 — Process management | not started |

Phase 2 is entirely offline — no credentials, no network.

## Phase 0 — what you need to do

1. **Create a separate Twitch account for the bot.** It must be email/phone verified or Twitch
   silently drops its messages.
2. **Register an app** at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). Set
   the OAuth Redirect URL to exactly `http://localhost:3000/callback`. Copy the Client ID and
   generate a Client Secret into `.env`.
3. **Make the bot a moderator in your channel** — `/mod yourbotname`. Exempts it from slow mode
   and followers-only, raises its rate limit, keeps AutoMod out of the way.

Then:

```bash
cp .env.example .env    # fill in client id, secret, channel
npm run authorize       # log in AS THE BOT — whoever approves is who speaks
npm run whoami          # prints the two user IDs to paste into .env
```

`whoami` doubles as the health check — it exercises load → refresh-if-needed →
authenticated request, so it's the first thing to run when something stops working.

## Requirements

Node **22.6+**. TypeScript runs directly via `--experimental-strip-types`, so there is no build
step. **Zero runtime dependencies**; `typescript` and `@types/node` are devDependencies used
only for `npm run typecheck`.

## Quick start

```bash
npm install          # devDeps only
npm run preview      # 20 random formatted verses — no credentials needed
npm run preview -- 50
npm run typecheck
```

Once Phase 0 is done: `npm run authorize`, then `npm run whoami`.

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
├── preview.ts       # offline CLI
├── auth.ts          # token load / refresh / persist
├── authorize.ts     # one-time OAuth (run once)
├── twitch.ts        # Helix client — always sends a guaranteed-fresh token
└── whoami.ts        # validate token, resolve user IDs, health check

data/                # bundled translation (public domain)
state/               # gitignored — tokens.json, recent.json
```

## A constraint on the TypeScript you can write here

Node's `--experimental-strip-types` **erases** types; it does not transform code. So three
things are unavailable despite `tsc` accepting them without complaint:

- constructor **parameter properties** (`constructor(readonly x: number)`)
- `enum`
- `namespace`

Declare and assign class fields explicitly, and use `const` objects or union types instead of
enums. Typecheck will not catch these — they fail at runtime with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

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
