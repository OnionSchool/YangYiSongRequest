import { and, asc, eq, inArray } from 'drizzle-orm';
import { badRequest, conflict, notFound } from './errors';
import { db, sqlite } from './db';
import {
  broadcastSlot,
  calendarDay,
  dateScheduleOverride,
  dateScheduleOverrideDay,
  schedule,
  scheduleDay,
  songRequest,
  weeklyScheduleRule,
} from './schema';
import { addDays, shanghaiDate } from './time';

export interface EffectiveSlot {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  maxCount: number | null;
  maxMs: number | null;
  sortOrder: number;
  enabled: boolean;
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function getEffectiveSlots(
  date: string,
  includeDisabled = false
): Promise<EffectiveSlot[]> {
  if (!isDate(date)) throw badRequest('BAD_DATE', '日期格式无效');
  const [overrides, overrideDay, hasWeeklyRules] = await Promise.all([
    db
      .select({ slotId: dateScheduleOverride.slotId, sortOrder: dateScheduleOverride.sortOrder })
      .from(dateScheduleOverride)
      .where(eq(dateScheduleOverride.date, date))
      .orderBy(asc(dateScheduleOverride.sortOrder)),
    db
      .select()
      .from(dateScheduleOverrideDay)
      .where(eq(dateScheduleOverrideDay.date, date))
      .limit(1),
    db.select({ weekday: weeklyScheduleRule.weekday }).from(weeklyScheduleRule).limit(1),
  ]);
  const rules =
    overrideDay.length > 0
      ? overrides
      : await db
          .select({ slotId: weeklyScheduleRule.slotId, sortOrder: weeklyScheduleRule.sortOrder })
          .from(weeklyScheduleRule)
          .where(eq(weeklyScheduleRule.weekday, weekday(date)))
          .orderBy(asc(weeklyScheduleRule.sortOrder));
  const slotIds = rules.map((rule) => rule.slotId);
  const slotRows =
    slotIds.length > 0
      ? await db.select().from(broadcastSlot).where(inArray(broadcastSlot.id, slotIds))
      : overrideDay.length === 0 && hasWeeklyRules.length === 0
        ? await db.select().from(broadcastSlot).orderBy(asc(broadcastSlot.sortOrder))
        : [];
  const byId = new Map(slotRows.map((slot) => [slot.id, slot]));
  const ordered =
    rules.length > 0 ? rules.map((rule) => byId.get(rule.slotId)).filter(Boolean) : slotRows;
  return ordered
    .filter((slot) => includeDisabled || slot!.enabled === 1)
    .map((slot, index) => ({
      id: slot!.id,
      name: slot!.name,
      startTime: slot!.startTime,
      endTime: slot!.endTime,
      maxCount: slot!.maxCount,
      maxMs: slot!.maxMs,
      sortOrder: rules[index]?.sortOrder ?? slot!.sortOrder,
      enabled: slot!.enabled === 1,
    }));
}

export async function getScheduleVersion(date: string): Promise<number> {
  const row = await db.select().from(scheduleDay).where(eq(scheduleDay.date, date)).limit(1);
  return row[0]?.version ?? 0;
}

export async function validateSchedulableDate(date: string): Promise<void> {
  if (!isDate(date)) throw badRequest('BAD_DATE', '日期格式无效');
  const today = shanghaiDate();
  if (date < today) throw badRequest('PAST_DATE', '不能为过去日期排期');
  const setting = sqlite
    .prepare('SELECT "value" FROM "SiteSetting" WHERE "key" = ? LIMIT 1')
    .get('maxScheduleDays') as { value?: string } | undefined;
  const maxDays = Number(setting?.value ?? 14);
  if (date > addDays(today, Number.isFinite(maxDays) ? maxDays : 14)) {
    throw badRequest('DATE_TOO_FAR', '超出允许排期天数');
  }
  const calendar = await db.select().from(calendarDay).where(eq(calendarDay.date, date)).limit(1);
  if (calendar[0] && calendar[0].kind !== 'SCHOOL') {
    throw badRequest('DATE_UNAVAILABLE', '该日期不可播出');
  }
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export async function validateSlotCapacity(
  date: string,
  slot: EffectiveSlot,
  durationMs: number
): Promise<{ orderNo: number; totalMs: number; durationIncomplete: boolean }> {
  const rows = await db
    .select({ durationMs: songRequest.durationMs, orderNo: schedule.orderNo })
    .from(schedule)
    .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
    .where(and(eq(schedule.playDate, date), eq(schedule.slotId, slot.id)))
    .orderBy(asc(schedule.orderNo));
  const orderNo = rows.length + 1;
  if (slot.maxCount !== null && orderNo > slot.maxCount) {
    throw badRequest('SLOT_COUNT_EXCEEDED', `已超出该时段上限（${slot.maxCount}首）`);
  }
  const existingMs = rows.reduce((total, row) => total + Math.max(0, row.durationMs ?? 0), 0);
  const totalMs = existingMs + Math.max(0, durationMs);
  const timeLimit = Math.max(0, minutes(slot.endTime) - minutes(slot.startTime)) * 60_000;
  const limit = slot.maxMs ?? timeLimit;
  if (durationMs > 0 && totalMs > limit) {
    throw badRequest(
      'SLOT_DURATION_EXCEEDED',
      `该时段已容纳不下这首歌（上限${Math.floor(limit / 60000)}分钟）`
    );
  }
  return {
    orderNo,
    totalMs,
    durationIncomplete: durationMs <= 0 || rows.some((row) => row.durationMs <= 0),
  };
}

export function updateScheduleVersion(date: string, expectedVersion: number | undefined): number {
  const existing = sqlite
    .prepare('SELECT "version" FROM "ScheduleDay" WHERE "date" = ?')
    .get(date) as { version: number } | undefined;
  const current = existing?.version ?? 0;
  if (expectedVersion !== undefined && expectedVersion !== current) {
    throw conflict('SCHEDULE_VERSION_CONFLICT', '节目单已被其他人修改，请刷新后重试');
  }
  const next = current + 1;
  sqlite
    .prepare(
      'INSERT INTO "ScheduleDay" ("date", "version", "updatedAt") VALUES (?, ?, unixepoch()) ON CONFLICT("date") DO UPDATE SET "version" = excluded."version", "updatedAt" = excluded."updatedAt"'
    )
    .run(date, next);
  return next;
}

export async function requireScheduledRequest(requestId: string) {
  const rows = await db
    .select({ request: songRequest, schedule })
    .from(schedule)
    .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
    .where(eq(songRequest.id, requestId))
    .limit(1);
  if (!rows[0]) throw notFound('SCHEDULE_NOT_FOUND', '找不到排期记录');
  return rows[0];
}
