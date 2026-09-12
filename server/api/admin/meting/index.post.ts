import { randomBytes } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest } from '../../../utils/errors';
import { writeAudit } from '../../../utils/audit';
import { db } from '../../../utils/db';
import { metingApi } from '../../../utils/schema';
import { listMetingApis } from '../../../utils/music-sources';

const VALID_PLATFORMS = ['netease', 'qq', 'kugou'];

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody(event);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const platforms = Array.isArray(body.platforms) ? body.platforms : VALID_PLATFORMS;
  const enabled = body.enabled !== false;
  const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;

  if (!name) throw badRequest('BAD_NAME', '请填写 API 名称');
  if (!baseUrl) throw badRequest('BAD_URL', '请填写 API 地址');
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw badRequest('BAD_URL', 'API 地址必须是 HTTP 或 HTTPS 地址');
  }

  const validPlatforms = platforms.filter(
    (p: unknown) => typeof p === 'string' && VALID_PLATFORMS.includes(p)
  );
  if (validPlatforms.length === 0) {
    throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
  }

  const id = `meting_${randomBytes(8).toString('hex')}`;
  await db.insert(metingApi).values({
    id,
    name,
    baseUrl,
    platforms: JSON.stringify(validPlatforms),
    enabled: enabled ? 1 : 0,
    sortOrder,
  });

  await writeAudit(session.userId, 'meting.create', id, { name, baseUrl });
  return { items: await listMetingApis() };
});
