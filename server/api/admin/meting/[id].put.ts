import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest, notFound } from '../../../utils/errors';
import { writeAudit } from '../../../utils/audit';
import { db } from '../../../utils/db';
import { metingApi } from '../../../utils/schema';
import { invalidateMusicSearchCache, listMetingApis } from '../../../utils/music-sources';

const VALID_PLATFORMS = ['netease', 'qq', 'kugou'];

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const id = event.context.params?.id;
  if (!id) throw badRequest('BAD_ID', '缺少 ID');

  const existing = await db.select().from(metingApi).where(eq(metingApi.id, id)).limit(1);
  if (!existing[0]) throw notFound('NOT_FOUND', '未找到该 API 配置');

  const body = await readBody(event);
  const updates: Record<string, unknown> = {};

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) throw badRequest('BAD_NAME', '请填写 API 名称');
    updates.name = name;
  }
  if (typeof body.baseUrl === 'string') {
    const baseUrl = body.baseUrl.trim();
    if (!baseUrl) throw badRequest('BAD_URL', '请填写 API 地址');
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw badRequest('BAD_URL', 'API 地址必须是 HTTP 或 HTTPS 地址');
    }
    updates.baseUrl = baseUrl;
  }
  if (Array.isArray(body.platforms)) {
    const validPlatforms = body.platforms.filter(
      (p: unknown) => typeof p === 'string' && VALID_PLATFORMS.includes(p)
    );
    if (validPlatforms.length === 0) {
      throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
    }
    updates.platforms = JSON.stringify(validPlatforms);
  }
  if (typeof body.enabled === 'boolean') {
    updates.enabled = body.enabled ? 1 : 0;
  }
  if (typeof body.sortOrder === 'number') {
    updates.sortOrder = body.sortOrder;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(metingApi).set(updates).where(eq(metingApi.id, id));
    invalidateMusicSearchCache();
  }

  await writeAudit(session.userId, 'meting.update', id, updates);
  return { items: await listMetingApis() };
});
