import { defineEventHandler, readBody, setHeader } from 'h3';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { schedule } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const { playDate, slotId, orderedIds } = await readBody(event);

  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(schedule)
      .set({ orderNo: i + 1 })
      .where(
        and(
          eq(schedule.requestId, orderedIds[i]),
          eq(schedule.playDate, playDate),
          eq(schedule.slotId, slotId)
        )
      );
  }

  await writeAudit(session.userId, 'schedule.reorder', null, {
    playDate,
    slotId,
    count: orderedIds.length,
  });
  return { ok: true };
});
