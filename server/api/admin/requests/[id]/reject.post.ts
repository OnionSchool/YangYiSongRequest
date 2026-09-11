import { defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requireAuth } from '../../../../utils/admin-auth';
import { rejectRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const { reason } = await readBody(event);
  return rejectRequest(id, reason || '', session.userId);
});
