import { defineEventHandler, readBody, setHeader } from 'h3';
import { findBannedHits, findContentScriptHits } from '../../utils/banned-words';
import { readSite } from '../../utils/site';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const body = await readBody(event);
  const texts = [body?.title, body?.artist, body?.requesterName].filter(
    (value): value is string => typeof value === 'string'
  );
  const site = await readSite();
  const hits = [...(await findBannedHits(...texts)), ...findContentScriptHits(site, ...texts)];
  return { allowed: hits.length === 0 };
});
