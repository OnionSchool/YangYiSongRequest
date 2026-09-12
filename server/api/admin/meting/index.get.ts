import { defineEventHandler, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { listMetingApis } from '../../../utils/music-sources';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requirePlanner(event);
  return { items: await listMetingApis() };
});
