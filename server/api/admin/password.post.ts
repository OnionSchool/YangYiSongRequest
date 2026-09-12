import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { changePassword } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { requireAuth } from '../../utils/admin-auth';
import { AppError } from '../../utils/errors';

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

  try {
    await changePassword(session.userId, current, next);
  } catch (error) {
    if (error instanceof AppError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Bad Request',
        message: error.message,
        data: { code: error.code, detail: error.detail },
      });
    }
    throw error;
  }
  await writeAudit(session.userId, 'password.change', null);

  return { ok: true };
});
