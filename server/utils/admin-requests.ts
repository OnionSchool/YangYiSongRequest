import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from './db';
import { songRequest, schedule, broadcastSlot } from './schema';
import { badRequest, notFound } from './errors';
import { writeAudit } from './audit';

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
  actorId: string
) {
  const req = await db.select().from(songRequest).where(eq(songRequest.id, requestId)).limit(1);
  if (req.length === 0) throw notFound('REQUEST_NOT_FOUND', '找不到该请求');

  const slot = await db.select().from(broadcastSlot).where(eq(broadcastSlot.id, slotId)).limit(1);
  if (slot.length === 0) throw notFound('SLOT_NOT_FOUND', '找不到该时段');

  // Get next order number
  const maxOrder = await db
    .select({ max: sql<number>`COALESCE(MAX(${schedule.orderNo}), 0)` })
    .from(schedule)
    .where(and(eq(schedule.playDate, playDate), eq(schedule.slotId, slotId)));
  const orderNo = (Number((maxOrder[0] as any)?.max) || 0) + 1;

  const scheduleId = `sch_${randomBytes(8).toString('hex')}`;
  await db.insert(schedule).values({
    id: scheduleId,
    requestId,
    playDate,
    slotId,
    orderNo,
    createdAt: Math.floor(Date.now() / 1000),
  });

  await db
    .update(songRequest)
    .set({
      status: 'SCHEDULED',
      reviewedAt: Math.floor(Date.now() / 1000),
      reviewedById: actorId,
    })
    .where(eq(songRequest.id, requestId));

  await writeAudit(actorId, 'request.schedule', requestId, { playDate, slotId, orderNo });

  // Check capacity
  const slotRow = slot[0] as any;
  const countResult = await db
    .select({ count: count() })
    .from(schedule)
    .where(and(eq(schedule.playDate, playDate), eq(schedule.slotId, slotId)));
  const current = Number((countResult[0] as any)?.count ?? 0);
  const over = slotRow.maxCount != null && current > slotRow.maxCount;

  return {
    orderNo,
    capacity: {
      over,
      message: over ? `已超出该时段上限（${slotRow.maxCount}首）` : null,
    },
  };
}

export async function rejectRequest(requestId: string, reason: string, actorId: string) {
  const req = await db.select().from(songRequest).where(eq(songRequest.id, requestId)).limit(1);
  if (req.length === 0) throw notFound('REQUEST_NOT_FOUND', '找不到该请求');

  await db
    .update(songRequest)
    .set({
      status: 'REJECTED',
      rejectReason: reason,
      reviewedAt: Math.floor(Date.now() / 1000),
      reviewedById: actorId,
    })
    .where(eq(songRequest.id, requestId));

  await writeAudit(actorId, 'request.reject', requestId, { reason });
  return { ok: true as const };
}

export async function unscheduleRequest(requestId: string, actorId: string) {
  await db.delete(schedule).where(eq(schedule.requestId, requestId));
  await db
    .update(songRequest)
    .set({
      status: 'PENDING',
      reviewedAt: null,
      reviewedById: null,
    })
    .where(eq(songRequest.id, requestId));

  await writeAudit(actorId, 'schedule.remove', requestId);
  return { ok: true as const };
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

  // Search for song info
  const results = await src.search(body.platformId, 1);
  const song =
    results.songs.find((s: any) => String(s.platformId) === String(body.platformId)) ||
    results.songs[0];
  if (!song) throw notFound('SONG_NOT_FOUND', '找不到歌曲');

  const id = `req_${randomBytes(8).toString('hex')}`;
  const queryCode = generateCode();

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

  if (body.playDate && body.slotId) {
    await scheduleRequest(id, body.playDate, body.slotId, actorId);
  }

  await writeAudit(actorId, 'request.manual', id, {
    source: body.source,
    platformId: body.platformId,
  });
  return { id, queryCode };
}

function generateCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
