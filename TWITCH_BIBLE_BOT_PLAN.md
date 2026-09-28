# Twitch Bible Verse Bot — Build Plan

A bot that posts a Bible verse into Twitch chat on a configurable interval (default 30
minutes), running locally on the streaming PC. Unrelated to Proficio; parked here for
convenience.

---

## Decisions locked in

| Decision | Choice | Consequence |
| --- | --- | --- |
| **Interactivity** | Timer only — send-only, never reads chat | No message parsing, no cooldowns, no moderation surface. `!verse` can be added later without changing hosting. |
| **Hosting** | The streaming PC | Free, no accounts, no cloud. Runs exactly when you're live. Token state is a local file. |
| **Translation** | Public domain (WEB / KJV / ASV) bundled locally | No API key, no rate limits, no network dependency, no licensing questions. |
| **Selection** | Random across all 31,102 verses | Zero curation. Genealogies and census lists will land occasionally — accepted deliberately. |
| **Long verses** | Split across two messages | Nothing is dropped from the pool, which is truer to "random across the whole Bible" than filtering. |

**Stack:** TypeScript on Node 20+. **Zero runtime dependencies** — built-in `fetch`, `fs`, and
a local JSON file. Nothing to audit, nothing to break.

> **A note on Twitch API specifics.** Twitch's chat API surface has shifted over time (the older
> path was IRC with `chat:read`/`chat:edit`; the newer one is Helix + EventSub). Endpoint names,
> scopes, and rate limits below reflect what was current as of writing and should be confirmed
> against the live Twitch developer docs as you build. The architecture doesn't change either way
> — only the specific call shapes.

---

## Architecture

```
  ┌──────────────────────────────────────────────────┐
  │  Node process (runs on your streaming PC)        │
  │                                                  │
  │   every N minutes:                               │
  │     1. is the stream live?  ─── no ──▶ skip      │
  │     2. pick a random verse (excluding recent)    │
  │     3. format → 1 or 2 messages, each ≤500 chars │
  │     4. refresh token if near expiry              │
  │     5. POST each part to Twitch Helix, in order  │
  │     6. record verse as recently used             │
  └──────────────────────────────────────────────────┘
          │                │                │
    verses.json      tokens.json       recent.json
    (~4MB, read-only)  (gitignored)     (gitignored)
```

No database, no server, no inbound connections, no cloud account.

---

## Project structure

```
twitch-bible-bot/
├── src/
│   ├── index.ts        # entry point + scheduler loop
│   ├── config.ts       # env parsing and validation
│   ├── authorize.ts    # ONE-TIME OAuth script (run manually, once)
│   ├── auth.ts         # token load / refresh / persist
│   ├── twitch.ts       # Helix calls: sendMessage, isLive, resolveUserId
│   ├── verses.ts       # load, random select, no-repeat memory
│   └── format.ts       # reference formatting + long-verse splitting
├── data/
│   └── verses.web.json # bundled public-domain translation
├── state/              # gitignored — runtime state
│   ├── tokens.json
│   └── recent.json
├── .env                # gitignored
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

`.gitignore` must contain `.env` and `state/` **from the first commit**. Tokens are credentials.

---

## Phase 0 — Twitch setup (no code, ~20 min)

1. **Create a separate Twitch account for the bot.** Messages will appear from this account, so
   pick the display name you want in chat. It **must be email/phone verified** — unverified
   accounts have their chat messages silently rejected, which is a confusing failure to debug.

2. **Register an application** at `dev.twitch.tv/console/apps`:
   - Note the **Client ID** and generate a **Client Secret**.
   - Set the OAuth Redirect URL to `http://localhost:3000/callback`. Twitch permits localhost
     redirects, which is what makes the one-time auth script in Phase 1 possible.

3. **Make the bot account a moderator in your channel** — `/mod yourbotname` from your main
   account. This:
   - exempts it from slow mode and followers-only mode,
   - raises its rate limit (roughly 100 messages per 30s vs 20 for a normal user),
   - stops AutoMod from interfering with its messages.

   Skipping this produces mystery non-delivery later, especially if you ever turn on slow mode.

**Done when:** the bot account exists, is verified, is a mod in your channel, and you have a
Client ID + Secret written down.

---

## Phase 1 — Auth and token refresh

