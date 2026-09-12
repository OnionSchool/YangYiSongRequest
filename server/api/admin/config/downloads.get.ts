import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { readDownloadTemplates } from '../../../utils/download-config';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);
  return { templates: await readDownloadTemplates() };
});
