import { TWITCH_HARD_LIMIT } from './config.ts';
import type { Verse } from './domain/types.ts';

/**
 * Clause boundaries to split on, in preference order. Biblical prose is heavily
 * comma-spliced, so a semicolon or comma near the midpoint is almost always
 * available and reads far better than a mid-word cut.
 */
const BREAK_PATTERNS = ['; ', ': ', '. ', ', ', ' '] as const;

export interface FormatOptions {
  translation: string;
  /** Hard ceiling per message. Must be <= TWITCH_HARD_LIMIT. */
  maxMessageChars: number;
}

export function formatReference(verse: Verse): string {
  return `${verse.book} ${verse.chapter}:${verse.verse}`;
}

/**
 * Renders a verse as one or more chat-ready messages.
 *
 * Single message puts the reference last, which reads naturally:
 *   "For God so loved the world..." — John 3:16 (WEB)
 *
 * Split messages put it first, on BOTH parts:
 *   Esther 8:9 (WEB) 1/2 — "Then the king's scribes..."
 *   Esther 8:9 (WEB) 2/2 — "which are from India..."
 *
 * The repeated reference costs ~30 characters we have to spare, and earns them
 * back the moment other chatters separate part 2 from part 1 — an orphaned
 * fragment with no reference reads like the bot glitched.
 */
export function formatVerse(verse: Verse, options: FormatOptions): string[] {
  const reference = formatReference(verse);

  const single = `"${verse.text}" — ${reference} (${options.translation})`;
  if (single.length <= options.maxMessageChars) return [single];

  const prefixFor = (part: number, total: number) =>
    `${reference} (${options.translation}) ${part}/${total} — `;

  // Prefix length is identical for 1/2 and 2/2, so one budget covers both.
  const budget = options.maxMessageChars - prefixFor(1, 2).length - 2; // 2 = surrounding quotes
  const chunks = splitText(verse.text, budget);

  return chunks.map((chunk, index) => `${prefixFor(index + 1, chunks.length)}"${chunk}"`);
}

/**
 * Splits text at the clause boundary nearest the midpoint that leaves every
 * part within budget. Falls back to a hard cut only if no boundary works, which
 * does not happen for real scripture.
 */
export function splitText(text: string, budget: number): string[] {
  if (budget <= 0) throw new Error(`Split budget must be positive, got ${budget}`);
  if (text.length <= budget) return [text];

  const target = Math.floor(text.length / 2);

  for (const pattern of BREAK_PATTERNS) {
    const index = findBreakNearest(text, pattern, target, budget);
    if (index === -1) continue;

    const head = text.slice(0, index + pattern.length).trimEnd();
    const tail = text.slice(index + pattern.length).trimStart();
    if (head.length <= budget && tail.length <= budget) return [head, tail];
  }

  // No clean two-way break fits, so this needs more than two parts. Cut at the
  // last word boundary within budget — never mid-word — and recurse. Only
  // reachable with pathological input, never with real verses.
  const cut = lastWordBoundary(text, budget);
  const head = text.slice(0, cut).trimEnd();
  const tail = text.slice(cut).trimStart();
  return [head, ...splitText(tail, budget)];
}

/** Last space at or before `budget`, or `budget` itself if the text has no space to break on. */
function lastWordBoundary(text: string, budget: number): number {
  const index = text.lastIndexOf(' ', budget);
  return index > 0 ? index : budget;
}

/** Index of the occurrence of `pattern` closest to `target` that keeps both halves in budget. */
function findBreakNearest(text: string, pattern: string, target: number, budget: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  let index = text.indexOf(pattern);
  while (index !== -1) {
    const headLength = index + pattern.length;
    const tailLength = text.length - headLength;

    if (headLength <= budget && tailLength <= budget) {
      const distance = Math.abs(index - target);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    index = text.indexOf(pattern, index + 1);
  }

  return best;
}

/** Guard for callers: nothing may ever go over Twitch's hard limit. */
export function assertWithinLimit(messages: string[]): void {
  for (const message of messages) {
    if (message.length > TWITCH_HARD_LIMIT) {
      throw new Error(
        `Message is ${message.length} chars, over Twitch's ${TWITCH_HARD_LIMIT} limit: ` +
          `${message.slice(0, 80)}...`,
      );
    }
  }
}
