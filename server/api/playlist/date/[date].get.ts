import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { buildPublicDay } from '../recent.get';

export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');
  return buildPublicDay(date);
});
