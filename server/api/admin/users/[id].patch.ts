import { createError, defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { updateAdminUser } from '../../../utils/auth';
import { writeAudit } from '../../../utils/audit';
import { requireSuper } from '../../../utils/admin-auth';

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

  const body = await readBody(event);
  await updateAdminUser(id, body);
  await writeAudit(session.userId, 'user.update', id, body);

  return { ok: true };
});
