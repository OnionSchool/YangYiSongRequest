import { createError, defineEventHandler, getCookie } from 'h3';
import { isDebugMode } from '../utils/admin-auth';
import { verifyToken } from '../utils/auth';
import { readSite } from '../utils/site';

const COMPLETION_PATHS = new Set([
  '/api/admin/me',
  '/api/admin/logout',
  '/api/admin/password',
  '/api/admin/email/send-code',
  '/api/admin/email/verify',
]);

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/admin/') || COMPLETION_PATHS.has(event.path) || isDebugMode()) {
    return;
  }
  const token = getCookie(event, 'admin_token');
  const session = token ? verifyToken(token) : null;
  if (!session) return;

  const site = await readSite();
  if (site.forceChangePassword && session.mustChangePassword) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '请先修改初始密码' });
  }
  if (site.requireEmailBind && !session.emailVerified) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '请先绑定并验证邮箱',
    });
  }
});
