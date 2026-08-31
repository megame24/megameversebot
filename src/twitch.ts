/**
 * Thin Helix API client. Phase 1 needs only user lookup; Phase 3 adds message
 * sending and Phase 4 the live check, both on top of helix() below.
 */

import { ensureFreshToken } from './auth.ts';
import { requireTwitchConfig, type RequireTwitchOptions } from './config.ts';

const HELIX_BASE = 'https://api.twitch.tv/helix';

export class TwitchApiError extends Error {
  // Declared and assigned explicitly: Node's strip-only TypeScript mode cannot
  // synthesise constructor parameter properties. Same restriction rules out
  // `enum` and `namespace` — and `tsc` accepts all three, so it won't warn you.
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TwitchApiError';
    this.status = status;
    this.body = body;
  }
}

export interface HelixOptions extends RequireTwitchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}

/**
 * Performs a Helix request with a guaranteed-fresh token. Callers never handle
 * token expiry themselves.
 */
export async function helix<T>(path: string, options: HelixOptions = {}): Promise<T> {
  const { method = 'GET', body, query, requireUserIds } = options;
  const config = requireTwitchConfig(
    requireUserIds === undefined ? {} : { requireUserIds },
  );
  const accessToken = await ensureFreshToken();

  const url = new URL(`${HELIX_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new TwitchApiError(
      `Twitch ${method} ${path} failed (HTTP ${response.status}): ${detail}`,
      response.status,
      detail,
    );
  }

  // 204 responses carry no body.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Twitch rejects anything longer outright. */
const HARD_MESSAGE_LIMIT = 500;

/** Gap between parts of a split verse. Long enough to read as two lines, short
 *  enough that other chatters rarely land between them. */
const INTER_MESSAGE_DELAY_MS = 500;

export interface SendResult {
  messageId: string;
  isSent: boolean;
  dropReason?: { code: string; message: string };
}

interface SendChatResponse {
  data: Array<{
    message_id: string;
    is_sent: boolean;
    drop_reason?: { code: string; message: string };
  }>;
}

/**
 * Sends one chat message.
 *
 * Note the failure mode this guards: Twitch answers **HTTP 200 with
 * is_sent: false** when something downstream drops the message — AutoMod held
 * it, the channel is in followers-only or subscriber-only mode, and so on.
 * Treating 200 as success means the bot reports posting verses that nobody saw.
 */
export async function sendChatMessage(message: string): Promise<SendResult> {
  if (message.length > HARD_MESSAGE_LIMIT) {
    throw new Error(
      `Refusing to send a ${message.length}-character message; Twitch's limit is ` +
        `${HARD_MESSAGE_LIMIT}. This is a formatting bug — check MAX_MESSAGE_CHARS.`,
    );
  }

  const config = requireTwitchConfig();

  const response = await helix<SendChatResponse>('/chat/messages', {
    method: 'POST',
    body: {
      broadcaster_id: config.channelUserId,
      sender_id: config.botUserId,
      message,
    },
  });

  const result = response.data[0];
  if (!result) {
    throw new Error('Twitch accepted the send but returned no result row.');
  }

  return {
    messageId: result.message_id,
    isSent: result.is_sent,
    ...(result.drop_reason ? { dropReason: result.drop_reason } : {}),
  };
}

/**
 * Sends parts of a split verse in order.
 *
 * Sequential and awaited, never concurrent: parallel requests can arrive out of
 * order, and "2/2" landing before "1/2" looks broken.
 *
 * A mid-sequence failure is reported rather than retried. The verse is already
 * half-posted, and re-sending part 1 would be worse than leaving it.
 */
export async function sendChatMessages(messages: string[]): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (const [index, message] of messages.entries()) {
    try {
      results.push(await sendChatMessage(message));
    } catch (error) {
      // Nothing posted yet — rethrow untouched so the original message (often
      // an actionable auth error) isn't buried under irrelevant context.
      if (index === 0) throw error;

      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed on message ${index + 1} of ${messages.length} — ` +
          `${index} part(s) already posted and left as-is: ${detail}`,
      );
    }

    if (index < messages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_MESSAGE_DELAY_MS));
    }
  }

  return results;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

export async function getUserByLogin(
  login: string,
  options: RequireTwitchOptions = {},
): Promise<TwitchUser | null> {
  const result = await helix<{ data: TwitchUser[] }>('/users', {
    query: { login: login.toLowerCase() },
    ...options,
  });
  return result.data[0] ?? null;
}
