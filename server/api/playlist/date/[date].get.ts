import { and, asc, eq } from 'drizzle-orm';
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { db } from '../../../utils/db';
import { broadcastSlot, schedule, songRequest } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');

  const rows = await db
    .select({
      slotId: broadcastSlot.id,
      slotName: broadcastSlot.name,
      startTime: broadcastSlot.startTime,
      endTime: broadcastSlot.endTime,
      slotOrder: broadcastSlot.sortOrder,
      id: songRequest.id,
      source: songRequest.source,
      platformId: songRequest.platformId,
      title: songRequest.title,
      artist: songRequest.artist,
      coverUrl: songRequest.coverUrl,
      durationMs: songRequest.durationMs,
      orderNo: schedule.orderNo,
      status: songRequest.status,
    })
    .from(schedule)
    .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
    .innerJoin(broadcastSlot, eq(schedule.slotId, broadcastSlot.id))
    .where(and(eq(schedule.playDate, date), eq(broadcastSlot.enabled, 1)))
    .orderBy(asc(broadcastSlot.sortOrder), asc(schedule.orderNo));

  const slots = new Map<string, any>();
  for (const row of rows) {
    const slot = slots.get(row.slotId) ?? {
      slotId: row.slotId,
      slotName: row.slotName,
      startTime: row.startTime,
      endTime: row.endTime,
      totalMs: 0,
      songs: [],
      sortOrder: row.slotOrder,
    };
    slots.set(row.slotId, slot);
    slot.totalMs += row.durationMs;
    slot.songs.push({
      id: row.id,
      source: row.source,
      platformId: row.platformId,
      title: row.title,
      artist: row.artist,
      coverUrl:
        row.source === 'netease' && row.coverUrl && !row.coverUrl.startsWith('/api/cover/netease?')
          ? `/api/cover/netease?url=${encodeURIComponent(row.coverUrl)}`
          : row.coverUrl,
      durationMs: row.durationMs,
      orderNo: row.orderNo,
      status: row.status,
    });
  }

  return {
    date,
    slots: [...slots.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder, ...slot }) => slot),
  };
});
