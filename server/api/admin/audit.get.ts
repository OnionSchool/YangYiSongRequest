import { createError, defineEventHandler, getRequestURL, setHeader } from 'h3';
import { and, desc, gte, like, lte, or, sql } from 'drizzle-orm';
import { requireSuper } from '../../utils/admin-auth';
import { cleanupAuditLogs } from '../../utils/audit';
import { db } from '../../utils/db';
import { adminUser, auditLog } from '../../utils/schema';
import { isValidDate } from '../../utils/schedule';

const PAGE_SIZE = 30;

function dayStart(date: string) {
  return Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
}

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
  const action = url.searchParams.get('action')?.trim();
  const keyword = url.searchParams.get('keyword')?.trim().slice(0, 100);
  const from = url.searchParams.get('from')?.trim();
  const to = url.searchParams.get('to')?.trim();
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    throw createError({ statusCode: 400, message: '筛选日期无效' });
  }
  const conditions = [];
  if (action) conditions.push(sql`${auditLog.action} = ${action}`);
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(
      or(
        like(adminUser.username, pattern),
        like(adminUser.displayName, pattern),
        like(auditLog.ip, pattern),
        like(auditLog.targetId, pattern)
      )
    );
  }
  if (from) conditions.push(gte(auditLog.createdAt, dayStart(from)));
  if (to) conditions.push(lte(auditLog.createdAt, dayStart(to) + 86_399));
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalResult, items] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLog)
      .leftJoin(adminUser, sql`${auditLog.actorId} = ${adminUser.id}`)
      .where(where),
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
      .where(where)
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
