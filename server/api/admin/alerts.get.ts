import { desc, isNull } from 'drizzle-orm';
import { defineEventHandler, setHeader } from 'h3';
import { requireSuper } from '../../utils/admin-auth';
import { db } from '../../utils/db';
import { systemAlert } from '../../utils/schema';

export default defineEventHandler(async (event) => {
  requireSuper(event);
  setHeader(event, 'Cache-Control', 'no-store');
  const alerts = await db
    .select()
    .from(systemAlert)
    .where(isNull(systemAlert.resolvedAt))
    .orderBy(desc(systemAlert.createdAt))
    .limit(100);
  return alerts.map((alert) => ({
    id: alert.id,
    level: alert.level,
    message: alert.message,
    detail: alert.detail ? JSON.parse(alert.detail) : null,
    createdAt: new Date(alert.createdAt * 1000).toISOString(),
  }));
});
