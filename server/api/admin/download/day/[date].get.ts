import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3';
import { requireTechnician } from '../../../../utils/admin-auth';
import { db } from '../../../../utils/db';
import { schedule, songRequest } from '../../../../utils/schema';
import { and, asc, eq } from 'drizzle-orm';
import { getRequestAudio } from '../../../../utils/audio-cache';

function safeName(value: string): string {
  return (
    value
      .split('')
      .filter((character) => character >= ' ' && !'\\/:*?"<>|'.includes(character))
      .join('')
      .trim()
      .slice(0, 100) || 'audio'
  );
}

function csvField(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function zipStore(files: Array<{ name: string; body: Buffer }>): Buffer {
  const encoder = new TextEncoder();
  const crc32 = (body: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunks: Buffer[] = [];
  const entries: Array<{ name: Buffer; crc: number; size: number; offset: number }> = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(encoder.encode(file.name));
    const crc = crc32(file.body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.body.length, 18);
    header.writeUInt32LE(file.body.length, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, file.body);
    entries.push({ name, crc, size: file.body.length, offset });
    offset += header.length + name.length + file.body.length;
  }
  const directoryOffset = offset;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryOffset, 12);
  end.writeUInt32LE(directoryOffset, 16);
  chunks.push(end);
  return Buffer.concat(chunks);
}

export default defineEventHandler(async (event) => {
  requireTechnician(event);
  const date = getRouterParam(event, 'date')!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw createError({ statusCode: 400, message: '日期格式无效' });
  const query = getQuery(event);
  const slotId = typeof query.slotId === 'string' ? query.slotId : undefined;
  const rows = await db
    .select({
      id: songRequest.id,
      title: songRequest.title,
      artist: songRequest.artist,
      orderNo: schedule.orderNo,
      slotId: schedule.slotId,
    })
    .from(schedule)
    .innerJoin(songRequest, eq(schedule.requestId, songRequest.id))
    .where(
      slotId
        ? and(eq(schedule.playDate, date), eq(schedule.slotId, slotId))
        : eq(schedule.playDate, date)
    )
    .orderBy(asc(schedule.slotId), asc(schedule.orderNo));
  if (rows.length === 0) throw createError({ statusCode: 404, message: '该日期没有已排期歌曲' });
  const files: Array<{ name: string; body: Buffer }> = [];
  const failed: string[] = [];
  for (const row of rows) {
    try {
      const stillScheduled = await db
        .select({ id: schedule.id })
        .from(schedule)
        .where(
          and(
            eq(schedule.requestId, row.id),
            eq(schedule.playDate, date),
            eq(schedule.slotId, row.slotId)
          )
        )
        .limit(1);
      if (!stillScheduled[0]) {
        failed.push(`${row.slotId} #${row.orderNo} ${row.title}: 排期已变更`);
        continue;
      }
      const audio = await getRequestAudio(row.id);
      files.push({
        name: `${row.slotId}/${String(row.orderNo).padStart(2, '0')}-${safeName(row.title)}.mp3`,
        body: audio.body,
      });
    } catch (error) {
      failed.push(
        `${row.slotId} #${row.orderNo} ${row.title}: ${error instanceof Error ? error.message : '下载失败'}`
      );
    }
  }
  files.push({
    name: 'playlist.csv',
    body: Buffer.from(
      [
        '时段,序号,歌名,歌手',
        ...rows.map((row) =>
          [
            csvField(row.slotId),
            csvField(row.orderNo),
            csvField(row.title),
            csvField(row.artist),
          ].join(',')
        ),
      ].join('\n'),
      'utf8'
    ),
  });
  if (failed.length > 0)
    files.push({ name: 'failed-downloads.txt', body: Buffer.from(failed.join('\n'), 'utf8') });
  const archive = zipStore(files);
  setHeader(event, 'Cache-Control', 'no-store');
  setHeader(event, 'Content-Type', 'application/zip');
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${date}-broadcast.zip`)}`
  );
  return archive;
});
