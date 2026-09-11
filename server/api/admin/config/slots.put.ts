import { randomBytes } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { broadcastSlot } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';
import { sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const { slots } = await readBody(event);

  // Delete all and re-insert
  await db.delete(broadcastSlot);

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    await db.insert(broadcastSlot).values({
      id: s.id || `slot_${randomBytes(6).toString('hex')}`,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      maxCount: s.maxCount ?? null,
      maxMs: s.maxMs ?? null,
      sortOrder: i,
      enabled: s.enabled ? 1 : 0,
    });
  }

  invalidateSiteCache();
  await writeAudit(session.userId, 'config.slots', null, { count: slots.length });

  // Return new slots
  const result = await db
    .select()
    .from(broadcastSlot)
    .orderBy(sql`sortOrder ASC`);
  return (result as any[]).map((s) => ({
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
