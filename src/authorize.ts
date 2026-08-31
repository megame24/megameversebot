/**
 * One-time OAuth authorization. Run once; the bot refreshes from here on.
 *
 *   npm run authorize
 *
 * Opens Twitch's consent screen, catches the redirect on localhost, exchanges
 * the code for tokens, and writes state/tokens.json.
 *
 * Log in as the BOT account, not your main one — whichever account approves is
 * the one that will speak in chat.
 */

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AuthError, exchangeCode, validateToken } from './auth.ts';
import { requireTwitchConfig } from './config.ts';

/**
 * Scopes requested for the bot account.
 *
 *   user:write:chat — required by POST /helix/chat/messages to send messages.
 *   user:bot        — identifies the account to Twitch's chat APIs as a bot.
 *
 * Twitch's chat API surface has shifted over time (IRC → Helix/EventSub). If
 * authorization fails with an invalid-scope error, or sending later returns
 * 401/403, check the current "Send Chat Message" docs and adjust this list.
 */
const SCOPES = ['user:write:chat', 'user:bot'];

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTHORIZE_ENDPOINT = 'https://id.twitch.tv/oauth2/authorize';

function buildAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // Always show consent, so switching between accounts is possible without
    // clearing cookies — easy to get wrong when you have two Twitch logins.
    force_verify: 'true',
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

function page(title: string, body: string, accent: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#18181b;color:#efeff1;
display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:32rem;padding:2rem">
<h1 style="color:${accent};margin:0 0 .5rem">${title}</h1>
<p style="color:#adadb8;line-height:1.6">${body}</p></div></body>`;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    }).unref();
  } catch {
    // Best effort — the URL is printed either way.
  }
}

async function waitForCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const finish = (status: number, html: string, outcome: Error | string) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        server.close();
        if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };

      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') ?? error;
        finish(
          400,
          page('Authorization declined', description, '#eb0400'),
          new AuthError(`Authorization was declined: ${description}`),
        );
        return;
      }

      // Guards against a stray callback from another tab landing in our flow.
      if (url.searchParams.get('state') !== expectedState) {
        finish(
          400,
          page('State mismatch', 'This callback did not originate from this run.', '#eb0400'),
          new AuthError('State mismatch — the callback did not come from this authorize run.'),
        );
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        finish(
          400,
          page('No code returned', 'Twitch redirected without an authorization code.', '#eb0400'),
          new AuthError('Callback contained no authorization code.'),
        );
        return;
      }

      finish(
        200,
        page('Authorized', 'Tokens saved. You can close this tab and return to the terminal.', '#00f593'),
        code,
      );
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new AuthError(`Port ${PORT} is already in use. Close whatever is using it and retry.`)
          : err,
      );
    });

    server.listen(PORT);
  });
}

async function main(): Promise<void> {
  const config = requireTwitchConfig({ requireUserIds: false });
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(config.clientId, state);

  console.log('\nAuthorizing the bot account with Twitch.');
  console.log(`Scopes: ${SCOPES.join(', ')}`);
  console.log(`\n⚠  Log in as your BOT account — whoever approves is who speaks in chat.\n`);
  console.log(`If the browser does not open, visit:\n${authorizeUrl}\n`);
  console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);

  openBrowser(authorizeUrl);

  const code = await waitForCode(state);
  const tokens = await exchangeCode(code, REDIRECT_URI);
  const identity = await validateToken(tokens.accessToken);

  console.log(`\n✓ Authorized as ${identity.login} (user id ${identity.userId})`);
  console.log(`  Scopes granted: ${identity.scopes.join(', ') || '(none)'}`);
  console.log(`  Access token expires in ${Math.round(tokens.expiresAt - Date.now()) / 1000 / 60 | 0} min`);
  console.log(`  Saved to state/tokens.json (refreshed automatically from here on)`);

  const missing = SCOPES.filter((scope) => !identity.scopes.includes(scope));
  if (missing.length > 0) {
    console.log(`\n⚠  Requested but not granted: ${missing.join(', ')}`);
    console.log(`   Sending may fail. Check the current Send Chat Message scope requirements.`);
  }

  console.log(`\nNext:  npm run whoami   (resolves the user IDs for your .env)\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
