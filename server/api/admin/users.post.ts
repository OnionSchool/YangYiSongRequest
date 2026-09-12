import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { createAdminUser } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { requireSuper } from '../../utils/admin-auth';
import { AppError } from '../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);

  const { username, password, role, displayName } = await readBody(event);

  if (!username || !password || !role) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing fields',
      message: '缺少账号、密码或角色',
    });
  }

  let id: string;
  try {
    id = await createAdminUser(username, password, role, displayName);
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
  await writeAudit(session.userId, 'user.create', id, { username, role, displayName });

  return { id };
});
