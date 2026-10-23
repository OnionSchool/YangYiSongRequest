import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { manualAddRequest } from '../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const body = await readBody<{ source?: unknown; platformId?: unknown }>(event);
  if (typeof body.source !== 'string' || typeof body.platformId !== 'string') {
    throw createError({ statusCode: 400, message: '手动添加参数无效' });
  }
  return manualAddRequest({ source: body.source, platformId: body.platformId }, session.userId);
});
