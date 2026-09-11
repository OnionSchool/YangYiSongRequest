import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { sqlite } from '../../../utils/db';
import { writeAudit } from '../../../utils/audit';
import { updateScheduleVersion } from '../../../utils/schedule';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const body = await readBody<{
    playDate?: unknown;
    slotId?: unknown;
    orderedIds?: unknown;
    expectedVersion?: unknown;
  }>(event);
  if (
    typeof body.playDate !== 'string' ||
    typeof body.slotId !== 'string' ||
    !Array.isArray(body.orderedIds) ||
    !body.orderedIds.every((id) => typeof id === 'string')
  ) {
    throw createError({ statusCode: 400, message: '调序参数无效' });
  }
  const orderedIds = body.orderedIds as string[];
  const playDate = body.playDate as string;
  const slotId = body.slotId as string;
  const version = sqlite.transaction(() => {
    const current = sqlite
      .prepare(
        'SELECT "requestId" FROM "Schedule" WHERE "playDate" = ? AND "slotId" = ? ORDER BY "orderNo"'
      )
      .all(playDate, slotId) as Array<{ requestId: string }>;
    if (
      current.length !== orderedIds.length ||
      current.some((row) => !orderedIds.includes(row.requestId))
    ) {
      throw createError({ statusCode: 400, message: '调序列表与当前节目单不一致' });
    }
    const nextVersion = updateScheduleVersion(
      playDate,
      typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined
    );
    const update = sqlite.prepare(
      'UPDATE "Schedule" SET "orderNo" = ? WHERE "requestId" = ? AND "playDate" = ? AND "slotId" = ?'
    );
    orderedIds.forEach((id, index) => update.run(-(index + 1), id, playDate, slotId));
    orderedIds.forEach((id, index) => update.run(index + 1, id, playDate, slotId));
    return nextVersion;
  })();

  await writeAudit(session.userId, 'schedule.reorder', null, {
    playDate,
    slotId,
    count: orderedIds.length,
  });
  return { ok: true, version };
});
