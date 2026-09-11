import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { submitRequest } from '../utils/requests';
import { getClientIp } from '../utils/request-ip';
import { verifyAndConsumePow } from '../utils/request-protection';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const body = await readBody(event);
  if (!body.source || !body.platformId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing fields',
      message: 'source and platformId are required',
    });
  }

  const ip = getClientIp(event);
  verifyAndConsumePow(body, ip);

  const result = await submitRequest(body, ip);
  return result;
});
