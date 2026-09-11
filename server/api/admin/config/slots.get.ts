import { defineEventHandler, setHeader } from 'h3';
import { asc } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { broadcastSlot } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const slots = await db.select().from(broadcastSlot).orderBy(asc(broadcastSlot.sortOrder));
  return (slots as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    maxCount: s.maxCount,
    maxMs: s.maxMs,
    sortOrder: s.sortOrder,
    enabled: s.enabled === 1,
  }));
});
