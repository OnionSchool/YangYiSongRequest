import { defineEventHandler, setHeader } from 'h3';
import { readSite } from '../../../utils/site';
import { requireAuth } from '../../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=30');

  requireAuth(event);

  const site = await readSite();

  return {
    requestsOpen: site.requestsOpen,
    guestPreviewOpen: site.guestPreviewOpen,
    requireIdentity: site.requireIdentity,
    announcement: site.announcement,
    maxScheduleDays: site.maxScheduleDays,
    forceChangePassword: site.forceChangePassword,
    requireEmailBind: site.requireEmailBind,
  };
});
