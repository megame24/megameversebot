/**
 * Diagnostic: validates the stored token, reports who it belongs to, and
 * resolves the two user IDs the bot needs.
 *
 *   npm run whoami
 *
 * Also doubles as the health check when something stops working — it exercises
 * the full load → refresh-if-needed → authenticated-request path.
 */

import { ensureFreshToken, loadTokens, validateToken } from './auth.ts';
import { requireTwitchConfig } from './config.ts';
import { getUserByLogin } from './twitch.ts';

function minutesUntil(epochMs: number): number {
  return Math.max(0, Math.round((epochMs - Date.now()) / 60_000));
}

async function main(): Promise<void> {
  const config = requireTwitchConfig({ requireUserIds: false });

  const before = loadTokens();
  console.log(`\nStored token expires in ${minutesUntil(before.expiresAt)} min`);

  // Exercises refresh-and-persist when the token is near expiry.
  await ensureFreshToken();
  const after = loadTokens();

  if (after.accessToken !== before.accessToken) {
    console.log(`Token was refreshed and written back — now valid ${minutesUntil(after.expiresAt)} min`);
  }

  const bot = await validateToken(after.accessToken);
  console.log(`\n── Bot account ${'─'.repeat(50)}`);
  console.log(`Login   ${bot.login}`);
  console.log(`User ID ${bot.userId}`);
  console.log(`Scopes  ${bot.scopes.join(', ') || '(none)'}`);

  const channel = await getUserByLogin(config.channel, { requireUserIds: false });
  if (!channel) {
    console.error(
      `\n✗ No Twitch user found for TWITCH_CHANNEL="${config.channel}".\n` +
        `  It should be your channel's login name, lowercase, as in twitch.tv/<name>.\n`,
    );
    process.exit(1);
  }

  console.log(`\n── Channel ${'─'.repeat(54)}`);
  console.log(`Login   ${channel.login}`);
  console.log(`User ID ${channel.id}`);

  console.log(`\n── Paste into .env ${'─'.repeat(46)}`);
  console.log(`BOT_USER_ID=${bot.userId}`);
  console.log(`CHANNEL_USER_ID=${channel.id}`);

  if (bot.userId === channel.id) {
    console.log(
      `\n⚠  The bot and the channel are the same account. That works, but verses will\n` +
        `   appear under your own name rather than a dedicated bot account.`,
    );
  }
  console.log();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
