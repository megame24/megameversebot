/**
 * Downloads the World English Bible and writes data/verses.web.json.
 *
 *   npm run fetch-web
 *
 * The WEB is public domain — no key, no terms, no attribution obligation
 * (though the bot cites it anyway, because a verse without a translation tag is
 * less useful).
 *
 * Source: github.com/TehShrike/world-english-bible, itself derived from
 * ebible.org/web. That repo stores each book as a stream of typed entries
 * carrying paragraph and poetry structure for printing; this flattens it to the
 * one-object-per-verse shape the bot expects.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verse } from './domain/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const outputPath = join(dataDir, 'verses.web.json');

const SOURCE_BASE =
  'https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json';

/** Canonical order. Filenames are these lowercased with spaces stripped. */
const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

/** Entry types that carry verse text. Everything else is structural. */
const TEXT_TYPES = new Set(['paragraph text', 'line text']);

interface SourceEntry {
  type: string;
  chapterNumber?: number;
  verseNumber?: number;
  value?: string;
}

function fileNameFor(book: string): string {
  return `${book.toLowerCase().replace(/\s/g, '')}.json`;
}

/**
 * A single verse can be split across several entries when a paragraph or poetry
 * break falls mid-verse, so entries are concatenated in document order.
 */
function flatten(book: string, entries: SourceEntry[]): Verse[] {
  const byRef = new Map<string, Verse>();

  for (const entry of entries) {
    if (!TEXT_TYPES.has(entry.type)) continue;
    if (entry.chapterNumber === undefined || entry.verseNumber === undefined) continue;
    if (!entry.value) continue;

    const key = `${entry.chapterNumber}:${entry.verseNumber}`;
    const existing = byRef.get(key);

    if (existing) {
      existing.text = `${existing.text} ${entry.value}`;
    } else {
      byRef.set(key, {
        book,
        chapter: entry.chapterNumber,
        verse: entry.verseNumber,
        text: entry.value,
      });
    }
  }

  for (const verse of byRef.values()) {
    verse.text = verse.text.replace(/\s+/g, ' ').trim();
  }

  return [...byRef.values()].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
}

async function fetchBook(book: string): Promise<Verse[]> {
  const url = `${SOURCE_BASE}/${fileNameFor(book)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${book} (HTTP ${response.status}) from ${url}`);
  }
  return flatten(book, (await response.json()) as SourceEntry[]);
}

/**
 * Verses with no body text are expected, not corrupt.
 *
 * A handful of passages present in the Textus Receptus (and so in the KJV) are
 * absent from the critical text the WEB follows — Acts 8:37 among them. The WEB
 * keeps the verse number as a placeholder and moves the content to a footnote.
 * There is nothing to post, so they are dropped and reported.
 */
function dropEmpty(verses: Verse[]): { kept: Verse[]; dropped: Verse[] } {
  const kept: Verse[] = [];
  const dropped: Verse[] = [];
  for (const verse of verses) {
    (verse.text.length > 0 ? kept : dropped).push(verse);
  }
  return { kept, dropped };
}

function validate(verses: Verse[]): string[] {
  const problems: string[] = [];

  const books = new Set(verses.map((v) => v.book));
  if (books.size !== BOOKS.length) {
    problems.push(`expected ${BOOKS.length} books, found ${books.size}`);
  }

  const seen = new Set<string>();
  let duplicates = 0;
  for (const verse of verses) {
    const key = `${verse.book} ${verse.chapter}:${verse.verse}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  if (duplicates > 0) problems.push(`${duplicates} duplicate reference(s)`);

  return problems;
}

async function main(): Promise<void> {
  console.log(`\nFetching the World English Bible (public domain)`);
  console.log(`Source: ${SOURCE_BASE}\n`);

  const all: Verse[] = [];

  for (const [index, book] of BOOKS.entries()) {
    const verses = await fetchBook(book);
    all.push(...verses);
    const progress = `${String(index + 1).padStart(2)}/${BOOKS.length}`;
    process.stdout.write(`\r  ${progress}  ${book.padEnd(18)} ${all.length} verses so far   `);
  }

  console.log(`\n`);

  const { kept, dropped } = dropEmpty(all);

  if (dropped.length > 0) {
    console.log(`Dropped ${dropped.length} verse(s) with no body text — expected, see comment:`);
    for (const verse of dropped) {
      console.log(`    · ${verse.book} ${verse.chapter}:${verse.verse}`);
    }
    console.log('');
  }

  const problems = validate(kept);
  if (problems.length > 0) {
    console.error(`✗ Validation failed:`);
    for (const problem of problems) console.error(`    · ${problem}`);
    process.exit(1);
  }

  mkdirSync(dataDir, { recursive: true });
  const serialised = JSON.stringify(kept);
  writeFileSync(outputPath, serialised);

  const sizeMb = (Buffer.byteLength(serialised) / 1_048_576).toFixed(1);
  console.log(`✓ ${kept.length.toLocaleString()} verses across ${BOOKS.length} books`);
  console.log(`  Written to data/verses.web.json (${sizeMb} MB)\n`);
  console.log(`Next:  npm run preview\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
});
