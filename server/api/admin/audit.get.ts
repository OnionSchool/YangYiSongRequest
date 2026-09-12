import { defineEventHandler, getRequestURL, setHeader } from 'h3';
import { desc, sql } from 'drizzle-orm';
import { requireSuper } from '../../utils/admin-auth';
import { cleanupAuditLogs } from '../../utils/audit';
import { db } from '../../utils/db';
import { adminUser, auditLog } from '../../utils/schema';

const PAGE_SIZE = 30;

function parseDetail(detail: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);
  cleanupAuditLogs();

  const url = getRequestURL(event);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [totalResult, items] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(auditLog),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetId: auditLog.targetId,
        detail: auditLog.detail,
        ip: auditLog.ip,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
        actorId: auditLog.actorId,
        actorUsername: adminUser.username,
        actorDisplayName: adminUser.displayName,
      })
      .from(auditLog)
      .leftJoin(adminUser, sql`${auditLog.actorId} = ${adminUser.id}`)
      .orderBy(desc(auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
  ]);

  return {
    total: Number(totalResult[0]?.count ?? 0),
    page,
    pageSize: PAGE_SIZE,
    retentionDays: 90,
    items: items.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actor: row.actorDisplayName ?? row.actorUsername ?? (row.actorId ? '已删除账号' : '系统'),
      action: row.action,
      targetId: row.targetId,
      detail: parseDetail(row.detail),
      ip: row.ip ?? '未知',
      userAgent: row.userAgent ?? '未知设备',
      createdAt: new Date(row.createdAt * 1000).toISOString(),
    })),
  };
});
