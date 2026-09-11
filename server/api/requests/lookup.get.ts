import { createError, defineEventHandler, getRequestURL, setHeader } from 'h3';
import { lookupByCode } from '../../utils/requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const url = getRequestURL(event);
  const code = url.searchParams.get('code') || '';

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing code',
      message: 'code query param is required',
    });
  }

  const result = lookupByCode(code);
  return result;
});