**This is the phase that decides whether the bot is still alive in two months.** Everything else
here is straightforward; this is where hobby bots quietly die. Twitch user access tokens expire
after a few hours, so a token pasted into a config file will work beautifully during testing and
then stop forever, usually mid-stream.

### One-time authorization (`src/authorize.ts`)

Run manually, once. Roughly 40 lines:

1. Start a local HTTP server on port 3000.
2. Open the browser to Twitch's authorize URL (client ID, redirect URI, scopes, `response_type=code`).
3. Log in **as the bot account** and approve.
4. Catch the `?code=` on the callback.
5. Exchange it at `POST https://id.twitch.tv/oauth2/token` for an access token + refresh token.
6. Write `state/tokens.json`, shut the server down, print "done".

**Scopes:** you need send-message permission for the bot account — `user:write:chat` is the
relevant one under the current Helix chat API. Depending on how Twitch has evolved this, you may
also need `user:bot` on the bot and `channel:bot` granted by the broadcaster, though being a
channel moderator (Phase 0) generally satisfies the channel side. **Confirm the exact scope list
against the current "Send Chat Message" endpoint docs before building the authorize URL** — this
is the single detail most likely to have moved.

### Refresh logic (`src/auth.ts`)

`ensureFreshToken()` runs before every send:

```ts
if (Date.now() > tokens.expiresAt - FIVE_MINUTES) {
  const res = await refresh(tokens.refreshToken);   // grant_type=refresh_token
  tokens = {
    accessToken:  res.access_token,
    refreshToken: res.refresh_token ?? tokens.refreshToken,
    expiresAt:    Date.now() + res.expires_in * 1000,
  };
  writeFileSync('state/tokens.json', JSON.stringify(tokens));  // ← the step people forget
}
```

Three things to get right:

- **Write the refreshed tokens back to disk.** Refreshing in memory only works until the process
  restarts, then you're using a stale token. This is the classic bug.
- **Persist whatever refresh token comes back.** Twitch may issue a new one on refresh; don't
  assume the original stays valid indefinitely.
- **Fail loudly on refresh failure.** If the refresh token has been revoked (password change,
  disconnected app), log a clear `re-run: npm run authorize` message. Silent retry loops mean you
  discover the problem three streams later.

**Done when:** you run the bot, kill it, wait an hour, restart it, and it still holds a valid
token with no manual intervention.

---

## Phase 2 — Verses, selection, formatting, splitting

Fully offline. No network, no Twitch. Build and verify this completely before touching Phase 3.

### Data

Download a public-domain translation as JSON into `data/`:

| Translation | Notes |
| --- | --- |
| **WEB** (World English Bible) | Modern readable English, unambiguously public domain. `ebible.org` is its canonical home. **Recommended.** |
| **KJV** | Traditional. Public domain in the US and most of the world; technically under perpetual Crown copyright in the UK — irrelevant in practice for a Twitch stream, but worth knowing. |
| **ASV** (1901) | Public domain, more literal, slightly archaic. |

Several GitHub repos publish these as ready-made JSON. Check data quality (verse counts,
encoding, curly vs straight quotes) and the stated license on whichever you pick.

Target shape — a flat array of ~31k entries, ~4–5MB, loads into memory instantly:

```json
{ "book": "John", "chapter": 3, "verse": 16, "text": "For God so loved the world..." }
```

### Measure before you build the splitter

Once the data loads, get the real number instead of trusting an estimate:

```ts
const over = verses.filter(v => v.text.length > 445);
console.log(`${over.length} of ${verses.length} verses need splitting`);
console.log(over.slice(0, 10).map(v => `${v.book} ${v.chapter}:${v.verse} (${v.text.length})`));
```

Expect a small number — likely well under 1%. If it comes back in the hundreds, inspect whether
your translation's punctuation splits cleanly before committing to the approach.

### The 500-character budget

Twitch caps chat messages at 500 characters. Working backwards, with the reference as a prefix:

| Component | Chars |
| --- | --- |
| Worst-case prefix `Song of Solomon 8:14 (WEB) 1/2 — ` | ~33 |
| Quote marks | 2 |
| Safety margin | ~20 |
| **Text budget per message** | **~445** |
| **Across two messages** | **~890** |

The longest verse in the Bible (Esther 8:9) is around 530 characters, so **two parts always
suffice** — there is no three-part case for any real verse. Build the splitter generically, but
log an error if it ever wants a third part; that indicates malformed data, not scripture.

