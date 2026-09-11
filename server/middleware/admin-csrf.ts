import { createError, getCookie, getRequestHeader, getRequestURL } from 'h3';
import { verifyToken } from '../utils/auth';

export default defineEventHandler((event) => {
  if (
    !event.path.startsWith('/api/admin/') ||
    event.path === '/api/admin/login' ||
    ['GET', 'HEAD', 'OPTIONS'].includes(event.method)
  )
    return;
  const origin = getRequestHeader(event, 'origin');
  if (!origin || origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '请求来源无效' });
  }
  const token = getCookie(event, 'admin_token');
  const session = token ? verifyToken(token) : null;
  if (!session || getRequestHeader(event, 'x-csrf-token') !== session.csrfToken) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'CSRF 校验失败' });
  }
});
