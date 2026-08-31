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
| **3 — Sending to chat** | **code done**, unverified against live Twitch |
| **4 — Loop + live-gating** | **code done**, unverified against live Twitch |
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
cp .env.example .env         # fill in client id, secret, channel
npm run authorize            # log in AS THE BOT — whoever approves is who speaks
npm run whoami               # prints the two user IDs to paste into .env
npm run send-test -- --dry-run   # format a verse, send nothing
npm run send-test            # post one verse to chat for real
npm start                    # run the bot
```

## Running the bot

```bash
npm start                                        # uses .env
npm start -- --interval=5                        # override the interval, in minutes
npm start -- --interval=1 --jitter=0 --ignore-live   # fast loop for testing
```

Start it before going live, Ctrl-C when you're done. It posts only while the stream is up
unless you pass `--ignore-live`.

**Interval** comes from `INTERVAL_MINUTES` (default 30) with `JITTER_MINUTES` (default ±2) of
drift so it doesn't land on the same clock minute forever. CLI flags override both, which is
how you test without waiting half an hour.

**While offline** the timer is left alone rather than reset, so once you go live the interval
has long since elapsed and a verse lands shortly after — rather than making you wait a full
interval into the stream.

**Sleep-safe:** the loop polls and compares elapsed wall-clock time instead of trusting
`setInterval`'s period, which stalls while the machine sleeps. `npm run check` asserts the
timing arithmetic.

**On failure** it backs off ~2 minutes rather than burning a whole interval, and keeps running.
An auth failure is logged prominently, since nothing will post until it's resolved.

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

The full World English Bible (31,098 verses) is committed in `data/`. To regenerate it:

```bash
npm run fetch-web
```

See [`data/README.md`](./data/README.md) for why the WEB, what the five dropped verses are,
and what to check if you swap translations.

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
├── whoami.ts        # validate token, resolve user IDs, health check
├── post.ts          # one full cycle: pick → format → send → remember
├── send-test.ts     # post a single verse now
├── schedule.ts      # interval/jitter/poll arithmetic
├── check-schedule.ts# assertions over that arithmetic
└── index.ts         # the bot — loop, live-gating, shutdown

data/                # bundled translation (public domain)
state/               # gitignored — tokens.json, recent.json
```

## HTTP 200 does not mean the message was delivered

Twitch's send endpoint answers **200 with `is_sent: false`** when something drops the message
downstream — AutoMod held it, the channel is in followers-only or subscriber-only mode, or the
bot account isn't verified. Treating 200 as success produces a bot that cheerfully reports
posting verses nobody ever saw.

`sendChatMessage` returns `isSent` and any `dropReason`; `postVerse` surfaces it as `delivered`,
and `send-test` exits non-zero with the likely causes. Keep that check in place in any new
send path.

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
falling back to a word boundary) — never mid-word.

In the WEB this affects **exactly one verse of 31,098** — Esther 8:9, at 491 characters. Two
parts always suffice, against a two-message budget of ~890. Run `npm run preview` to see the
count for any translation you swap in.

## Configuration

Copy `.env.example` to `.env`. Nothing in it is needed for Phase 2. `.env` and `state/` are
gitignored — **they hold live credentials, so keep it that way.**
