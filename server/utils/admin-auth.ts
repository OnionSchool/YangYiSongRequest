import { createError, getCookie } from 'h3';
import type { H3Event } from 'h3';
import { verifyToken } from './auth';
import type { AdminSession } from './auth';

export const isDebugMode = () =>
  process.env.NODE_ENV !== 'production' && process.env.DEBUG_MODE === 'true';

export function getDebugSession(event: H3Event): AdminSession {
  const candidate = getCookie(event, 'debug_admin_role');
  const role = candidate === 'PLANNER' || candidate === 'TECHNICIAN' ? candidate : 'SUPER';
  return {
    userId: 'debug',
    username: 'debug',
    displayName: '调试用户',
    role,
    mustChangePassword: false,
    csrfToken: 'debug',
  };
}

/**
 * Extract and verify admin session from cookie. Throws 401 if not logged in.
 * In debug mode (DEBUG_MODE=true), returns a fake SUPER session without authentication.
 */
export function requireAuth(event: H3Event): AdminSession {
  if (isDebugMode()) return getDebugSession(event);

  const token = getCookie(event, 'admin_token');
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: '未登录' });
  }
  const session = verifyToken(token);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: '会话已过期，请重新登录',
    });
  }
  return session;
}

/**
 * Require SUPER role.
 */
export function requireSuper(event: H3Event): AdminSession {
  const session = requireAuth(event);
  if (session.role !== 'SUPER') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '需要超级管理员权限',
    });
  }
  return session;
}

export function requirePlanner(event: H3Event): AdminSession {
  const session = requireAuth(event);
  if (session.role !== 'SUPER' && session.role !== 'PLANNER') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '需要策划权限' });
  }
  return session;
}

export function requireTechnician(event: H3Event): AdminSession {
  const session = requireAuth(event);
  if (session.role !== 'SUPER' && session.role !== 'TECHNICIAN') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '需要技术员权限' });
  }
  return session;
}
