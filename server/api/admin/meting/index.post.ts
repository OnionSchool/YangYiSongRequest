import { randomBytes } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest } from '../../../utils/errors';
import { writeAudit } from '../../../utils/audit';
import { db } from '../../../utils/db';
import { metingApi } from '../../../utils/schema';
import {
  invalidateMusicSearchCache,
  listMetingApis,
  METING_CAPABILITIES,
  type MetingCapability,
} from '../../../utils/music-sources';
import { validateExternalUrl } from '../../../utils/external-url';

const VALID_PLATFORMS = ['netease', 'qq', 'kugou'];

function validCapabilities(value: unknown): MetingCapability[] {
  if (!Array.isArray(value)) return [...METING_CAPABILITIES];
  return [...new Set(value)].filter(
    (capability): capability is MetingCapability =>
      typeof capability === 'string' && METING_CAPABILITIES.includes(capability as MetingCapability)
  );
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody(event);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const platforms = Array.isArray(body.platforms) ? body.platforms : VALID_PLATFORMS;
  const enabled = body.enabled !== false;
  const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
  const capabilities = validCapabilities(body.capabilities);
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';

  if (!name) throw badRequest('BAD_NAME', '请填写 API 名称');
  if (!baseUrl) throw badRequest('BAD_URL', '请填写 API 地址');
  const baseUrlHost = new URL(baseUrl).hostname;
  await validateExternalUrl(baseUrl, [baseUrlHost]);

  const validPlatforms = platforms.filter(
    (p: unknown) => typeof p === 'string' && VALID_PLATFORMS.includes(p)
  );
  if (validPlatforms.length === 0) {
    throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
  }
  if (capabilities.length === 0) {
    throw badRequest('BAD_CAPABILITIES', '至少选择一个 API 功能');
  }
  if (authToken.length > 512) throw badRequest('BAD_AUTH_TOKEN', '鉴权密钥长度不能超过 512 个字符');

  const id = `meting_${randomBytes(8).toString('hex')}`;
  await db.insert(metingApi).values({
    id,
    name,
    baseUrl,
    authToken: authToken || null,
    platforms: JSON.stringify(validPlatforms),
    capabilities: JSON.stringify(capabilities),
    enabled: enabled ? 1 : 0,
    sortOrder,
  });

  invalidateMusicSearchCache();
  await writeAudit(session.userId, 'meting.create', id, {
    name,
    baseUrl,
    capabilities,
    authConfigured: Boolean(authToken),
  });
  return { items: await listMetingApis() };
});
