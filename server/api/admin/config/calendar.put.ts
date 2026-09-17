import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { calendarDay } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';
import { badRequest } from '../../../utils/errors';
import { isDayKind, type DayKind } from '../../../utils/domain';
import { isValidDate } from '../../../utils/schedule';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody<unknown>(event);
  const days =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { days?: unknown }).days
      : undefined;
  if (!Array.isArray(days) || days.length > 366) throw badRequest('BAD_CALENDAR', '日历配置无效');

  for (const day of days) {
    if (!day || typeof day !== 'object') throw badRequest('BAD_CALENDAR', '日历配置无效');
    const { date, kind, note } = day as Record<string, unknown>;
    if (
      typeof date !== 'string' ||
      !isValidDate(date) ||
      (kind !== null && !isDayKind(kind)) ||
      (note !== undefined && typeof note !== 'string') ||
      (typeof note === 'string' && note.length > 200)
    ) {
      throw badRequest('BAD_CALENDAR', '日历配置无效');
    }
    if (kind === null) {
      // Delete entry
      await db.delete(calendarDay).where(eq(calendarDay.date, date));
    } else {
      const validKind = kind as DayKind;
      const existing = await db
        .select()
        .from(calendarDay)
        .where(eq(calendarDay.date, date))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(calendarDay)
          .set({
            kind: validKind,
            note: typeof note === 'string' && note.trim() ? note.trim() : null,
          })
          .where(eq(calendarDay.date, date));
      } else {
        await db
          .insert(calendarDay)
          .values({
            date,
            kind: validKind,
            note: typeof note === 'string' && note.trim() ? note.trim() : null,
          });
      }
    }
  }

  await writeAudit(session.userId, 'config.calendar', null, { count: days.length });
  return { ok: true };
});
