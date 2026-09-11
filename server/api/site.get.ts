import { defineEventHandler, setHeader } from 'h3';
import { readSite } from '../utils/site';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');

  const site = await readSite();
  return site;
});
