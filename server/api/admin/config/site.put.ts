import { defineEventHandler, readBody, setHeader } from 'h3';
import { db } from '../../../utils/db';
import { siteSetting } from '../../../utils/schema';
import { invalidateSiteCache } from '../../../utils/site';
import { writeAudit } from '../../../utils/audit';
import { encodeBool } from '../../../utils/domain';
import { requireSuper } from '../../../utils/admin-auth';
import { eq } from 'drizzle-orm';
import { badRequest } from '../../../utils/errors';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireSuper(event);

  const body = await readBody<unknown>(event);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw badRequest('BAD_SITE_CONFIG', '站点配置无效');

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
    if (body.announcement.length > 500)
      throw badRequest('BAD_ANNOUNCEMENT', '公告不能超过 500 个字符');
    updates.announcement = body.announcement;
  }
  if (typeof body.maxScheduleDays === 'number') {
    if (
      !Number.isInteger(body.maxScheduleDays) ||
      body.maxScheduleDays < 1 ||
      body.maxScheduleDays > 90
    )
      throw badRequest('BAD_MAX_SCHEDULE_DAYS', '排期天数必须是 1 到 90 的整数');
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
