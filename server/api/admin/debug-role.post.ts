import { createError, defineEventHandler, readBody, setCookie, setHeader } from 'h3';
import { isDebugMode } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  if (!isDebugMode()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  const { role } = await readBody<{ role?: string }>(event);
  if (role !== 'SUPER' && role !== 'PLANNER' && role !== 'TECHNICIAN') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '无效的管理员角色',
    });
  }

  setCookie(event, 'debug_admin_role', role, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  return {
    username: 'debug',
    role,
    mustChangePassword: false,
    csrfToken: 'debug',
    debugMode: true,
  };
});
