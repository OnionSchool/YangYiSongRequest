import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { createAdminUser } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { requireSuper } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);

  const { username, password, role } = await readBody(event);

  if (!username || !password || !role) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing fields',
      message: '缺少账号、密码或角色',
    });
  }

  const id = await createAdminUser(username, password, role);
  await writeAudit(session.userId, 'user.create', id, { username, role });

  return { id };
});
