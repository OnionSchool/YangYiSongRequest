import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { and, asc, eq } from 'drizzle-orm';
import { requireAuth } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { broadcastSlot, schedule, songRequest } from '../../../utils/schema';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireAuth(event);

  const date = getRouterParam(event, 'date')!;

  // Get all enabled slots
  const slots = await db
    .select()
    .from(broadcastSlot)
    .where(eq(broadcastSlot.enabled, 1))
    .orderBy(asc(broadcastSlot.sortOrder), asc(broadcastSlot.startTime));

  const result = [];
  for (const slot of slots) {
    const songs = await db
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
        orderNo: schedule.orderNo,
      })
      .from(schedule)
      .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
      .where(and(eq(schedule.playDate, date), eq(schedule.slotId, (slot as any).id)))
      .orderBy(asc(schedule.orderNo));

    const totalMs = songs.reduce((sum: number, s: any) => sum + (s.durationMs || 0), 0);

    result.push({
      slotId: (slot as any).id,
      slotName: (slot as any).name,
      startTime: (slot as any).startTime,
      endTime: (slot as any).endTime,
      maxCount: (slot as any).maxCount,
      totalMs,
      songs: songs.map((s: any) => ({
        id: s.id,
        status: s.status,
        source: s.source,
        platformId: s.platformId,
        title: s.title,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        durationMs: s.durationMs,
        vipHint: false,
        requester: s.requesterName
          ? `${s.grade ?? ''}${s.classNo ? `(${s.classNo})` : ''} ${s.requesterName}`
          : null,
        flaggedWords: JSON.parse(s.flaggedWords || '[]'),
        isManual: s.isManual === 1,
        rejectReason: s.rejectReason,
        createdAt: new Date(s.createdAt * 1000).toISOString(),
        schedule: {
          playDate: date,
          slotId: (slot as any).id,
          slotName: (slot as any).name,
          orderNo: s.orderNo,
        },
      })),
    });
  }

  return result;
});
