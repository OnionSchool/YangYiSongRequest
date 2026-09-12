import { defineEventHandler, getRequestURL, setHeader } from 'h3';
import { desc, sql } from 'drizzle-orm';
import { requireSuper } from '../../utils/admin-auth';
import { db } from '../../utils/db';
import { songRequest } from '../../utils/schema';

const PAGE_SIZE = 30;

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const url = getRequestURL(event);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const [totalResult, items] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(songRequest),
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
