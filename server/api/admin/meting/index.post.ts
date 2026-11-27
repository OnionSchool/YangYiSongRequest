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
} from '../../../utils/music-sources';
import {
  parseProviderType,
  providerTypeFields,
  validCapabilities,
  validPlatforms,
} from '../../../utils/provider-config';
import { validateExternalUrl } from '../../../utils/external-url';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody(event);

  const type = parseProviderType(body.type);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rawBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const platforms = validPlatforms(
    body.platforms === undefined ? ['netease', 'qq', 'kugou'] : body.platforms
  );
  const enabled = body.enabled !== false;
  const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
  const capabilities = validCapabilities(
    body.capabilities === undefined ? METING_CAPABILITIES : body.capabilities
  );
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';

  if (!name) throw badRequest('BAD_NAME', '请填写名称');
  const templateFields = providerTypeFields(body as Record<string, unknown>, type);
  // 模板音源没有统一入口，baseUrl 允许留空；Meting 必须填。
  const baseUrl = rawBaseUrl || (type === 'template' ? '' : '');
  if (type === 'meting') {
    if (!baseUrl) throw badRequest('BAD_URL', '请填写 API 地址');
    let baseUrlHost: string;
    try {
      baseUrlHost = new URL(baseUrl).hostname;
    } catch {
      throw badRequest('BAD_URL', 'API 地址格式无效');
    }
    await validateExternalUrl(baseUrl, [baseUrlHost]);
  }
  if (platforms.length === 0) {
    throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
  }
  if (capabilities.length === 0) {
    throw badRequest('BAD_CAPABILITIES', '至少选择一个 API 功能');
  }
  if (authToken.length > 512) throw badRequest('BAD_AUTH_TOKEN', '鉴权密钥长度不能超过 512 个字符');

  const id = `${type}_${randomBytes(8).toString('hex')}`;
  await db.insert(metingApi).values({
    id,
    name,
    type,
    baseUrl,
    authToken: authToken || null,
    platforms: JSON.stringify(platforms),
    capabilities: JSON.stringify(capabilities),
    ...templateFields,
    enabled: enabled ? 1 : 0,
    sortOrder,
  });

  invalidateMusicSearchCache();
  await writeAudit(session.userId, 'meting.create', id, {
    name,
    type,
    baseUrl,
    platforms,
    capabilities,
    authConfigured: Boolean(authToken),
  });
  return { items: await listMetingApis() };
});
