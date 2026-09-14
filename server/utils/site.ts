import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { siteSetting, broadcastSlot, gradeConfig } from './schema';
import { decodeBool, decodeInt, GRADES } from './domain';
import type { Grade } from './domain';

export interface SiteConfig {
  requestsOpen: boolean;
  guestPreviewOpen: boolean;
  requireIdentity: boolean;
  announcement: string;
  maxScheduleDays: number;
  forceChangePassword: boolean;
  requireEmailBind: boolean;
}

export interface SlotView {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  maxCount: number | null;
  maxMs: number | null;
}

export interface SiteSnapshot extends SiteConfig {
  slots: SlotView[];
  classCounts: Record<Grade, number>;
}

const DEFAULTS: SiteConfig = {
  requestsOpen: true,
  guestPreviewOpen: true,
  requireIdentity: true,
  announcement: '',
  maxScheduleDays: 14,
  forceChangePassword: true,
  requireEmailBind: false,
};

const CACHE_TTL_MS = 30_000;

let cache: { at: number; value: SiteSnapshot } | null = null;

export function invalidateSiteCache(): void {
  cache = null;
}

async function load(): Promise<SiteSnapshot> {
  const [rows, slots, grades] = await Promise.all([
    db.select().from(siteSetting),
    db
      .select()
      .from(broadcastSlot)
      .where(eq(broadcastSlot.enabled, 1))
      .orderBy(asc(broadcastSlot.sortOrder), asc(broadcastSlot.startTime)),
    db.select().from(gradeConfig),
  ]);

  const map = new Map((rows as any[]).map((row) => [row.key, row.value]));
  const classCounts = Object.fromEntries(
    GRADES.map((grade) => {
      const row = (grades as any[]).find((r) => r.grade === grade);
      return [grade, row?.classCount ?? 23];
    })
  ) as Record<Grade, number>;

  return {
    requestsOpen: decodeBool(map.get('requestsOpen'), DEFAULTS.requestsOpen),
    guestPreviewOpen: decodeBool(map.get('guestPreviewOpen'), DEFAULTS.guestPreviewOpen),
    requireIdentity: decodeBool(map.get('requireIdentity'), DEFAULTS.requireIdentity),
    announcement: map.get('announcement') ?? DEFAULTS.announcement,
    maxScheduleDays: decodeInt(map.get('maxScheduleDays'), DEFAULTS.maxScheduleDays),
    forceChangePassword: decodeBool(map.get('forceChangePassword'), DEFAULTS.forceChangePassword),
    requireEmailBind: decodeBool(map.get('requireEmailBind'), DEFAULTS.requireEmailBind),
    slots: (slots as any[]).map((slot) => ({
      id: slot.id,
      name: slot.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      maxCount: slot.maxCount,
      maxMs: slot.maxMs,
    })),
    classCounts,
  };
}

export async function readSite(): Promise<SiteSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const value = await load();
  cache = { at: Date.now(), value };
  return value;
}
