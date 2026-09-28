/**
 * The bot. Opens every stream with a verse, then posts one on an interval
 * while you are live.
 *
 *   npm start
 *   npm start -- --interval=5        # override INTERVAL_MINUTES
 *   npm start -- --interval=1 --jitter=0 --ignore-live
 *
 * Runs until interrupted. Start it before going live; Ctrl-C when done.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, loadTokens, validateToken } from './auth.ts';
import { loadConfig, requireTwitchConfig, type Config } from './config.ts';
import { describePost, postVerse } from './post.ts';
import {
  formatMinutes,
  IDLE_HEARTBEAT_MS,
  nextIntervalMs,
  nextPost,
  pollIntervalMs,
  RETRY_DELAY_MS,
} from './schedule.ts';
import { getLiveStream, type LiveStream } from './twitch.ts';
import { loadVerses } from './verses.ts';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '..', 'state');
const openedPath = join(stateDir, 'opened-stream.json');

interface CliOverrides {
  intervalMinutes?: number;
  jitterMinutes?: number;
  ignoreLive?: boolean;
}

function parseArgs(argv: string[]): CliOverrides {
  const overrides: CliOverrides = {};

  for (const arg of argv) {
    const interval = /^--interval=(\d+(?:\.\d+)?)$/.exec(arg);
    if (interval?.[1]) overrides.intervalMinutes = Number(interval[1]);

    const jitter = /^--jitter=(\d+(?:\.\d+)?)$/.exec(arg);
    if (jitter?.[1]) overrides.jitterMinutes = Number(jitter[1]);

    if (arg === '--ignore-live') overrides.ignoreLive = true;
  }

  return overrides;
}

function log(message: string): void {
  console.log(`${new Date().toLocaleTimeString()}  ${message}`);
}

/**
 * The broadcast whose opening verse has been posted. Persisted so restarting
 * the bot mid-stream doesn't open the same stream twice.
 */
function loadOpenedStreamId(): string | null {
  if (!existsSync(openedPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(openedPath, 'utf8')) as { streamId?: unknown };
    return typeof parsed.streamId === 'string' ? parsed.streamId : null;
  } catch {
    // Not worth crashing over; worst case is a second opening verse after a restart.
    return null;
  }
}

function saveOpenedStreamId(streamId: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(openedPath, JSON.stringify({ streamId }, null, 2));
}

/**
 * Startup checks. Better to fail here than thirty minutes into a stream with
 * the terminal minimised.
 */
async function preflight(config: Config): Promise<void> {
  const twitch = requireTwitchConfig();

  const { verses, source, isSample } = loadVerses(config.translation);
  log(`Loaded ${verses.length.toLocaleString()} verses from ${source}`);
  if (isSample) {
    log(`⚠  Using the development sample — see data/README.md to install a full translation`);
  }

  const identity = await validateToken(loadTokens().accessToken);
  log(`Authenticated as ${identity.login} (${identity.userId})`);

  if (identity.userId !== twitch.botUserId) {
    log(
      `⚠  Token belongs to user ${identity.userId} but BOT_USER_ID is ${twitch.botUserId}. ` +
        `Re-run: npm run whoami`,
    );
  }

  log(`Posting to #${twitch.channel}`);
}

