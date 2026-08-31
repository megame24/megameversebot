/**
 * Timing arithmetic for the post loop, kept separate so it can be exercised
 * without standing up the whole bot.
 */

import type { Config } from './config.ts';

/** Never schedule a gap shorter than this, however the jitter lands. */
export const MIN_INTERVAL_MS = 30 * 1000;

/** Wait this long before retrying after a failed post, instead of a full interval. */
export const RETRY_DELAY_MS = 2 * 60 * 1000;

/**
 * How often to reassert "still holding" while the stream is offline.
 *
 * The offline branch runs on every poll, so without this the bot either spams a
 * line a minute or goes completely silent for hours — and silence is
 * indistinguishable from a crash.
 */
export const IDLE_HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Interval with jitter applied, as ±jitterMinutes around the base.
 *
 * Posting at exactly :00 and :30 forever reads as robotic; a few minutes of
 * drift does not. `random` is injectable so the spread can be asserted.
 */
export function nextIntervalMs(
  config: Pick<Config, 'intervalMinutes' | 'jitterMinutes'>,
  random: () => number = Math.random,
): number {
  const base = config.intervalMinutes * 60_000;
  const spread = config.jitterMinutes * 60_000;
  const jittered = base + (random() * 2 - 1) * spread;
  return Math.max(MIN_INTERVAL_MS, jittered);
}

/**
 * How often to wake and check whether a post is due.
 *
 * Polling frequently and comparing elapsed wall-clock time is deliberate:
 * setInterval stalls while the machine sleeps, and this bot lives on a PC that
 * sleeps. Scaled to the interval so short test intervals stay responsive.
 */
export function pollIntervalMs(config: Pick<Config, 'intervalMinutes'>): number {
  return Math.max(5_000, Math.min(60_000, (config.intervalMinutes * 60_000) / 4));
}

export function formatMinutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)}m`;
}
