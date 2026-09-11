import { createError, defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requireAuth } from '../../../../utils/admin-auth';
import { db } from '../../../../utils/db';
import { songRequest } from '../../../../utils/schema';
import { eq } from 'drizzle-orm';
import { isPlaybackStatus } from '../../../../utils/domain';
import { requireScheduledRequest } from '../../../../utils/schedule';
import { writeAudit } from '../../../../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody<{ status?: unknown }>(event);
  if (!isPlaybackStatus(body.status)) {
    throw createError({ statusCode: 400, message: '播放状态无效' });
  }
  const { request } = await requireScheduledRequest(id);
  const current = request.playbackStatus;
  const allowed =
    (body.status === 'DOWNLOADED' && current === 'PENDING_DOWNLOAD') ||
    (body.status === 'PLAYBACK_ERROR' &&
      (current === 'PENDING_DOWNLOAD' || current === 'DOWNLOADED')) ||
    (body.status === 'PLAYED' && current === 'DOWNLOADED') ||
    (session.role === 'SUPER' && body.status !== current);
  if (!allowed || (session.role !== 'TECHNICIAN' && session.role !== 'SUPER')) {
    throw createError({ statusCode: 403, message: '不允许此播放状态变更' });
  }
  const finalizedAt = body.status === 'PLAYED' ? Math.floor(Date.now() / 1000) : null;
  await db
    .update(songRequest)
    .set({ playbackStatus: body.status, finalizedAt })
    .where(eq(songRequest.id, id));
  await writeAudit(session.userId, 'request.playback', id, { from: current, to: body.status });
  return { ok: true, status: body.status };
});
