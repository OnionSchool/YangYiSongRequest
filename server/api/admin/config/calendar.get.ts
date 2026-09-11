import { defineEventHandler, getRequestURL, setHeader } from 'h3';
import { like } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { calendarDay } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const url = getRequestURL(event);
  const month = url.searchParams.get('month'); // e.g. "2026-09"

  let days;
  if (month) {
    days = await db
      .select()
      .from(calendarDay)
      .where(like(calendarDay.date, `${month}%`));
  } else {
    days = await db.select().from(calendarDay);
  }

  return (days as any[]).map((d) => ({
    date: d.date,
    kind: d.kind,
    note: d.note,
  }));
});
