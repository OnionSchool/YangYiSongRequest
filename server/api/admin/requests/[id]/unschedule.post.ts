import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireAuth } from '../../../../utils/admin-auth';
import { unscheduleRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  return unscheduleRequest(id, session.userId);
});
