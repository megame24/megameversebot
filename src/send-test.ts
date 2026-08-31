/**
 * Posts a single verse to chat, right now. The Phase 3 proof.
 *
 *   npm run send-test              # actually posts
 *   npm run send-test -- --dry-run # format only, sends nothing
 *
 * No live-gating here — it posts whether or not you are streaming, which is
 * what you want when testing. Gating arrives with the Phase 4 loop.
 */

import { describePost, postVerse } from './post.ts';
import { requireTwitchConfig } from './config.ts';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const config = requireTwitchConfig();

  console.log(
    dryRun
      ? `\nDry run — formatting only, nothing will be sent.\n`
      : `\nPosting one verse to #${config.channel} ...\n`,
  );

  const result = await postVerse({ dryRun });
  console.log(describePost(result));

  if (dryRun) {
    console.log(`\nDry run complete. Drop --dry-run to post for real.\n`);
    return;
  }

  if (result.delivered) {
    console.log(`\n✓ Delivered. Check your chat.\n`);
    return;
  }

  // HTTP 200 with is_sent:false — the message was accepted and then dropped.
  console.error(
    `\n✗ Twitch accepted the request but did not deliver the message.\n\n` +
      `  Most common causes:\n` +
      `    · the bot account is not a moderator (/mod ${'<botname>'}) and the channel\n` +
      `      is in followers-only, subscriber-only, or slow mode\n` +
      `    · AutoMod held the message for review\n` +
      `    · the bot account is not email/phone verified\n`,
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
