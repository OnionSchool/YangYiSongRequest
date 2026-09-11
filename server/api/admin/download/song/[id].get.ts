import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireTechnician } from '../../../../utils/admin-auth';
import { getRequestAudio } from '../../../../utils/audio-cache';
import { requireScheduledRequest } from '../../../../utils/schedule';

function contentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export default defineEventHandler(async (event) => {
  requireTechnician(event);
  const id = getRouterParam(event, 'id')!;
  await requireScheduledRequest(id);
  const audio = await getRequestAudio(id);
  setHeader(event, 'Cache-Control', 'no-store');
  setHeader(event, 'Content-Type', audio.mimeType);
  setHeader(event, 'Content-Length', audio.body.length);
  setHeader(event, 'Content-Disposition', contentDisposition(audio.fileName));
  return audio.body;
});
