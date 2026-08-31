/**
 * The bot. Posts a verse to chat on an interval while you are live.
 *
 *   npm start
 *   npm start -- --interval=5        # override INTERVAL_MINUTES
 *   npm start -- --interval=1 --jitter=0 --ignore-live
 *
 * Runs until interrupted. Start it before going live; Ctrl-C when done.
 */

import { AuthError, loadTokens, validateToken } from './auth.ts';
import { loadConfig, requireTwitchConfig, type Config } from './config.ts';
import { describePost, postVerse } from './post.ts';
import {
  formatMinutes,
  IDLE_HEARTBEAT_MS,
  nextIntervalMs,
  pollIntervalMs,
  RETRY_DELAY_MS,
} from './schedule.ts';
import { isStreamLive } from './twitch.ts';
import { loadVerses } from './verses.ts';

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
      `${config.onlyWhenLive ? 'only while live' : 'ignoring live status'} · ` +
      `${config.postOnStart ? 'posting on start' : 'first post after one interval'}`,
  );

  await preflight(config);

  // postOnStart is expressed by pretending the last post was long ago.
  let lastPostAt = config.postOnStart ? 0 : Date.now();
  let interval = nextIntervalMs(config);
  let isPosting = false;

  /** Last known live state. null = not yet checked, so the first result logs. */
  let wasLive: boolean | null = null;
  let lastIdleNoticeAt = 0;

  if (!config.postOnStart) {
    log(`Next post in ~${formatMinutes(interval)}`);
  }

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs(config));

  async function tick(): Promise<void> {
    if (isPosting) return;
    if (Date.now() - lastPostAt < interval) return;

    isPosting = true;
    try {
      if (config.onlyWhenLive) {
        const live = await isStreamLive();

        if (!live) {
          // Log the transition, not every check. lastPostAt is deliberately not
          // updated, so once the interval has elapsed this branch runs on every
          // poll — logging each one would be a line a minute, all night.
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

        if (wasLive === false) {
          log(`Stream live — resuming`);
        }
        wasLive = true;
      }

      const result = await postVerse();
      console.log(describePost(result));

      if (!result.delivered) {
        log(`⚠  Twitch accepted the message but did not deliver it — see drop reason above`);
      }

      lastPostAt = Date.now();
      interval = nextIntervalMs(config);
      log(`Next post in ~${formatMinutes(interval)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof AuthError) {
        log(`✗ AUTH FAILURE — the bot cannot post until this is fixed:\n\n${message}\n`);
      } else {
        log(`✗ Post failed: ${message}`);
      }

      // Back off briefly rather than burning a whole interval on a transient blip.
      lastPostAt = Date.now();
      interval = RETRY_DELAY_MS;
      log(`Retrying in ~${formatMinutes(interval)}`);
    } finally {
      isPosting = false;
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
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
