import { asc } from 'drizzle-orm';
import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import {
  dateScheduleOverride,
  dateScheduleOverrideDay,
  weeklyScheduleRule,
} from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);
  const [weekly, overrides, overrideDays] = await Promise.all([
    db
      .select()
      .from(weeklyScheduleRule)
      .orderBy(asc(weeklyScheduleRule.weekday), asc(weeklyScheduleRule.sortOrder)),
    db
      .select()
      .from(dateScheduleOverride)
      .orderBy(asc(dateScheduleOverride.date), asc(dateScheduleOverride.sortOrder)),
    db.select().from(dateScheduleOverrideDay).orderBy(asc(dateScheduleOverrideDay.date)),
  ]);
  return { weekly, overrides, overrideDays };
});
