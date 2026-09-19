import { defineEventHandler, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest, notFound } from '../../../utils/errors';
import { writeAudit } from '../../../utils/audit';
import { db } from '../../../utils/db';
import { metingApi } from '../../../utils/schema';
import { invalidateMusicSearchCache } from '../../../utils/music-sources';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const id = event.context.params?.id;
  if (!id) throw badRequest('BAD_ID', '缺少 ID');

  const existing = await db
    .select({ name: metingApi.name })
    .from(metingApi)
    .where(eq(metingApi.id, id))
    .limit(1);
  if (!existing[0]) throw notFound('NOT_FOUND', '未找到该 API 配置');
  await db.delete(metingApi).where(eq(metingApi.id, id));

  invalidateMusicSearchCache();
  await writeAudit(session.userId, 'meting.delete', id, { name: existing[0].name });
  return { ok: true as const };
});
