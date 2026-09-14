import { defineEventHandler, readBody, setHeader } from 'h3';
import { db } from '../../../utils/db';
import { siteSetting } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';
import { encodeBool } from '../../../utils/domain';
import { requireSuper } from '../../../utils/admin-auth';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);

  const body = await readBody(event);

  const updates: any = {};
  if (typeof body.requestsOpen === 'boolean') {
    updates.requestsOpen = encodeBool(body.requestsOpen);
  }
  if (typeof body.guestPreviewOpen === 'boolean') {
    updates.guestPreviewOpen = encodeBool(body.guestPreviewOpen);
  }
  if (typeof body.requireIdentity === 'boolean') {
    updates.requireIdentity = encodeBool(body.requireIdentity);
  }
  if (typeof body.announcement === 'string') {
    updates.announcement = body.announcement;
  }
  if (typeof body.maxScheduleDays === 'number') {
    updates.maxScheduleDays = String(body.maxScheduleDays);
  }
  if (typeof body.forceChangePassword === 'boolean') {
    updates.forceChangePassword = encodeBool(body.forceChangePassword);
  }
  if (typeof body.requireEmailBind === 'boolean') {
    updates.requireEmailBind = encodeBool(body.requireEmailBind);
  }

  for (const [key, value] of Object.entries(updates)) {
    const existingCount = await db.select().from(siteSetting).where(eq(siteSetting.key, key));

    if (existingCount.length > 0) {
      await db
        .update(siteSetting)
        .set({ value: String(value) })
        .where(eq(siteSetting.key, key));
    } else {
      await db.insert(siteSetting).values({ key, value: String(value) });
    }
  }

  invalidateSiteCache();
  await writeAudit(session.userId, 'config.site', null, body);

  return { ok: true };
});
