/**
 * One complete post cycle: pick → format → send → remember.
 *
 * Deliberately does NOT decide *whether* to post. Live-gating and scheduling
 * belong to the caller (Phase 4's tick), which keeps this callable directly for
 * testing and, later, for an on-demand command.
 */

import { loadConfig } from './config.ts';
import { assertWithinLimit, formatVerse } from './format.ts';
import { sendChatMessages, type SendResult } from './twitch.ts';
import { loadRecent, loadVerses, recordRecent, selectVerse, verseId } from './verses.ts';
import type { Verse } from './domain/types.ts';

export interface PostOptions {
  /** Format and return without sending anything to Twitch. */
  dryRun?: boolean;
}

export interface PostResult {
  verse: Verse;
  messages: string[];
  /** Empty on a dry run. */
  results: SendResult[];
  /** True when Twitch accepted every part AND reported each as actually sent. */
  delivered: boolean;
}

export async function postVerse(options: PostOptions = {}): Promise<PostResult> {
  const config = loadConfig();
  const { verses } = loadVerses(config.translation);

  const verse = selectVerse({ verses, recent: loadRecent() });
  const messages = formatVerse(verse, config);

  // Last line of defence before the network: nothing may exceed Twitch's cap.
  assertWithinLimit(messages);

  if (options.dryRun) {
    return { verse, messages, results: [], delivered: false };
  }

  const results = await sendChatMessages(messages);

  // Record even on a drop. The verse was consumed for this slot, and repeating
  // it on the next tick would be a worse outcome than skipping it.
  recordRecent(verseId(verse), config.recentMemory);

  return {
    verse,
    messages,
    results,
    delivered: results.every((result) => result.isSent),
  };
}

/** Human-readable summary of a post, shared by the test script and the loop. */
export function describePost(result: PostResult): string {
  const lines = [`${verseId(result.verse)} — ${result.messages.length} message(s)`];

  for (const [index, message] of result.messages.entries()) {
    lines.push(`  [${String(message.length).padStart(3)}] ${message}`);

    const sendResult = result.results[index];
    if (!sendResult) continue;

    if (sendResult.isSent) {
      lines.push(`        ✓ sent (${sendResult.messageId})`);
    } else {
      const reason = sendResult.dropReason;
      lines.push(
        `        ✗ DROPPED BY TWITCH${reason ? ` — ${reason.code}: ${reason.message}` : ''}`,
      );
    }
  }

  return lines.join('\n');
}