### Formatting

Single-message case:

```
"For God so loved the world..." — John 3:16 (WEB)
```

Split case — **the reference goes on both parts**:

```
Esther 8:9 (WEB) 1/2 — "Then the king's scribes were called at that time...
                        and the governors and princes of the provinces;"

Esther 8:9 (WEB) 2/2 — "which are from India to Ethiopia... and to the Jews
                        in their writing, and in their language."
```

The repeated reference costs ~30 characters you have to spare, and earns them back the moment
part 2 gets separated from part 1 by other chatters. A bare orphaned fragment with no reference
reads like the bot glitched. The `1/2` marker also tells a reader who only sees part 1 that
there's more coming, which is why no ellipsis is needed.

### Split algorithm

Never a hard character cut — that produces mid-word breaks. Split at the best **clause boundary**
nearest the midpoint, searching in priority order for a break that leaves both halves under budget:

1. `; ` — semicolon (biblical prose is full of these, especially KJV)
2. `: ` — colon
3. `. ` — sentence end
4. `, ` — comma
5. ` ` — any word boundary (fallback)

Biblical text is heavily comma-spliced, so you'll almost always land a clean semicolon or comma
within a few words of the midpoint.

### Selection and no-repeat memory

Random draw across all verses, excluding the last ~500 used. Persist the recent list to
`state/recent.json` so it survives restarts. Across 31k verses you'd rarely repeat anyway, but
this makes it impossible within a run of streams.

**Done when:** `npm run preview` prints 20 random formatted verses to the console, every message
is under 500 characters, and forcing a known-long verse produces two sensibly-broken parts.

---

## Phase 3 — Sending to chat

Use the **Helix REST endpoint** (`POST /helix/chat/messages`) rather than IRC. For a send-only
bot, a stateless HTTP call beats holding a WebSocket open for 30 minutes to send one line.

You need two user IDs — your channel's and the bot's. Resolve both once via `GET /helix/users`
and cache them in config rather than looking them up on every tick.

**Sending split messages — send sequentially, never concurrently:**

```ts
for (const [i, part] of parts.entries()) {
  await sendMessage(part);          // await the response before the next
  if (i < parts.length - 1) await sleep(500);
}
```

Two `fetch` calls fired in parallel can arrive out of order, and `2/2` landing before `1/2` looks
broken. The short delay between parts also reads better in chat than dumping both instantly.

**Twitch's duplicate-message filter is a non-issue here** — it blocks *identical* consecutive
messages, and your two halves differ. Worth knowing it exists so you don't chase it later.

**Done when:** a verse appears in your chat, and a forced long verse appears as two correctly
ordered messages.

---

## Phase 4 — The loop and live-gating

### Live check

Call `GET /helix/streams?user_login=<yourchannel>` before each post. An empty `data` array means
offline — skip and log. Without this the bot cheerfully preaches to an empty room for sixteen
hours a day.

Make it a config flag (`ONLY_WHEN_LIVE`) so you can turn it off for testing.

### Scheduling — poll elapsed time, don't trust `setInterval`

You're hosting on a machine that sleeps. `setInterval` stalls during sleep and can fire oddly on
wake. Instead, tick every 60 seconds and compare against a stored timestamp:

```ts
setInterval(() => {
  if (Date.now() - lastPostAt >= nextIntervalMs) void tick();
}, 60_000);
```

On wake from sleep, the next tick fires within a minute and correctly notices the interval
elapsed. Robust and trivially simple.

### Jitter

Posting at exactly `:00` and `:30` every single time reads as robotic. Recompute
`nextIntervalMs` after each post as `INTERVAL_MINUTES ± JITTER_MINUTES`. Small touch, noticeably
more natural.

### Tick sequence

```
tick():
  1. if ONLY_WHEN_LIVE and stream is offline  → log, return
  2. verse = pickVerse()                       # excludes recent
  3. parts = formatAndSplit(verse)             # 1 or 2 messages
  4. await ensureFreshToken()
  5. for each part: await send(part); sleep(500)
  6. recordRecent(verse.id); lastPostAt = now
  7. nextIntervalMs = interval ± jitter
```

**Done when:** it posts on schedule while you're live, stays quiet while you're offline, and
survives the PC sleeping and waking.

---

## Phase 5 — Running it

