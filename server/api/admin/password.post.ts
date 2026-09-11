import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { changePassword } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { requireAuth } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireAuth(event);

  const { current, next } = await readBody(event);

  if (!current || !next) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing passwords',
      message: '缺少当前密码或新密码',
    });
  }

  await changePassword(session.userId, current, next);
  await writeAudit(session.userId, 'password.change', null);

  return { ok: true };
});
