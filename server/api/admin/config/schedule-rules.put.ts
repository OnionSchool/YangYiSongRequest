import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { sqlite } from '../../../utils/db';
import { writeAudit } from '../../../utils/audit';

interface Rule {
  weekday?: unknown;
  date?: unknown;
  slotIds?: unknown;
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody<{ weekly?: unknown; overrides?: unknown }>(event);
  if (!Array.isArray(body.weekly) || !Array.isArray(body.overrides)) {
    throw createError({ statusCode: 400, message: '规则参数无效' });
  }
  const validate = (rules: Rule[], isOverride: boolean) =>
    rules.every(
      (rule) =>
        (isOverride
          ? typeof rule.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rule.date)
          : Number.isInteger(rule.weekday) &&
            Number(rule.weekday) >= 0 &&
            Number(rule.weekday) <= 6) &&
        Array.isArray(rule.slotIds) &&
        rule.slotIds.every((id) => typeof id === 'string')
    );
  if (!validate(body.weekly as Rule[], false) || !validate(body.overrides as Rule[], true)) {
    throw createError({ statusCode: 400, message: '规则内容无效' });
  }
  const weeklyDays = (body.weekly as Array<{ weekday: number }>).map((rule) => rule.weekday);
  const overrideDates = (body.overrides as Array<{ date: string }>).map((rule) => rule.date);
  if (
    new Set(weeklyDays).size !== weeklyDays.length ||
    new Set(overrideDates).size !== overrideDates.length
  ) {
    throw createError({ statusCode: 400, message: '同一日期或星期只能设置一条规则' });
  }
  const slotIds = new Set(
    [...(body.weekly as Rule[]), ...(body.overrides as Rule[])].flatMap(
      (rule) => rule.slotIds as string[]
    )
  );
  if (slotIds.size > 0) {
    const placeholders = [...slotIds].map(() => '?').join(', ');
    const existing = sqlite
      .prepare(`SELECT "id" FROM "BroadcastSlot" WHERE "id" IN (${placeholders})`)
      .all(...slotIds) as Array<{ id: string }>;
    if (existing.length !== slotIds.size) {
      throw createError({ statusCode: 400, message: '规则包含不存在的时段' });
    }
  }
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM "WeeklyScheduleRule"').run();
    sqlite.prepare('DELETE FROM "DateScheduleOverride"').run();
    sqlite.prepare('DELETE FROM "DateScheduleOverrideDay"').run();
    const weeklyInsert = sqlite.prepare(
      'INSERT INTO "WeeklyScheduleRule" ("weekday", "slotId", "sortOrder") VALUES (?, ?, ?)'
    );
    const overrideInsert = sqlite.prepare(
      'INSERT INTO "DateScheduleOverride" ("date", "slotId", "sortOrder") VALUES (?, ?, ?)'
    );
    const overrideDayInsert = sqlite.prepare(
      'INSERT INTO "DateScheduleOverrideDay" ("date") VALUES (?)'
    );
    for (const rule of body.weekly as Array<{ weekday: number; slotIds: string[] }>) {
      rule.slotIds.forEach((slotId, index) => weeklyInsert.run(rule.weekday, slotId, index));
    }
    for (const rule of body.overrides as Array<{ date: string; slotIds: string[] }>) {
      overrideDayInsert.run(rule.date);
      rule.slotIds.forEach((slotId, index) => overrideInsert.run(rule.date, slotId, index));
    }
  })();
  await writeAudit(session.userId, 'config.schedule-rules', null, {
    weekly: body.weekly.length,
    overrides: body.overrides.length,
  });
  return { ok: true };
});
