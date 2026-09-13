import { eq } from 'drizzle-orm';
import type { SourceId } from './domain';
import { db } from './db';
import { siteSetting } from './schema';

const SOURCES: readonly SourceId[] = ['netease', 'qq', 'kugou'];
const SETTING_PREFIX = 'downloadUrl.';
const MODE_SETTING = 'downloadMode';

export type DownloadMode = 'direct' | 'proxy';

export function parseDownloadMode(value: string | undefined): DownloadMode {
  return value === 'direct' ? 'direct' : 'proxy';
}

export async function readDownloadTemplates(): Promise<Record<SourceId, string>> {
  const rows = await db.select().from(siteSetting);
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(
    SOURCES.map((source) => [source, settings.get(`${SETTING_PREFIX}${source}`) ?? ''])
  ) as Record<SourceId, string>;
}

export async function saveDownloadTemplates(templates: Record<SourceId, string>): Promise<void> {
  for (const source of SOURCES) {
    const key = `${SETTING_PREFIX}${source}`;
    const value = templates[source].trim();
    const existing = await db.select().from(siteSetting).where(eq(siteSetting.key, key)).limit(1);
    if (existing.length) {
      await db.update(siteSetting).set({ value }).where(eq(siteSetting.key, key));
    } else {
      await db.insert(siteSetting).values({ key, value });
    }
  }
}

export async function readDownloadMode(): Promise<DownloadMode> {
  const row = await db.select().from(siteSetting).where(eq(siteSetting.key, MODE_SETTING)).limit(1);
  return parseDownloadMode(row[0]?.value);
}

export async function saveDownloadMode(mode: DownloadMode): Promise<void> {
  const existing = await db
    .select()
    .from(siteSetting)
    .where(eq(siteSetting.key, MODE_SETTING))
    .limit(1);
  if (existing.length) {
    await db.update(siteSetting).set({ value: mode }).where(eq(siteSetting.key, MODE_SETTING));
  } else {
    await db.insert(siteSetting).values({ key: MODE_SETTING, value: mode });
  }
}
