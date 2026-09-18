import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { deleteAdminUser } from '../../../utils/auth';
import { writeAudit } from '../../../utils/audit';
import { requireSuper } from '../../../utils/admin-auth';
import { AppError } from '../../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing id',
      message: '缺少用户ID',
    });
  }

  try {
    const deleted = deleteAdminUser(id, session.userId);
    await writeAudit(session.userId, 'user.delete', id, deleted);
    return { ok: true };
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
});
