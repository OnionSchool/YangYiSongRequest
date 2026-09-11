import { defineEventHandler, getRequestURL, setHeader } from 'h3';
import { desc, sql } from 'drizzle-orm';
import { requireAuth } from '../../utils/admin-auth';
import { db } from '../../utils/db';
import { auditLog } from '../../utils/schema';

const PAGE_SIZE = 30;

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireAuth(event);

  const url = getRequestURL(event);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [totalResult, items] = await Promise.all([
    db.select({ count: sql`COUNT(*)` }).from(auditLog),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(PAGE_SIZE).offset(offset),
  ]);

  return {
    total: Number((totalResult[0] as any)?.count ?? 0),
    page,
    items: (items as any[]).map((row) => ({
      id: row.id,
      actor: row.actorId,
      action: row.action,
      targetId: row.targetId,
      detail: row.detail ? JSON.parse(row.detail) : null,
      createdAt: new Date(row.createdAt * 1000).toISOString(),
    })),
  };
});
