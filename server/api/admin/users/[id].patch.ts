import { createError, defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { updateAdminUser } from '../../../utils/auth';
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

  const body = await readBody<{
    role?: 'SUPER' | 'PLANNER' | 'TECHNICIAN';
    disabled?: boolean;
    password?: string;
    displayName?: string | null;
  }>(event);
  const updates = {
    role: body.role,
    disabled: body.disabled,
    password: body.password,
    displayName: body.displayName,
  };
  try {
    await updateAdminUser(id, updates);
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
  await writeAudit(session.userId, 'user.update', id, {
    role: updates.role,
    disabled: updates.disabled,
    displayName: updates.displayName,
    passwordChanged: Boolean(updates.password),
  });

  return { ok: true };
});
