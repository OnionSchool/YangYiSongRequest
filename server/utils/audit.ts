import { db } from './db';
import { auditLog } from './schema';
import { getChatContext, withChatContext } from './chatContext';
import { encodeDetail } from './domain';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'login.failed'
  | 'permission.denied'
  | 'password.change'
  | 'request.schedule'
  | 'request.reject'
  | 'request.manual'
  | 'schedule.reorder'
  | 'schedule.remove'
  | 'request.batch'
  | 'config.site'
  | 'config.slots'
  | 'config.calendar'
  | 'config.grades'
  | 'config.words'
  | 'user.create'
  | 'user.update'
  | 'source.login'
  | 'source.cookie'
  | 'source.clear';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
  return withChatContext(context, callback);
}

/**
 * Write an audit log entry. Log failures should not block the calling process.
 */
export async function writeAudit(
  actorId: string | null,
  action: AuditAction,
  targetId: string | null,
  detail?: unknown
): Promise<void> {
  try {
    const context = getChatContext();
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorId,
      action,
      targetId,
      detail: encodeDetail(detail),
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch {
    // Log failures should not side-effect the calling process
  }
}
