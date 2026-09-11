import { defineEventHandler, readBody, setHeader } from 'h3';
import { findBannedHits } from '../../utils/banned-words';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const body = await readBody(event);
  const texts = [body?.title, body?.artist, body?.requesterName].filter(
    (value): value is string => typeof value === 'string'
  );
  return { allowed: (await findBannedHits(...texts)).length === 0 };
});
