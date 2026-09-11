import { defineEventHandler, getRequestURL, setHeader } from 'h3';
import { requirePlanner } from '../../utils/admin-auth';
import { listAdminRequests } from '../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requirePlanner(event);

  const url = getRequestURL(event);
  return listAdminRequests({
    status: url.searchParams.get('status') || undefined,
    date: url.searchParams.get('date') || undefined,
    page: Number(url.searchParams.get('page')) || 1,
  });
});
