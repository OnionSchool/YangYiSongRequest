import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  readBody,
  setHeader,
} from 'h3';
import { setAuditContext, writeAudit } from '../../../../utils/audit';
import { confirmPasswordReset } from '../../../../utils/password-reset';
import { badRequest } from '../../../../utils/errors';
import { getClientIp } from '../../../../utils/request-ip';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const origin = getRequestHeader(event, 'origin');
  if (!origin || origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '请求来源无效' });
  }
  const body = await readBody(event);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const next = typeof body?.next === 'string' ? body.next : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
    throw badRequest('INVALID_USERNAME', '请输入有效的账号');
  }

  setAuditContext({
    ip: getClientIp(event),
    userAgent: getRequestHeader(event, 'user-agent') ?? undefined,
  });
  const userId = await confirmPasswordReset(username, code, next);
  await writeAudit(userId, 'password.reset', null, { method: 'email' });
  return { ok: true };
});
