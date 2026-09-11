import { defineEventHandler, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { manualAddRequest } from '../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const body = await readBody(event);
  return manualAddRequest(body, session.userId);
});
