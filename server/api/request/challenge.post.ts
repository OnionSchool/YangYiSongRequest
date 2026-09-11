import { defineEventHandler, readBody, setHeader } from 'h3';
import { getClientIp } from '../../utils/request-ip';
import { createPowChallenge } from '../../utils/request-protection';
import { badRequest } from '../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const body = await readBody(event);
  if (typeof body?.contextHash !== 'string')
    throw badRequest('BAD_CHALLENGE_CONTEXT', '提交信息无效');
  return createPowChallenge(body.contextHash, getClientIp(event));
});
