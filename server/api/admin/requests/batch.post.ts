import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { batchRequests } from '../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const body = await readBody<{ action?: unknown; ids?: unknown; reason?: unknown }>(event);
  if (
    body.action !== 'reject' ||
    !Array.isArray(body.ids) ||
    !body.ids.every((id) => typeof id === 'string') ||
    (body.reason !== undefined && typeof body.reason !== 'string')
  ) {
    throw createError({ statusCode: 400, message: '批量操作参数无效' });
  }
  return batchRequests({ ids: body.ids, action: 'reject', reason: body.reason }, session.userId);
});
