import { createError, defineEventHandler, getCookie, getRequestHeader, getRequestURL } from 'h3';
import { getDebugSession, isDebugMode } from '../utils/admin-auth';
import { verifyToken } from '../utils/auth';

export default defineEventHandler((event) => {
  if (
    !event.path.startsWith('/api/admin/') ||
    event.path === '/api/admin/login' ||
    event.path === '/api/admin/password/reset/request' ||
    event.path === '/api/admin/password/reset/confirm' ||
    ['GET', 'HEAD', 'OPTIONS'].includes(event.method)
  )
    return;
  const origin = getRequestHeader(event, 'origin');
  if (!origin || origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '请求来源无效' });
  }
  const session = isDebugMode()
    ? getDebugSession(event)
    : (() => {
        const token = getCookie(event, 'admin_token');
        return token ? verifyToken(token) : null;
      })();
  if (!session || getRequestHeader(event, 'x-csrf-token') !== session.csrfToken) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'CSRF 校验失败' });
  }
});
