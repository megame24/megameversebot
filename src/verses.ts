import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedVerses, Verse, VerseId } from './domain/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const stateDir = join(here, '..', 'state');
const recentPath = join(stateDir, 'recent.json');

export function verseId(verse: Verse): VerseId {
  return `${verse.book} ${verse.chapter}:${verse.verse}`;
}

/**
 * Loads the full translation if present, otherwise falls back to the small
 * development sample so the project runs immediately after clone.
 *
 * See data/README.md for where to get the real file.
 */
export function loadVerses(translation = 'WEB'): LoadedVerses {
  const full = join(dataDir, `verses.${translation.toLowerCase()}.json`);
  const sample = join(dataDir, 'verses.sample.json');

  const path = existsSync(full) ? full : sample;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${path} is not a non-empty array of verses`);
  }

  return { verses: parsed as Verse[], source: path, isSample: path === sample };
}

export interface SelectVerseArgs {
  verses: Verse[];
  recent: VerseId[];
  /** Injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Uniform random draw, excluding recently-used verses.
 *
 * Mirrors the cooldown-then-relax pattern from stream_cohost's promptSelector:
 * if the cooldown list has somehow consumed the entire pool, ignore it rather
 * than failing. With ~31k verses and a 500-entry memory this never triggers,
 * but it keeps the sample data (10 verses) usable too.
 */
export function selectVerse({ verses, recent, random = Math.random }: SelectVerseArgs): Verse {
  if (verses.length === 0) {
    throw new Error('No verses loaded — check data/');
  }

  const recentSet = new Set(recent);
  const pool = verses.filter((verse) => !recentSet.has(verseId(verse)));
  const source = pool.length > 0 ? pool : verses;

  const picked = source[Math.floor(random() * source.length)];
  if (!picked) throw new Error('Selection produced no verse — random() out of range?');
  return picked;
}

export function loadRecent(): VerseId[] {
  if (!existsSync(recentPath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(recentPath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as VerseId[]) : [];
  } catch {
    // A corrupt recent-list is not worth crashing over; worst case is an early repeat.
    return [];
  }
}

export function recordRecent(id: VerseId, limit: number): void {
  const next = [...loadRecent().filter((existing) => existing !== id), id].slice(-limit);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(recentPath, JSON.stringify(next, null, 2));
}
