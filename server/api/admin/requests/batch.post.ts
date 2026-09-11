import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireAuth } from '../../../utils/admin-auth';
import { batchRequests } from '../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const body = await readBody(event);
  return batchRequests(body, session.userId);
});
