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
