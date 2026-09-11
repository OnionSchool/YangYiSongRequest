/**
 * Banned word filtering with caching.
 */

import { db } from './db'; // Ensure database client is available

const CACHE_TTL_MS = 60_000;

let cache: { at: number; words: string[] } | null = null;

export function invalidateBannedWords(): void {
  cache = null;
}

async function loadWords(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.words;

  let rows;
  try {
    rows = await db.query.bannedWord.findMany({
      columns: { word: true },
    });
  } catch {
    return [];
  }

  const list = rows.map((row) => row.word.trim().toLowerCase()).filter(Boolean);
  cache = { at: Date.now(), words: list };
  return list;
}

/**
 * Find matching banned words in one or more text strings (case-insensitive).
 */
export async function findBannedHits(
  ...texts: Array<string | null | undefined>
): Promise<string[]> {
  const list = await loadWords();
  if (list.length === 0) return [];

  const haystack = texts.filter(Boolean).join(' ').toLowerCase();

  return list.filter((word) => haystack.includes(word));
}
