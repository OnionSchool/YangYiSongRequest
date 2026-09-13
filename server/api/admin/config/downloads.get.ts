import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { readDownloadMode, readDownloadTemplates } from '../../../utils/download-config';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);
  const [templates, mode] = await Promise.all([readDownloadTemplates(), readDownloadMode()]);
  return { templates, mode };
});
