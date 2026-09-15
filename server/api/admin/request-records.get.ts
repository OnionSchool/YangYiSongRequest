import { createError, defineEventHandler, getRequestURL, setHeader } from 'h3';
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { requireSuper } from '../../utils/admin-auth';
import { db } from '../../utils/db';
import { songRequest } from '../../utils/schema';
import { isValidDate } from '../../utils/schedule';

const PAGE_SIZE = 30;

function dayStart(date: string) {
  return Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const url = getRequestURL(event);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const keyword = url.searchParams.get('keyword')?.trim().slice(0, 100);
  const status = url.searchParams.get('status')?.trim();
  const source = url.searchParams.get('source')?.trim();
  const submitter = url.searchParams.get('submitter')?.trim();
  const from = url.searchParams.get('from')?.trim();
  const to = url.searchParams.get('to')?.trim();
  const validStatuses = new Set(['PENDING', 'SCHEDULED', 'REJECTED', 'CANCELLED']);
  const validSources = new Set(['netease', 'qq', 'kugou']);
  if ((status && !validStatuses.has(status)) || (source && !validSources.has(source))) {
    throw createError({ statusCode: 400, message: '筛选条件无效' });
  }
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    throw createError({ statusCode: 400, message: '筛选日期无效' });
  }
  const conditions = [];
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(
      or(
        like(songRequest.title, pattern),
        like(songRequest.artist, pattern),
        like(songRequest.requesterName, pattern),
        like(songRequest.queryCode, pattern),
        like(songRequest.submitIp, pattern)
      )
    );
  }
  if (status) conditions.push(eq(songRequest.status, status));
  if (source) conditions.push(eq(songRequest.source, source));
  if (submitter === 'manual') conditions.push(eq(songRequest.isManual, 1));
  if (submitter === 'visitor') conditions.push(eq(songRequest.isManual, 0));
  if (from) conditions.push(gte(songRequest.createdAt, dayStart(from)));
  if (to) conditions.push(lte(songRequest.createdAt, dayStart(to) + 86_399));
  const where = conditions.length ? and(...conditions) : undefined;
  const [totalResult, items] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(songRequest)
      .where(where),
    db
      .select({
        id: songRequest.id,
        queryCode: songRequest.queryCode,
        source: songRequest.source,
        platformId: songRequest.platformId,
        title: songRequest.title,
        artist: songRequest.artist,
        album: songRequest.album,
        durationMs: songRequest.durationMs,
        coverUrl: songRequest.coverUrl,
        grade: songRequest.grade,
        classNo: songRequest.classNo,
        requesterName: songRequest.requesterName,
        status: songRequest.status,
        rejectReason: songRequest.rejectReason,
        isManual: songRequest.isManual,
        submitIp: songRequest.submitIp,
        submitUserAgent: songRequest.submitUserAgent,
        createdAt: songRequest.createdAt,
      })
      .from(songRequest)
      .where(where)
      .orderBy(desc(songRequest.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
  ]);

  return {
    total: Number(totalResult[0]?.count ?? 0),
    page,
    pageSize: PAGE_SIZE,
    items: items.map((row) => ({
      ...row,
      isManual: Boolean(row.isManual),
      createdAt: new Date(row.createdAt * 1000).toISOString(),
    })),
  };
});
