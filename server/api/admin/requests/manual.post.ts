import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireAuth } from '../../../utils/admin-auth';
import { manualAddRequest } from '../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireAuth(event);
  const body = await readBody(event);
  return manualAddRequest(body, session.userId);
});
