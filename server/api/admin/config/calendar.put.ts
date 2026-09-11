import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { calendarDay } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const { days } = await readBody(event);

  for (const day of days) {
    if (day.kind === null) {
      // Delete entry
      await db.delete(calendarDay).where(eq(calendarDay.date, day.date));
    } else {
      const existing = await db
        .select()
        .from(calendarDay)
        .where(eq(calendarDay.date, day.date))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(calendarDay)
          .set({ kind: day.kind, note: day.note || null })
          .where(eq(calendarDay.date, day.date));
      } else {
        await db
          .insert(calendarDay)
          .values({ date: day.date, kind: day.kind, note: day.note || null });
      }
    }
  }

  await writeAudit(session.userId, 'config.calendar', null, { count: days.length });
  return { ok: true };
});
