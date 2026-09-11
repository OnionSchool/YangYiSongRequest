import { and, asc, eq } from 'drizzle-orm';
import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireAuth } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { schedule, songRequest } from '../../../utils/schema';
import { getEffectiveSlots, getScheduleVersion } from '../../../utils/schedule';

function addDuration(time: string, durationMs: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const seconds = hour * 3600 + minute * 60 + Math.floor(durationMs / 1000);
  return `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(
    Math.floor(seconds / 60) % 60
  ).padStart(2, '0')}`;
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const date = getRouterParam(event, 'date')!;
  const [slots, version] = await Promise.all([getEffectiveSlots(date), getScheduleVersion(date)]);
  const result = [];
  for (const slot of slots) {
    const songs = await db
      .select({
        id: songRequest.id,
        title: songRequest.title,
        artist: songRequest.artist,
        durationMs: songRequest.durationMs,
        playbackStatus: songRequest.playbackStatus,
        requesterName: songRequest.requesterName,
        grade: songRequest.grade,
        classNo: songRequest.classNo,
        orderNo: schedule.orderNo,
      })
      .from(schedule)
      .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
      .where(and(eq(schedule.playDate, date), eq(schedule.slotId, slot.id)))
      .orderBy(asc(schedule.orderNo));
    let elapsedMs = 0;
    result.push({
      slotId: slot.id,
      slotName: slot.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      maxCount: slot.maxCount,
      maxMs: slot.maxMs,
      totalMs: songs.reduce((total, song) => total + Math.max(0, song.durationMs), 0),
      songs: songs.map((song) => {
        const playTime = addDuration(slot.startTime, elapsedMs);
        elapsedMs += Math.max(0, song.durationMs);
        return {
          id: song.id,
          title: song.title,
          artist: song.artist,
          durationMs: song.durationMs,
          playbackStatus: song.playbackStatus,
          orderNo: song.orderNo,
          playTime,
          ...(session.role === 'TECHNICIAN'
            ? {}
            : {
                requester: song.requesterName
                  ? `${song.grade ?? ''}${song.classNo ? `(${song.classNo})` : ''} ${song.requesterName}`
                  : null,
              }),
        };
      }),
    });
  }
  return { version, slots: result };
});
