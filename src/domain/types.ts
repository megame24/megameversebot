export interface Verse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

/** Human-readable stable identifier, e.g. "John 3:16". Used as the no-repeat key. */
export type VerseId = string;

export interface LoadedVerses {
  verses: Verse[];
  /** Path the data came from, so the preview can say whether it's real or the sample. */
  source: string;
  isSample: boolean;
}
