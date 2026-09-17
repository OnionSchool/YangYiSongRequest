import { createError, defineEventHandler, getRequestHeader, readBody, setHeader } from 'h3';
import { submitRequest } from '../utils/requests';
import { getClientIp } from '../utils/request-ip';
import { verifyAndConsumePow } from '../utils/request-protection';
import type { RequestContext } from '../utils/request-protection';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const body = await readBody<unknown>(event);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: '提交内容无效' });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.source !== 'string' || typeof input.platformId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing fields',
      message: 'source and platformId are required',
    });
  }

  const ip = getClientIp(event);
  const context: RequestContext & {
    challengeId?: unknown;
    nonce?: unknown;
    contextHash?: unknown;
  } = {
    ...input,
    source: input.source,
    platformId: input.platformId,
    title: input.title,
    artist: input.artist,
    album: input.album,
    durationMs: input.durationMs,
    coverUrl: input.coverUrl,
    grade: input.grade,
    classNo: input.classNo,
    requesterName: input.requesterName,
  };
  verifyAndConsumePow(context, ip);

  const result = await submitRequest(input, ip, getRequestHeader(event, 'user-agent') ?? undefined);
  return result;
});