async function main(): Promise<void> {
  const overrides = parseArgs(process.argv.slice(2));
  const base = loadConfig();
  const config: Config = {
    ...base,
    ...(overrides.intervalMinutes === undefined
      ? {}
      : { intervalMinutes: overrides.intervalMinutes }),
    ...(overrides.jitterMinutes === undefined ? {} : { jitterMinutes: overrides.jitterMinutes }),
    ...(overrides.ignoreLive ? { onlyWhenLive: false } : {}),
  };

  console.log('');

  // Logged before preflight so a startup failure still shows what settings
  // were in play — including any CLI overrides.
  log(
    `Interval ${config.intervalMinutes}m ±${config.jitterMinutes}m · ` +
      (config.onlyWhenLive
        ? `only while live · opening verse ${config.openingVerseMinutes}m after going live`
        : `ignoring live status · ` +
          (config.postOnStart ? 'posting on start' : 'first post after one interval')),
  );

  await preflight(config);

  // postOnStart is expressed by pretending the last post was long ago.
  let lastPostAt = config.postOnStart ? 0 : Date.now();
  let interval = nextIntervalMs(config);
  let openedStreamId = loadOpenedStreamId();
  /** After a failure, nothing runs until this time — not even the live check. */
  let retryAt = 0;
  let isTicking = false;

  /** Last known live state. null = not yet checked, so the first result logs. */
  let wasLive: boolean | null = null;
  let lastIdleNoticeAt = 0;

  // When live-gated, the first tick reports what's next instead.
  if (!config.onlyWhenLive && !config.postOnStart) {
    log(`Next post in ~${formatMinutes(interval)}`);
  }

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs(config));

  async function tick(): Promise<void> {
    if (isTicking || Date.now() < retryAt) return;

    isTicking = true;
    let posting = false;
    try {
      let stream: LiveStream | null = null;

      if (config.onlyWhenLive) {
        // Checked on every poll, not only when a post is due: a stream that
        // starts mid-interval must be noticed in time for its opening verse.
        stream = await getLiveStream();

        if (!stream) {
          // Log the transition, not every check — this runs on every poll, so
          // logging each one would be a line a minute, all night.
          if (wasLive !== false) {
            log(`Stream offline — holding until you go live`);
            lastIdleNoticeAt = Date.now();
          } else if (Date.now() - lastIdleNoticeAt >= IDLE_HEARTBEAT_MS) {
            // Periodic proof of life, so hours of silence aren't ambiguous.
            log(`Still holding — stream offline`);
            lastIdleNoticeAt = Date.now();
          }
          wasLive = false;
          return;
        }
      }

      const next = nextPost({
        stream,
        openedStreamId,
        lastPostAt,
        intervalMs: interval,
        openingVerseMinutes: config.openingVerseMinutes,
      });
      const wait = next.at - Date.now();

      if (stream && wasLive !== true) {
        const what = next.isOpening ? 'opening verse' : 'next verse';
        log(`Stream live — ${what} ${wait > 0 ? `in ~${formatMinutes(wait)}` : 'now'}`);
        wasLive = true;
      }

      if (wait > 0) return;

      posting = true;
      const result = await postVerse();
      console.log(describePost(result));

      if (!result.delivered) {
        log(`⚠  Twitch accepted the message but did not deliver it — see drop reason above`);
      }

      lastPostAt = Date.now();
      interval = nextIntervalMs(config);
      log(`Next post in ~${formatMinutes(interval)}`);

      if (stream && next.isOpening) {
        // Recorded even on a drop, as recordRecent is: this stream's opening
        // slot is used, and a second opener would be worse than a missed one.
        openedStreamId = stream.id;
        saveOpenedStreamId(stream.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof AuthError) {
        log(`✗ AUTH FAILURE — the bot cannot post until this is fixed:\n\n${message}\n`);
      } else {
        log(`✗ ${posting ? 'Post' : 'Live check'} failed: ${message}`);
      }

      // Back off briefly rather than hammering Twitch every poll or burning a
      // whole interval on a transient blip. Whatever was due stays due.
      retryAt = Date.now() + RETRY_DELAY_MS;
      log(`Retrying in ~${formatMinutes(RETRY_DELAY_MS)}`);
    } finally {
      isTicking = false;
    }
  }

  const shutdown = (signal: string) => {
    clearInterval(timer);
    console.log('');
    log(`${signal} — stopping.`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log(`Running. Ctrl-C to stop.\n`);

  // Check now rather than one poll from now, so the log says straight away
  // whether you're live and when the opening verse will land.
  void tick();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
