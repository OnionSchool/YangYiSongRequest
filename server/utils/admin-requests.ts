import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db, sqlite } from './db';
import { songRequest, schedule, broadcastSlot } from './schema';
import { badRequest, notFound } from './errors';
import { writeAudit } from './audit';
import {
  getEffectiveSlots,
  updateScheduleVersion,
  validateSchedulableDate,
  validateSlotCapacity,
  isValidDate,
} from './schedule';
import { isUniqueViolation, newQueryCode } from './requests';

const PAGE_SIZE = 20;

export interface ListParams {
  status?: string;
  date?: string;
  page?: number;
}

export async function listAdminRequests(params: ListParams) {
  const page = Math.max(1, params.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions: any[] = [];
  if (params.status) {
    conditions.push(eq(songRequest.status, params.status));
  }
  if (params.date) {
    if (!isValidDate(params.date)) throw badRequest('BAD_DATE', '日期格式无效');
    // Filter by date: createdAt >= dayStart AND createdAt < dayEnd
    const dayStart = Math.floor(new Date(params.date + 'T00:00:00+08:00').getTime() / 1000);
    const dayEnd = dayStart + 86400;
    conditions.push(gte(songRequest.createdAt, dayStart));
    conditions.push(sql`${songRequest.createdAt} < ${dayEnd}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult, items] = await Promise.all([
    db.select({ count: count() }).from(songRequest).where(where),
    db
      .select({
        id: songRequest.id,
        queryCode: songRequest.queryCode,
        status: songRequest.status,
        source: songRequest.source,
        platformId: songRequest.platformId,
        title: songRequest.title,
        artist: songRequest.artist,
        album: songRequest.album,
        coverUrl: songRequest.coverUrl,
        durationMs: songRequest.durationMs,
        grade: songRequest.grade,
        classNo: songRequest.classNo,
        requesterName: songRequest.requesterName,
        flaggedWords: songRequest.flaggedWords,
        isManual: songRequest.isManual,
        rejectReason: songRequest.rejectReason,
        createdAt: songRequest.createdAt,
        schedulePlayDate: schedule.playDate,
        scheduleSlotId: schedule.slotId,
        scheduleOrderNo: schedule.orderNo,
        slotName: broadcastSlot.name,
      })
      .from(songRequest)
      .leftJoin(schedule, eq(songRequest.id, schedule.requestId))
      .leftJoin(broadcastSlot, eq(schedule.slotId, broadcastSlot.id))
      .where(where)
      .orderBy(desc(songRequest.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
  ]);

  const total = Number((totalResult[0] as any)?.count ?? 0);

  return {
    total,
    page,
    items: items.map((r: any) => ({
      id: r.id,
      status: r.status,
      source: r.source,
      platformId: r.platformId,
      title: r.title,
      artist: r.artist,
      album: r.album,
      coverUrl: r.coverUrl,
      durationMs: r.durationMs,
      vipHint: false,
      requester: r.requesterName
        ? `${r.grade ?? ''}${r.classNo ? `(${r.classNo})` : ''} ${r.requesterName}`
        : null,
      flaggedWords: JSON.parse(r.flaggedWords || '[]'),
      isManual: r.isManual === 1,
      rejectReason: r.rejectReason,
      createdAt: new Date(r.createdAt * 1000).toISOString(),
      schedule: r.schedulePlayDate
        ? {
            playDate: r.schedulePlayDate,
            slotId: r.scheduleSlotId,
            slotName: r.slotName,
            orderNo: r.scheduleOrderNo,
          }
        : null,
    })),
  };
}

export async function scheduleRequest(
  requestId: string,
  playDate: string,
  slotId: string,
  actorId: string,
  expectedVersion?: number
) {
  const req = await db.select().from(songRequest).where(eq(songRequest.id, requestId)).limit(1);
  if (req.length === 0) throw notFound('REQUEST_NOT_FOUND', '找不到该请求');
  if (req[0].status !== 'PENDING') throw badRequest('REQUEST_NOT_PENDING', '该请求不可再次排期');
  await validateSchedulableDate(playDate);
  const slot = (await getEffectiveSlots(playDate)).find((item) => item.id === slotId);
  if (!slot) throw notFound('SLOT_NOT_FOUND', '该日期没有启用的目标时段');
  const capacity = await validateSlotCapacity(playDate, slot, req[0].durationMs);
  const scheduleId = `sch_${randomBytes(8).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  const result = sqlite.transaction(() => {
    const existing = sqlite
      .prepare('SELECT "id" FROM "Schedule" WHERE "requestId" = ?')
      .get(requestId);
    if (existing) throw badRequest('REQUEST_ALREADY_SCHEDULED', '该请求已经排期');
    const currentCount = sqlite
      .prepare(
        'SELECT COUNT(*) AS "count", COALESCE(MAX(s."orderNo"), 0) AS "maxOrderNo", COALESCE(SUM(r."durationMs"), 0) AS "totalMs" FROM "Schedule" s JOIN "SongRequest" r ON r."id" = s."requestId" WHERE s."playDate" = ? AND s."slotId" = ?'
      )
      .get(playDate, slotId) as { count: number; maxOrderNo: number; totalMs: number };
    const orderNo = Number(currentCount.maxOrderNo) + 1;
    if (slot.maxCount !== null && orderNo > slot.maxCount) {
      throw badRequest('SLOT_COUNT_EXCEEDED', `已超出该时段上限（${slot.maxCount}首）`);
    }
    const limitMs =
      slot.maxMs ??
      (Number(slot.endTime.slice(0, 2)) * 60 +
        Number(slot.endTime.slice(3)) -
        Number(slot.startTime.slice(0, 2)) * 60 -
        Number(slot.startTime.slice(3))) *
        60_000;
    if (req[0].durationMs > 0 && Number(currentCount.totalMs) + req[0].durationMs > limitMs) {
      throw badRequest('SLOT_DURATION_EXCEEDED', '该时段已容纳不下这首歌');
    }
    const version = updateScheduleVersion(playDate, expectedVersion);
    sqlite
      .prepare(
        'INSERT INTO "Schedule" ("id", "requestId", "playDate", "slotId", "orderNo", "createdAt") VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(scheduleId, requestId, playDate, slotId, orderNo, now);
    sqlite
      .prepare(
        'UPDATE "SongRequest" SET "status" = ?, "playbackStatus" = ?, "reviewedAt" = ?, "reviewedById" = ?, "finalizedAt" = NULL WHERE "id" = ?'
      )
      .run('SCHEDULED', 'PENDING_DOWNLOAD', now, actorId, requestId);
    return { orderNo, version };
  })();
  await writeAudit(actorId, 'request.schedule', requestId, {
    playDate,
    slotId,
    orderNo: result.orderNo,
  });
  return { ...result, durationIncomplete: capacity.durationIncomplete };
}

export async function rejectRequest(requestId: string, reason: string, actorId: string) {
  const req = await db.select().from(songRequest).where(eq(songRequest.id, requestId)).limit(1);
  if (req.length === 0) throw notFound('REQUEST_NOT_FOUND', '找不到该请求');
  if (req[0].status !== 'PENDING') throw badRequest('REQUEST_NOT_PENDING', '该请求不可驳回');

  await db
    .update(songRequest)
    .set({
      status: 'REJECTED',
      rejectReason: reason,
      reviewedAt: Math.floor(Date.now() / 1000),
      reviewedById: actorId,
      finalizedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(songRequest.id, requestId));

  await writeAudit(actorId, 'request.reject', requestId, { reason });
  return { ok: true as const };
}

export async function unscheduleRequest(
  requestId: string,
  actorId: string,
  expectedVersion?: number
) {
  const scheduled = await db
    .select()
    .from(schedule)
    .where(eq(schedule.requestId, requestId))
    .limit(1);
  if (!scheduled[0]) throw notFound('SCHEDULE_NOT_FOUND', '找不到排期记录');
  const result = sqlite.transaction(() => {
    const version = updateScheduleVersion(scheduled[0].playDate, expectedVersion);
    sqlite.prepare('DELETE FROM "Schedule" WHERE "requestId" = ?').run(requestId);
    sqlite
      .prepare(
        'UPDATE "SongRequest" SET "status" = ?, "playbackStatus" = ?, "reviewedAt" = NULL, "reviewedById" = NULL WHERE "id" = ?'
      )
      .run('PENDING', 'PENDING_DOWNLOAD', requestId);
    return { version };
  })();

  await writeAudit(actorId, 'schedule.remove', requestId);
  return { ok: true as const, ...result };
}

export async function batchRequests(
  body: {
    ids: string[];
    action: 'schedule' | 'reject';
    playDate?: string;
    slotId?: string;
    reason?: string;
  },
  actorId: string
) {
  const results: { done: number; failed: Array<{ id: string; message: string }> } = {
    done: 0,
    failed: [],
  };

  for (const id of body.ids) {
    try {
      if (body.action === 'schedule') {
        if (!body.playDate || !body.slotId)
          throw badRequest('MISSING_PARAMS', '排期需要 playDate 和 slotId');
        await scheduleRequest(id, body.playDate, body.slotId, actorId);
      } else {
        await rejectRequest(id, body.reason || '批量驳回', actorId);
      }
      results.done++;
    } catch (e: any) {
      results.failed.push({ id, message: e.message ?? String(e) });
    }
  }

  await writeAudit(actorId, 'request.batch', null, { action: body.action, count: body.ids.length });
  return results;
}

export async function manualAddRequest(
  body: { source: string; platformId: string; playDate?: string; slotId?: string },
  actorId: string
) {
  const { getSource } = await import('./music-sources');
  const src = getSource(body.source);
  if (!src) throw badRequest('BAD_SOURCE', '无效音源');

  const song = await src.detail(body.platformId);
  if (!song) throw notFound('SONG_NOT_FOUND', '找不到歌曲');

  const id = `req_${randomBytes(8).toString('hex')}`;
  let queryCode = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      queryCode = newQueryCode();
      await db.insert(songRequest).values({
        id,
        queryCode,
        source: song.source,
        platformId: String(song.platformId),
        title: song.title,
        artist: song.artist,
        album: song.album ?? null,
        durationMs: song.durationMs,
        coverUrl: song.coverUrl ?? null,
        flaggedWords: '[]',
        isManual: 1,
        submitIp: 'admin',
        createdAt: Math.floor(Date.now() / 1000),
      });
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }

  if (body.playDate && body.slotId) {
    await scheduleRequest(id, body.playDate, body.slotId, actorId);
  }

  await writeAudit(actorId, 'request.manual', id, {
    source: body.source,
    platformId: body.platformId,
  });
  return { id, queryCode };
}