An `npm start` you fire before going live is genuinely fine to begin with, and it gives you a
console with logs you can watch.

If you want it hands-off later:
- **Windows:** Task Scheduler, trigger at logon.
- **macOS:** a `launchd` agent, or `pm2 start` with `pm2 save`.

Add restart-on-crash once you've watched it survive a few streams. Log every tick — post, skip,
and error — so a silent bot is diagnosable after the fact.

---

## Configuration

`.env` (gitignored; commit a `.env.example` with the same keys and empty values):

```
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_CHANNEL=yourchannel        # your channel login name
BOT_USER_ID=                      # resolved once via GET /helix/users
CHANNEL_USER_ID=                  # resolved once via GET /helix/users

INTERVAL_MINUTES=30
JITTER_MINUTES=2
OPENING_VERSE_MINUTES=5           # first verse of every stream, regardless of interval
POST_ON_START=false
ONLY_WHEN_LIVE=true

TRANSLATION=WEB
MAX_MESSAGE_CHARS=445             # per-message text budget, not an eligibility gate
RECENT_MEMORY=500
```

Validate these on startup and fail fast with a clear message. A bot that starts happily with a
missing client ID and then fails on the first tick, thirty minutes into a stream, is worse than
one that refuses to boot.

---

## Effort

| Phase | Estimate |
| --- | --- |
| 0 — Twitch setup | 20 min |
| 1 — Auth + refresh | 1–2 hrs (OAuth is fiddly the first time) |
| 2 — Verses, formatting, splitting | 1–1.5 hrs |
| 3 — Sending | 30 min |
| 4 — Loop + live gating | 1 hr |
| 5 — Process management | 30 min |

**About half a day** for a working v1.

---

## Gotchas

1. **Token refresh without disk write-back.** Works until restart, then breaks. The single most
   common cause of a dead hobby bot.
2. **Unverified bot account.** Twitch silently drops its messages. No error, no clue.
3. **Bot not a moderator.** Fine until you enable slow mode or followers-only, then messages
   vanish.
4. **Concurrent sends reordering split parts.** Always `await` sequentially.
5. **`setInterval` and laptop sleep.** Use the elapsed-time poll in Phase 4.
6. **Committing `.env` or `state/tokens.json`.** Set up `.gitignore` before the first commit, not
   after.
7. **The 500-char cap is hard.** Any formatting change (longer translation tag, adding a URL)
   eats into the per-message text budget — recheck the arithmetic if you change the prefix.
8. **Silent live-check failures.** If `GET /helix/streams` errors, decide deliberately whether to
   post anyway or skip. Skipping on error is safer; posting on error risks an offline spam run.

---

## Optional later

**~~Quality filter for genealogies~~ — REJECTED after the first stream.**

This planned a `USE_QUALITY_FILTER` flag to blocklist 1 Chronicles 1–9, Numbers 1–4 and
Joshua's territorial allotments, on the assumption that odd verses landing on air was a defect.

Streaming proved the opposite. The verse functions as a **discussion prompt, not as content** —
the broadcaster reads the surrounding verses for context and talks through them, so an obscure
line is *more* useful than a familiar one. Filtering would remove precisely the verses that
produce the best segments.

The flag was never implemented and has been removed from config. See "Odd verses are the point"
in README.md.

*(The ~445-char per-message budget is unrelated and not optional — it's a hard requirement of
the Twitch cap, not a curation choice.)*

**`!verse` command.** Doesn't change hosting at all — you're already running a persistent process.
It's one WebSocket connection to Twitch chat (`wss://irc-ws.chat.twitch.tv:443`, or EventSub's
`channel.chat.message`), a message parser, and a per-user cooldown, bolted onto the same program.
This is precisely why timer-first was the right sequencing.

**Other ideas.** Post a verse automatically on `stream.online`. A `!verse <reference>` lookup.
Themed pools switchable per stream. Verse-of-the-day pinned at stream start.

---

## Not in scope

- Reading chat, command handling, or moderation (deliberately deferred — see above).
- Copyrighted translations (ESV/NIV/NLT) and the API keys, rate limits, and attribution
  requirements they bring.
- Cloud hosting. If you later want verses posting when your PC is off, Cloudflare Workers with a
  Cron Trigger is free and suits the send-only shape — but it can't host the `!verse` version,
  which needs a persistent connection.
- Any database. Two small JSON files in `state/` cover all persistence needs.
