import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { createAdminUser } from '../../../utils/auth';
import { writeAudit } from '../../../utils/audit';
import { requireSuper } from '../../../utils/admin-auth';
import { AppError } from '../../../utils/errors';

const MAX_BATCH = 100;

interface BatchItem {
  username: string;
  password: string;
  role: 'SUPER' | 'PLANNER' | 'TECHNICIAN';
  displayName?: string;
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);
  const { users } = await readBody(event);

  if (!Array.isArray(users) || users.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请提供用户列表',
    });
  }

  if (users.length > MAX_BATCH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `单次最多导入 ${MAX_BATCH} 个用户`,
    });
  }

  const results: Array<{ username: string; ok: boolean; message?: string }> = [];

  for (const item of users as BatchItem[]) {
    const username = String(item.username ?? '').trim();
    const password = String(item.password ?? '').trim();
    const role = item.role || 'PLANNER';
    const displayName = item.displayName?.trim() || undefined;

    if (!username || !password) {
      results.push({ username: username || '(空)', ok: false, message: '缺少账号或密码' });
      continue;
    }

    try {
      const id = await createAdminUser(username, password, role, displayName);
      await writeAudit(session.userId, 'user.create', id, {
        username,
        role,
        displayName,
        batch: true,
      });
      results.push({ username, ok: true });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : '创建失败';
      results.push({ username, ok: false, message });
    }
  }

  const success = results.filter((r) => r.ok).length;
  const failed = results.length - success;

  return { success, failed, results };
});
