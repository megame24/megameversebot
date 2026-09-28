/**
 * Config is read from process.env with sensible defaults.
 *
 * Phase 2 (verse preview) needs no environment at all — the defaults below are
 * enough. Twitch credentials are validated separately by requireTwitchConfig()
 * so that offline work never trips over missing secrets.
 */

/** Twitch's hard cap on a chat message. Not configurable — it's their limit, not ours. */
export const TWITCH_HARD_LIMIT = 500;

export interface Config {
  translation: string;
  maxMessageChars: number;
  recentMemory: number;
  intervalMinutes: number;
  jitterMinutes: number;
  /** Every stream opens with a verse this long after going live, whatever the interval. */
  openingVerseMinutes: number;
  postOnStart: boolean;
  onlyWhenLive: boolean;
}

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  channel: string;
  /** Empty until resolved via `npm run whoami`. */
  botUserId: string;
  channelUserId: string;
}

export interface RequireTwitchOptions {
  /**
   * User IDs are resolved *from* a token, so the authorize and whoami steps run
   * before they are known. Those callers pass false; everything else needs them.
   */
  requireUserIds?: boolean;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Config ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfig(): Config {
  const maxMessageChars = num('MAX_MESSAGE_CHARS', 480);

  if (maxMessageChars > TWITCH_HARD_LIMIT) {
    throw new Error(
      `MAX_MESSAGE_CHARS (${maxMessageChars}) exceeds Twitch's ${TWITCH_HARD_LIMIT} character ` +
        `limit. Messages over the limit are rejected outright.`,
    );
  }

  return {
    translation: process.env['TRANSLATION'] ?? 'WEB',
    maxMessageChars,
    recentMemory: num('RECENT_MEMORY', 500),
    intervalMinutes: num('INTERVAL_MINUTES', 30),
    jitterMinutes: num('JITTER_MINUTES', 2),
    openingVerseMinutes: num('OPENING_VERSE_MINUTES', 5),
    postOnStart: bool('POST_ON_START', false),
    onlyWhenLive: bool('ONLY_WHEN_LIVE', true),
  };
}

/**
 * Fails fast when Twitch credentials are missing. Called only from code paths
 * that actually talk to Twitch, so `npm run preview` stays usable with no .env.
 */
export function requireTwitchConfig(options: RequireTwitchOptions = {}): TwitchConfig {
  const { requireUserIds = true } = options;

  const required = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_CHANNEL'];
  if (requireUserIds) required.push('BOT_USER_ID', 'CHANNEL_USER_ID');

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const hint = missing.some((key) => key.endsWith('_USER_ID'))
      ? `\n\nUser IDs come from:  npm run whoami`
      : `\n\nCopy .env.example to .env and fill it in.`;

    throw new Error(`Missing required Twitch config: ${missing.join(', ')}${hint}`);
  }

  return {
    clientId: process.env['TWITCH_CLIENT_ID']!,
    clientSecret: process.env['TWITCH_CLIENT_SECRET']!,
    channel: process.env['TWITCH_CHANNEL']!,
    botUserId: process.env['BOT_USER_ID'] ?? '',
    channelUserId: process.env['CHANNEL_USER_ID'] ?? '',
  };
}
