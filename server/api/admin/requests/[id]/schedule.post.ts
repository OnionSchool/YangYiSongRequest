import { defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requireAuth } from '../../../../utils/admin-auth';
import { scheduleRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const { playDate, slotId } = await readBody(event);
  return scheduleRequest(id, playDate, slotId, session.userId);
});
