import { db } from './db';
import { songRequest } from './schema';
import { withChatContext } from './chatContext';
import { shanghaiDayStart } from './time';
import { and, count, eq, gte } from 'drizzle-orm';

export interface LifecycleContext {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

export function runWithLifecycleContext<T>(context: LifecycleContext, callback: () => T): T {
  return withChatContext(context, callback);
}

/**
 * Track when the application started
 */
export const appStartedAt = shanghaiDayStart();

/**
 * Health check that caches the timestamp
 */
let appStartedCheck: { at: number; value: Date } | null = null;

export async function getHealth(): Promise<{ status: 'ok'; startedAt: string }> {
  if (appStartedCheck && Date.now() - appStartedCheck.at < 60_000) {
    return { status: 'ok', startedAt: appStartedCheck.value.toISOString() };
  }
  const value = appStartedAt;
  appStartedCheck = { at: Date.now(), value };
  return { status: 'ok', startedAt: value.toISOString() };
}

/**
 * Get a count of pending (PENDING) and scheduled (SCHEDULED/PLAYED) requests
 */
export async function getActiveRequestCounts(): Promise<{
  pending: number;
  scheduled: number;
}> {
  const since = Math.floor(shanghaiDayStart().getTime() / 1000);

  const [pendingRows, scheduledRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(songRequest)
      .where(and(eq(songRequest.status, 'PENDING'), gte(songRequest.createdAt, since))),
    db
      .select({ count: count() })
      .from(songRequest)
      .where(and(eq(songRequest.status, 'SCHEDULED'), gte(songRequest.createdAt, since))),
  ]);

  return {
    pending: Number((pendingRows[0] as any)?.count ?? 0),
    scheduled: Number((scheduledRows[0] as any)?.count ?? 0),
  };
}
