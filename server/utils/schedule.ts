import { and, asc, count, eq, inArray, like } from 'drizzle-orm';
import { badRequest, conflict, notFound } from './errors';
import { db, sqlite } from './db';
import { isDayKind } from './domain';
import type { DayKind } from './domain';
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
import { addDays, isWeekend, shanghaiDate } from './time';

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

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function getEffectiveSlots(
  date: string,
  includeDisabled = false
): Promise<EffectiveSlot[]> {
  if (!isValidDate(date)) throw badRequest('BAD_DATE', '日期格式无效');
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

export interface BroadcastMonthDay {
  date: string;
  /** CalendarDay 里登记的日期类型，没登记就是 null */
  kind: DayKind | null;
  /** 这天到底播不播：OFF/考试不播一律不播，SCHOOL 可以抵消周末默认不播 */
  broadcast: boolean;
  /** 已审核通过并排进这天的歌数 */
  songCount: number;
}

export interface BroadcastMonthView {
  month: string;
  days: BroadcastMonthDay[];
}

/**
 * 月历用的整月汇总：每天播不播、排了几首歌。
 * 只给标记用的数量，不泄露歌名与点歌人。
 */
export async function readBroadcastMonth(month: string): Promise<BroadcastMonthView> {
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  const monthPattern = `${month}-%`;

  const [calendarRows, overrideDayRows, overrideRows, weeklyRows, slotRows, countRows] =
    await Promise.all([
      db
        .select({ date: calendarDay.date, kind: calendarDay.kind })
        .from(calendarDay)
        .where(like(calendarDay.date, monthPattern)),
      db
        .select({ date: dateScheduleOverrideDay.date })
        .from(dateScheduleOverrideDay)
        .where(like(dateScheduleOverrideDay.date, monthPattern)),
      db
        .select({
          date: dateScheduleOverride.date,
          slotId: dateScheduleOverride.slotId,
          sortOrder: dateScheduleOverride.sortOrder,
        })
        .from(dateScheduleOverride)
        .where(like(dateScheduleOverride.date, monthPattern))
        .orderBy(asc(dateScheduleOverride.sortOrder)),
      db
        .select({
          weekday: weeklyScheduleRule.weekday,
          slotId: weeklyScheduleRule.slotId,
          sortOrder: weeklyScheduleRule.sortOrder,
        })
        .from(weeklyScheduleRule)
        .orderBy(asc(weeklyScheduleRule.sortOrder)),
      db
        .select({ id: broadcastSlot.id, enabled: broadcastSlot.enabled })
        .from(broadcastSlot)
        .orderBy(asc(broadcastSlot.sortOrder)),
      db
        .select({ date: schedule.playDate, count: count() })
        .from(schedule)
        .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
        .where(and(like(schedule.playDate, monthPattern), eq(songRequest.status, 'SCHEDULED')))
        .groupBy(schedule.playDate),
    ]);

  const kindByDate = new Map<string, DayKind>();
  for (const row of calendarRows) {
    if (isDayKind(row.kind)) kindByDate.set(row.date, row.kind);
  }

  // 每天单独指定的时段：只要这天被 override 过，就不再走周规则
  const overrideDates = new Set(overrideDayRows.map((row) => row.date));
  const overrideSlotsByDate = new Map<string, string[]>();
  for (const row of overrideRows) {
    const slots = overrideSlotsByDate.get(row.date) ?? [];
    slots.push(row.slotId);
    overrideSlotsByDate.set(row.date, slots);
  }

  const weeklySlotsByWeekday = new Map<number, string[]>();
  for (const row of weeklyRows) {
    const slots = weeklySlotsByWeekday.get(row.weekday) ?? [];
    slots.push(row.slotId);
    weeklySlotsByWeekday.set(row.weekday, slots);
  }

  const slotEnabled = new Map(slotRows.map((row) => [row.id, row.enabled === 1]));
  const allSlotsEnabled = slotRows.filter((row) => row.enabled === 1).length;
  const hasWeeklyRules = weeklyRows.length > 0;
  const songCountByDate = new Map(countRows.map((row) => [row.date, Number(row.count)]));

  /** 时刻表每个月都可能不一样，但只要“这天有没有可用时段”，跟着 getEffectiveSlots 的规则走 */
  function hasEnabledSlots(date: string): boolean {
    const override = overrideDates.has(date) ? (overrideSlotsByDate.get(date) ?? []) : null;
    const slotIds = override ?? weeklySlotsByWeekday.get(weekday(date)) ?? [];
    if (slotIds.length > 0) return slotIds.some((id) => slotEnabled.get(id) === true);
    if (override === null && !hasWeeklyRules) return allSlotsEnabled > 0;
    return false;
  }

  /** 周末默认不播，CalendarDay 登记 SCHOOL 才当成上学日；OFF / 考试不播一律不播 */
  function isBroadcastDay(date: string, kind: DayKind | null): boolean {
    if (kind === 'SCHOOL') return true;
    if (kind === 'OFF' || kind === 'EXAM_NO_BROADCAST') return false;
    return !isWeekend(date) && hasEnabledSlots(date);
  }

  const days: BroadcastMonthDay[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const kind = kindByDate.get(date) ?? null;
    days.push({
      date,
      kind,
      broadcast: isBroadcastDay(date, kind),
      songCount: songCountByDate.get(date) ?? 0,
    });
  }

  return { month, days };
}

export async function getScheduleVersion(date: string): Promise<number> {
  const row = await db.select().from(scheduleDay).where(eq(scheduleDay.date, date)).limit(1);
  return row[0]?.version ?? 0;
}

export async function validateSchedulableDate(date: string): Promise<void> {
  if (!isValidDate(date)) throw badRequest('BAD_DATE', '日期格式无效');
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
  if (calendar[0]?.kind !== 'SCHOOL' && (weekday(date) === 0 || weekday(date) === 6)) {
    throw badRequest('DATE_UNAVAILABLE', '周末默认不播出');
  }
  if (calendar[0] && calendar[0].kind !== 'SCHOOL') {
    throw badRequest('DATE_UNAVAILABLE', '该日期不可播出');
  }
}

function minutes(time: string): number {
  // 缺省 0：字符串不符合 HH:mm 时也退成 0，不把 undefined 带进计算
  const [hour = 0, minute = 0] = time.split(':').map(Number);
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

export function updateScheduleVersion(date: string, expectedVersion: number): number {
  const existing = sqlite
    .prepare('SELECT "version" FROM "ScheduleDay" WHERE "date" = ?')
    .get(date) as { version: number } | undefined;
  const current = existing?.version ?? 0;
  if (expectedVersion !== current) {
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
