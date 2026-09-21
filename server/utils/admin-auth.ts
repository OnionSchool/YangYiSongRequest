import { createError, getCookie, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { verifyToken } from './auth';
import type { AdminSession } from './auth';
import { setAuditContext } from './audit';
import { getClientIp } from './request-ip';
import { resolveAdminPermissions, type AdminPermission } from './domain';

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
    permissions: resolveAdminPermissions(role, '{}'),
    mustChangePassword: false,
    email: null,
    emailVerified: false,
    csrfToken: 'debug',
  };
}

export function requirePermission(event: H3Event, permission: AdminPermission): AdminSession {
  const session = requireAuth(event);
  if (session.role !== 'SUPER' && !session.permissions.includes(permission)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '没有此项操作权限' });
  }
  return session;
}

/**
 * Extract and verify admin session from cookie. Throws 401 if not logged in.
 * In debug mode (DEBUG_MODE=true), returns a fake SUPER session without authentication.
 */
export function requireAuth(event: H3Event): AdminSession {
  setAuditContext({
    ip: getClientIp(event),
    userAgent: getRequestHeader(event, 'user-agent') ?? undefined,
  });
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
  const permission = permissionForPath(event.path);
  if (permission && session.role !== 'SUPER' && !session.permissions.includes(permission)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '没有此项操作权限' });
  }
  return session;
}

function permissionForPath(path: string): AdminPermission | null {
  if (path === '/api/admin/audit') return 'audit.read';
  if (path === '/api/admin/request-records') return 'records.read';
  if (path === '/api/admin/object-storage') return 'storage.read';
  if (path.startsWith('/api/admin/alerts')) return 'alerts.manage';
  if (path.startsWith('/api/admin/users')) return 'users.manage';
  if (path.startsWith('/api/admin/meting') || path === '/api/admin/sources/health')
    return 'sources.manage';
  if (path.startsWith('/api/admin/download/')) return 'downloads.read';
  if (path === '/api/admin/config/downloads') return 'playback.manage';
  if (
    path.startsWith('/api/admin/config/calendar') ||
    path.startsWith('/api/admin/config/slots') ||
    path.startsWith('/api/admin/config/schedule-rules')
  )
    return 'calendar.manage';
  if (path.startsWith('/api/admin/config/')) return 'site.manage';
  if (path === '/api/admin/schedule/reorder') return 'schedule.manage';
  if (/^\/api\/admin\/schedule\/[^/]+$/.test(path)) return 'schedule.read';
  if (path.startsWith('/api/admin/requests/')) {
    if (path.endsWith('/playback')) return 'playback.manage';
    if (path.endsWith('/schedule') || path.endsWith('/unschedule')) return 'schedule.manage';
    return 'requests.review';
  }
  if (path === '/api/admin/requests') return 'requests.review';
  return null;
}

/**
 * Require SUPER role.
 */
export function requireSuper(event: H3Event): AdminSession {
  const session = requireAuth(event);
  if (
    session.role !== 'SUPER' &&
    !session.permissions.includes(permissionForPath(event.path) ?? 'users.manage')
  ) {
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
  const permission = permissionForPath(event.path);
  if (
    session.role !== 'SUPER' &&
    session.role !== 'PLANNER' &&
    (!permission || !session.permissions.includes(permission))
  ) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '需要策划权限' });
  }
  return session;
}

export function requireTechnician(event: H3Event): AdminSession {
  const session = requireAuth(event);
  const permission = permissionForPath(event.path);
  if (
    session.role !== 'SUPER' &&
    session.role !== 'TECHNICIAN' &&
    (!permission || !session.permissions.includes(permission))
  ) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: '需要技术员权限' });
  }
  return session;
}
