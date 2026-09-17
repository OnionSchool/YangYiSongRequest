import { and, asc, eq, gte } from 'drizzle-orm';
import { defineEventHandler, setHeader } from 'h3';
import { db } from '../../utils/db';
import { schedule, songRequest } from '../../utils/schema';
import { getEffectiveSlots, isValidDate } from '../../utils/schedule';
import { addDays, shanghaiDate } from '../../utils/time';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');
  const dates = await db
    .selectDistinct({ date: schedule.playDate })
    .from(schedule)
    .where(gte(schedule.playDate, addDays(shanghaiDate(), -1)))
    .orderBy(asc(schedule.playDate));
  return Promise.all(
    dates
      .map(({ date }) => date)
      .filter(isValidDate)
      .map(buildPublicDay)
  );
});

export async function buildPublicDay(date: string) {
  const slots = await getEffectiveSlots(date);
  const rows = await db
    .select({
      slotId: schedule.slotId,
      orderNo: schedule.orderNo,
      source: songRequest.source,
      platformId: songRequest.platformId,
      title: songRequest.title,
      artist: songRequest.artist,
      coverUrl: songRequest.coverUrl,
      durationMs: songRequest.durationMs,
    })
    .from(schedule)
    .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
    .where(and(eq(schedule.playDate, date), eq(songRequest.status, 'SCHEDULED')))
    .orderBy(asc(schedule.orderNo));
  return {
    date,
    slots: slots
      .map((slot) => {
        let elapsedMs = 0;
        const songs = rows
          .filter((row) => row.slotId === slot.id)
          .map((row) => {
            const [hour, minute] = slot.startTime.split(':').map(Number);
            const seconds = hour * 3600 + minute * 60 + Math.floor(elapsedMs / 1000);
            elapsedMs += Math.max(0, row.durationMs);
            return {
              orderNo: row.orderNo,
              playTime: `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(
                Math.floor(seconds / 60) % 60
              ).padStart(2, '0')}`,
              source: row.source,
              platformId: row.platformId,
              title: row.title,
              artist: row.artist,
              coverUrl: row.coverUrl ?? undefined,
            };
          });
        return {
          slotId: slot.id,
          slotName: slot.name,
          startTime: slot.startTime,
          endTime: slot.endTime,
          songs,
        };
      })
      .filter((slot) => slot.songs.length > 0),
  };
}
