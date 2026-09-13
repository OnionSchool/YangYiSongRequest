import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireTechnician } from '../../../../../utils/admin-auth';
import { getRequestDownloadLink } from '../../../../../utils/audio-cache';
import { requireScheduledRequest } from '../../../../../utils/schedule';

export default defineEventHandler(async (event) => {
  requireTechnician(event);
  const id = getRouterParam(event, 'id')!;
  await requireScheduledRequest(id);
  setHeader(event, 'Cache-Control', 'no-store');
  return await getRequestDownloadLink(id);
});
