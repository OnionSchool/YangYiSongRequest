import { randomBytes } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { broadcastSlot } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';
import { sql } from 'drizzle-orm';
import { badRequest } from '../../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const { slots } = await readBody<{ slots?: unknown }>(event);
  if (!Array.isArray(slots) || !slots.every(isSlot)) {
    throw badRequest('BAD_SLOTS', '时段配置无效');
  }

  const existing = await db.select({ id: broadcastSlot.id }).from(broadcastSlot);
  const retainedIds = new Set(
    slots.map((slot) => slot.id).filter((id): id is string => Boolean(id))
  );
  const removedIds = existing.map((slot) => slot.id).filter((id) => !retainedIds.has(id));
  if (removedIds.length > 0) {
    const references = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(
        sql`(
        SELECT "slotId" FROM "Schedule"
        UNION ALL SELECT "slotId" FROM "WeeklyScheduleRule"
        UNION ALL SELECT "slotId" FROM "DateScheduleOverride"
      )`
      )
      .where(
        sql`"slotId" IN (${sql.join(
          removedIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
    if (Number(references[0]?.count ?? 0) > 0) {
      throw badRequest('SLOT_IN_USE', '已有排期或规则引用的时段不能删除，请先停用');
    }
  }
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const id = s.id || `slot_${randomBytes(6).toString('hex')}`;
    const current = existing.some((slot) => slot.id === id);
    if (current) {
      await db
        .update(broadcastSlot)
        .set({
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          maxCount: s.maxCount ?? null,
          maxMs: s.maxMs ?? null,
          sortOrder: i,
          enabled: s.enabled ? 1 : 0,
        })
        .where(sql`"id" = ${id}`);
    } else {
      await db
        .insert(broadcastSlot)
        .values({
          id,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          maxCount: s.maxCount ?? null,
          maxMs: s.maxMs ?? null,
          sortOrder: i,
          enabled: s.enabled ? 1 : 0,
        });
    }
  }
  if (removedIds.length > 0)
    await db.delete(broadcastSlot).where(
      sql`"id" IN (${sql.join(
        removedIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

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

function isSlot(value: unknown): value is {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  maxCount?: number | null;
  maxMs?: number | null;
  enabled: boolean;
} {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return (
    (slot.id === undefined || typeof slot.id === 'string') &&
    typeof slot.name === 'string' &&
    slot.name.trim().length > 0 &&
    typeof slot.startTime === 'string' &&
    /^\d{2}:\d{2}$/.test(slot.startTime) &&
    typeof slot.endTime === 'string' &&
    /^\d{2}:\d{2}$/.test(slot.endTime) &&
    slot.startTime < slot.endTime &&
    (slot.maxCount === undefined ||
      slot.maxCount === null ||
      (typeof slot.maxCount === 'number' &&
        Number.isInteger(slot.maxCount) &&
        slot.maxCount > 0)) &&
    (slot.maxMs === undefined ||
      slot.maxMs === null ||
      (typeof slot.maxMs === 'number' && Number.isInteger(slot.maxMs) && slot.maxMs > 0)) &&
    typeof slot.enabled === 'boolean'
  );
}
