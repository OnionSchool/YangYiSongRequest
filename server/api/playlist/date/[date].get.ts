import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { buildPublicDay } from '../recent.get';
import { isValidDate } from '../../../utils/schedule';

export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date');
  if (!isValidDate(date)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30');
  return buildPublicDay(date);
});
