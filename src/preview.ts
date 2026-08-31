/**
 * Offline preview — prints formatted verses to the console with character counts.
 * Touches no network and needs no credentials.
 *
 *   npm run preview          # 20 verses
 *   npm run preview -- 50    # 50 verses
 */

import { loadConfig, TWITCH_HARD_LIMIT } from './config.ts';
import { formatVerse, splitText, assertWithinLimit } from './format.ts';
import { loadVerses, selectVerse, verseId } from './verses.ts';

/** Structurally similar to a long verse (semicolon- and comma-heavy) but not scripture. */
const SPLITTER_DEMO_TEXT =
  'This synthetic passage exists only to exercise the splitter; it is deliberately long, ' +
  'and it is punctuated the way biblical prose tends to be punctuated, with clauses joined ' +
  'by semicolons and commas rather than full stops; the point is to confirm that the break ' +
  'lands on a clause boundary near the middle of the text, that neither half exceeds the ' +
  'per-message budget, that no word is cut in half at the seam, and that both parts carry ' +
  'the reference so a reader who sees only one of them still knows where it came from.';

function main(): void {
  const count = Number(process.argv[2] ?? 20);
  const config = loadConfig();
  const { verses, source, isSample } = loadVerses(config.translation);

  console.log(`\nSource      ${source}`);
  console.log(`Verses      ${verses.length.toLocaleString()}`);
  console.log(`Translation ${config.translation}`);
  console.log(`Budget      ${config.maxMessageChars} chars/message (Twitch cap ${TWITCH_HARD_LIMIT})`);

  if (isSample) {
    console.log(
      `\n⚠  Using the development sample, not a real translation.\n` +
        `   See data/README.md to install the full text.`,
    );
  }

  reportSplitStats(verses, config);
  printRandomVerses(count, verses, config);
  demoSplitter(config);
}

/**
 * The real number of verses needing a split, rather than an estimate. Expect a
 * small fraction of a percent; hundreds would mean the translation's punctuation
 * is worth a closer look before trusting the splitter.
 */
function reportSplitStats(
  verses: ReturnType<typeof loadVerses>['verses'],
  config: ReturnType<typeof loadConfig>,
): void {
  const needsSplit = verses.filter(
    (verse) => formatVerse(verse, config).length > 1,
  );

  const pct = ((needsSplit.length / verses.length) * 100).toFixed(2);
  console.log(`\n── Split stats ${'─'.repeat(50)}`);
  console.log(`${needsSplit.length} of ${verses.length} verses need splitting (${pct}%)`);

  const longest = [...needsSplit]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 5);

  for (const verse of longest) {
    console.log(`  ${verseId(verse).padEnd(24)} ${verse.text.length} chars`);
  }
  if (longest.length === 0) console.log('  (none — expected with the small sample file)');
}

function printRandomVerses(
  count: number,
  verses: ReturnType<typeof loadVerses>['verses'],
  config: ReturnType<typeof loadConfig>,
): void {
  console.log(`\n── ${count} random verses ${'─'.repeat(44)}`);

  const seen: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const verse = selectVerse({ verses, recent: seen });
    seen.push(verseId(verse));

    const messages = formatVerse(verse, config);
    assertWithinLimit(messages);

    for (const message of messages) {
      const flag = message.length > config.maxMessageChars ? ' ✗ OVER' : '';
      console.log(`\n[${String(message.length).padStart(3)}]${flag} ${message}`);
    }
  }
}

function demoSplitter(config: ReturnType<typeof loadConfig>): void {
  console.log(`\n\n── Splitter demo ${'─'.repeat(48)}`);
  console.log('(synthetic text, not scripture — proves the break logic)\n');

  const messages = formatVerse(
    { book: 'Demo', chapter: 1, verse: 1, text: SPLITTER_DEMO_TEXT },
    config,
  );
  assertWithinLimit(messages);

  for (const message of messages) {
    console.log(`[${String(message.length).padStart(3)}] ${message}\n`);
  }

  // Show where the seam landed, so a bad break is obvious at a glance.
  const parts = splitText(SPLITTER_DEMO_TEXT, 200);
  console.log('Seam check at a 200-char budget:');
  for (const part of parts) {
    console.log(`  …${part.slice(-40)}  │  ${part.length} chars`);
  }
  console.log();
}

main();
