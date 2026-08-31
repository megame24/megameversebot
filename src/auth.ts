/**
 * Token lifecycle: load, refresh, persist.
 *
 * Twitch user access tokens expire after a few hours. A token pasted into a
 * config file works beautifully in testing and then dies mid-stream, which is
 * why refresh is built in from the start rather than bolted on later.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTwitchConfig } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '..', 'state');
const tokensPath = join(stateDir, 'tokens.json');

export const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
export const VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';

/**
 * Refresh this long before actual expiry. A tick that starts just under the
 * wire must not have its token expire mid-request.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
  obtainedAt: number;
}

/** Carries an actionable next step rather than just a failure. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string[];
}

export function tokensExist(): boolean {
  return existsSync(tokensPath);
}

export function loadTokens(): StoredTokens {
  if (!existsSync(tokensPath)) {
    throw new AuthError(`No tokens found at ${tokensPath}.\n\nRun:  npm run authorize`);
  }

  try {
    return JSON.parse(readFileSync(tokensPath, 'utf8')) as StoredTokens;
  } catch {
    throw new AuthError(
      `${tokensPath} is unreadable or corrupt.\n\nDelete it and run:  npm run authorize`,
    );
  }
}

export function saveTokens(tokens: StoredTokens): void {
  mkdirSync(stateDir, { recursive: true });
  // 0600: this file is a credential.
  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/**
 * Returns a usable access token, refreshing first if it is at or near expiry.
 * Call this immediately before every Twitch request.
 */
export async function ensureFreshToken(): Promise<string> {
  const tokens = loadTokens();

  if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) {
    return tokens.accessToken;
  }

  const refreshed = await refreshTokens(tokens);
  return refreshed.accessToken;
}

export async function refreshTokens(current: StoredTokens): Promise<StoredTokens> {
  const config = requireTwitchConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AuthError(
      `Token refresh failed (HTTP ${response.status}).\n\n` +
        `The refresh token is probably no longer valid — changing the account password or\n` +
        `disconnecting the app under Twitch Settings → Connections both revoke it.\n\n` +
        `Run:  npm run authorize\n\n` +
        `Twitch said: ${detail}`,
    );
  }

  const payload = (await response.json()) as TokenResponse;

  const next: StoredTokens = {
    accessToken: payload.access_token,
    // Twitch can rotate the refresh token — persist whatever comes back rather
    // than assuming the original stays valid.
    refreshToken: payload.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scopes: payload.scope ?? current.scopes,
    obtainedAt: Date.now(),
  };

  // Writing back is the whole point. Refreshing in memory alone works until the
  // process restarts, then silently reuses a dead token.
  saveTokens(next);
  return next;
}

/** Exchanges an authorization code for tokens. Used once, by the authorize script. */
export async function exchangeCode(code: string, redirectUri: string): Promise<StoredTokens> {
  const config = requireTwitchConfig({ requireUserIds: false });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AuthError(
      `Code exchange failed (HTTP ${response.status}).\n\n` +
        `Most often this means the redirect URI registered at dev.twitch.tv does not exactly\n` +
        `match ${redirectUri} — it must match character for character.\n\n` +
        `Twitch said: ${detail}`,
    );
  }

  const payload = (await response.json()) as TokenResponse;

  const tokens: StoredTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? '',
    expiresAt: Date.now() + payload.expires_in * 1000,
    scopes: payload.scope ?? [],
    obtainedAt: Date.now(),
  };

  if (!tokens.refreshToken) {
    throw new AuthError(
      'Twitch returned no refresh token. The bot cannot stay authenticated without one —\n' +
        'confirm the app is registered as a confidential client with a client secret.',
    );
  }

  saveTokens(tokens);
  return tokens;
}

export interface ValidationResult {
  login: string;
  userId: string;
  clientId: string;
  scopes: string[];
  /** Seconds until expiry, per Twitch. */
  expiresIn: number;
}

/**
 * Checks a token against Twitch's validate endpoint. Twitch asks that
 * long-running apps validate periodically; here it also powers `npm run whoami`.
 */
export async function validateToken(accessToken: string): Promise<ValidationResult> {
  const response = await fetch(VALIDATE_ENDPOINT, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });

  if (!response.ok) {
    throw new AuthError(
      `Token validation failed (HTTP ${response.status}). The token is expired or revoked.\n\n` +
        `Run:  npm run authorize`,
    );
  }

  const payload = (await response.json()) as {
    login: string;
    user_id: string;
    client_id: string;
    scopes: string[];
    expires_in: number;
  };

  return {
    login: payload.login,
    userId: payload.user_id,
    clientId: payload.client_id,
    scopes: payload.scopes ?? [],
    expiresIn: payload.expires_in,
  };
}
