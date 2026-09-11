import { eq } from 'drizzle-orm';
import { defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireSuper } from '../../../../utils/admin-auth';
import { db } from '../../../../utils/db';
import { systemAlert } from '../../../../utils/schema';

export default defineEventHandler(async (event) => {
  requireSuper(event);
  const id = getRouterParam(event, 'id')!;
  await db
    .update(systemAlert)
    .set({ resolvedAt: Math.floor(Date.now() / 1000) })
    .where(eq(systemAlert.id, id));
  setHeader(event, 'Cache-Control', 'no-store');
  return { ok: true };
});
