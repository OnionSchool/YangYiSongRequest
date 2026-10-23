import { randomBytes } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { db, sqlite } from '../../../utils/db';
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
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const slot of slots) {
    const name = slot.name.trim();
    if (names.has(name) || (slot.id && ids.has(slot.id))) {
      throw badRequest('BAD_SLOTS', '时段名称或标识不能重复');
    }
    names.add(name);
    if (slot.id) ids.add(slot.id);
  }

  sqlite.transaction(() => {
    const existing = sqlite.prepare('SELECT "id" FROM "BroadcastSlot"').all() as { id: string }[];
    const existingIds = new Set(existing.map((slot) => slot.id));
    const retainedIds = new Set(
      slots.map((slot) => slot.id).filter((id): id is string => Boolean(id))
    );
    const removedIds = existing.map((slot) => slot.id).filter((id) => !retainedIds.has(id));
    if (removedIds.length > 0) {
      const references = sqlite
        .prepare(
          `SELECT COUNT(*) AS "count" FROM (
            SELECT "slotId" FROM "Schedule"
            UNION ALL SELECT "slotId" FROM "WeeklyScheduleRule"
            UNION ALL SELECT "slotId" FROM "DateScheduleOverride"
          ) WHERE "slotId" IN (SELECT value FROM json_each(?))`
        )
        .get(JSON.stringify(removedIds)) as { count: number } | undefined;
      if ((references?.count ?? 0) > 0) {
        throw badRequest('SLOT_IN_USE', '已有排期或规则引用的时段不能删除，请先停用');
      }
    }
    const update = sqlite.prepare(
      'UPDATE "BroadcastSlot" SET "name" = ?, "startTime" = ?, "endTime" = ?, "maxCount" = ?, "maxMs" = ?, "sortOrder" = ?, "enabled" = ? WHERE "id" = ?'
    );
    const insert = sqlite.prepare(
      'INSERT INTO "BroadcastSlot" ("id", "name", "startTime", "endTime", "maxCount", "maxMs", "sortOrder", "enabled") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const id = slot.id || `slot_${randomBytes(6).toString('hex')}`;
      const values = [
        slot.name.trim(),
        slot.startTime,
        slot.endTime,
        slot.maxCount ?? null,
        slot.maxMs ?? null,
        i,
        slot.enabled ? 1 : 0,
      ];
      if (existingIds.has(id)) update.run(...values, id);
      else insert.run(id, ...values);
    }
    const remove = sqlite.prepare('DELETE FROM "BroadcastSlot" WHERE "id" = ?');
    for (const id of removedIds) remove.run(id);
  })();

  invalidateSiteCache();
  await writeAudit(session.userId, 'config.slots', null, { count: slots.length });

  // Return new slots
  const result = await db
    .select()
    .from(broadcastSlot)
    .orderBy(sql`sortOrder ASC`);
  return (result as any[]).map((s) => ({
    id: s.id,
    name: s.name.trim(),
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
    isTime(slot.startTime) &&
    typeof slot.endTime === 'string' &&
    isTime(slot.endTime) &&
    toMinutes(slot.startTime) < toMinutes(slot.endTime) &&
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

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
