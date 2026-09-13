import { db, sqlite } from './db';
import { auditLog } from './schema';
import { enterChatContext, getChatContext, withChatContext } from './chatContext';
import { encodeDetail } from './domain';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'login.failed'
  | 'permission.denied'
  | 'password.change'
  | 'password.reset'
  | 'request.schedule'
  | 'request.reject'
  | 'request.manual'
  | 'schedule.reorder'
  | 'schedule.remove'
  | 'request.batch'
  | 'request.playback'
  | 'config.site'
  | 'config.slots'
  | 'config.schedule-rules'
  | 'config.calendar'
  | 'config.grades'
  | 'config.words'
  | 'config.downloads'
  | 'user.create'
  | 'user.update'
  | 'source.login'
  | 'source.cookie'
  | 'source.clear'
  | 'meting.create'
  | 'meting.update'
  | 'meting.delete'
  | 'email.bind';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
  return withChatContext(context, callback);
}

export function setAuditContext(context: AuditContext): void {
  enterChatContext(context);
}

/**
 * Write an audit log entry. Log failures should not block the calling process.
 */
export const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

export function cleanupAuditLogs(): void {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - AUDIT_RETENTION_SECONDS;
    sqlite.prepare('DELETE FROM "AuditLog" WHERE "createdAt" < ?').run(cutoff);
  } catch {
    // Retention cleanup must not prevent the application from starting.
  }
}

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
