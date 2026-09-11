import { createError, defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../../utils/admin-auth';
import { scheduleRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody<{ playDate?: unknown; slotId?: unknown; expectedVersion?: unknown }>(
    event
  );
  if (typeof body.playDate !== 'string' || typeof body.slotId !== 'string') {
    throw createError({ statusCode: 400, message: '排期参数无效' });
  }
  return scheduleRequest(
    id,
    body.playDate,
    body.slotId,
    session.userId,
    typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined
  );
});
