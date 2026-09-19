import { createError, defineEventHandler, getRequestURL, setHeader } from 'h3';
import { and, desc, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import { requireSuper } from '../../utils/admin-auth';
import { cleanupAuditLogs } from '../../utils/audit';
import { db } from '../../utils/db';
import { adminUser, auditLog, broadcastSlot, metingApi, songRequest } from '../../utils/schema';
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

function detailValue(detail: unknown, key: string): string | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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

  const parsedItems = items.map((row) => ({ ...row, parsedDetail: parseDetail(row.detail) }));
  const requestIds = parsedItems
    .filter((row) => row.action.startsWith('request.') || row.action === 'schedule.remove')
    .map((row) => row.targetId)
    .filter((id): id is string => Boolean(id));
  const slotIds = parsedItems
    .map((row) => detailValue(row.parsedDetail, 'slotId'))
    .filter((id): id is string => Boolean(id));
  const userIds = parsedItems
    .filter((row) => row.action.startsWith('user.'))
    .map((row) => row.targetId)
    .filter((id): id is string => Boolean(id));
  const metingIds = parsedItems
    .filter((row) => row.action.startsWith('meting.'))
    .map((row) => row.targetId)
    .filter((id): id is string => Boolean(id));
  const [requests, slots, users, metingApis] = await Promise.all([
    requestIds.length
      ? db
          .select({ id: songRequest.id, title: songRequest.title, artist: songRequest.artist })
          .from(songRequest)
          .where(inArray(songRequest.id, requestIds))
      : [],
    slotIds.length
      ? db
          .select({
            id: broadcastSlot.id,
            name: broadcastSlot.name,
            startTime: broadcastSlot.startTime,
            endTime: broadcastSlot.endTime,
          })
          .from(broadcastSlot)
          .where(inArray(broadcastSlot.id, slotIds))
      : [],
    userIds.length
      ? db
          .select({
            id: adminUser.id,
            username: adminUser.username,
            displayName: adminUser.displayName,
          })
          .from(adminUser)
          .where(inArray(adminUser.id, userIds))
      : [],
    metingIds.length
      ? db
          .select({ id: metingApi.id, name: metingApi.name })
          .from(metingApi)
          .where(inArray(metingApi.id, metingIds))
      : [],
  ]);
  const requestNames = new Map(
    requests.map((request) => [request.id, `${request.title} - ${request.artist}`])
  );
  const slotNames = new Map(
    slots.map((slot) => [slot.id, `${slot.name}（${slot.startTime}-${slot.endTime}）`])
  );
  const userNames = new Map(users.map((user) => [user.id, user.displayName ?? user.username]));
  const metingNames = new Map(metingApis.map((api) => [api.id, api.name]));

  return {
    total: Number(totalResult[0]?.count ?? 0),
    page,
    pageSize: PAGE_SIZE,
    retentionDays: 90,
    items: parsedItems.map((row) => {
      const related: Array<{ label: string; value: string }> = [];
      if (row.targetId && requestNames.has(row.targetId)) {
        related.push({ label: '歌曲', value: requestNames.get(row.targetId)! });
      }
      if (row.targetId && userNames.has(row.targetId)) {
        related.push({ label: '账号', value: userNames.get(row.targetId)! });
      }
      if (row.targetId && metingNames.has(row.targetId)) {
        related.push({ label: 'Meting API', value: metingNames.get(row.targetId)! });
      }
      const slotId = detailValue(row.parsedDetail, 'slotId');
      if (slotId && slotNames.has(slotId)) {
        related.push({ label: '播出时段', value: slotNames.get(slotId)! });
      }
      const playDate = detailValue(row.parsedDetail, 'playDate');
      if (playDate) related.push({ label: '播出日期', value: playDate });
      return {
        id: row.id,
        actorId: row.actorId,
        actor: row.actorDisplayName ?? row.actorUsername ?? (row.actorId ? '已删除账号' : '系统'),
        action: row.action,
        targetId: row.targetId,
        detail: row.parsedDetail,
        related,
        ip: row.ip ?? '未知',
        userAgent: row.userAgent ?? '未知设备',
        createdAt: new Date(row.createdAt * 1000).toISOString(),
      };
    }),
  };
});
