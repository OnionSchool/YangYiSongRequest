import { defineEventHandler, readBody, setHeader } from 'h3';
import { eq } from 'drizzle-orm';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest, notFound } from '../../../utils/errors';
import { writeAudit } from '../../../utils/audit';
import { db } from '../../../utils/db';
import { metingApi } from '../../../utils/schema';
import { invalidateMusicSearchCache, listMetingApis } from '../../../utils/music-sources';
import {
  parseProviderTemplate,
  parseProviderType,
  validCapabilities,
  validPlatforms,
} from '../../../utils/provider-config';
import { validateExternalUrl } from '../../../utils/external-url';

/** 只把请求里出现过的模板键写回，避免部分更新抹掉其它模板。 */
const TEMPLATE_KEYS = [
  'searchUrlTemplate',
  'detailUrlTemplate',
  'audioUrlTemplate',
  'coverUrlTemplate',
  'fieldMap',
] as const;

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const id = event.context.params?.id;
  if (!id) throw badRequest('BAD_ID', '缺少 ID');

  const existing = await db.select().from(metingApi).where(eq(metingApi.id, id)).limit(1);
  if (!existing[0]) throw notFound('NOT_FOUND', '未找到该音源配置');

  const body = await readBody(event);
  const updates: Record<string, unknown> = {};

  const type =
    body.type === undefined ? parseProviderType(existing[0].type) : parseProviderType(body.type);
  if (body.type !== undefined) updates.type = type;

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) throw badRequest('BAD_NAME', '请填写名称');
    updates.name = name;
  }
  if (typeof body.baseUrl === 'string') {
    const baseUrl = body.baseUrl.trim();
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
    updates.baseUrl = baseUrl;
  }
  if (typeof body.authToken === 'string') {
    const authToken = body.authToken.trim();
    if (authToken.length > 512) {
      throw badRequest('BAD_AUTH_TOKEN', '鉴权密钥长度不能超过 512 个字符');
    }
    if (authToken) updates.authToken = authToken;
  }
  if (Array.isArray(body.platforms)) {
    const platforms = validPlatforms(body.platforms);
    if (platforms.length === 0) {
      throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
    }
    updates.platforms = JSON.stringify(platforms);
  }
  if (Array.isArray(body.capabilities)) {
    const capabilities = validCapabilities(body.capabilities);
    if (capabilities.length === 0) {
      throw badRequest('BAD_CAPABILITIES', '至少选择一个 API 功能');
    }
    updates.capabilities = JSON.stringify(capabilities);
  }
  // 模板字段只在本次请求真的带了其中任一键时才重新校验，否则保留数据库里的值。
  if (TEMPLATE_KEYS.some((key) => body[key] !== undefined) || body.metadataCapable !== undefined) {
    const parsed = parseProviderTemplate(body);
    const nextSearch = parsed.searchUrlTemplate ?? existing[0].searchUrlTemplate;
    if (type === 'template' && !nextSearch) {
      throw badRequest('BAD_TEMPLATE', '模板音源必须填写搜索地址模板');
    }
    for (const key of TEMPLATE_KEYS) {
      if (body[key] !== undefined) updates[key] = parsed[key];
    }
    if (body.metadataCapable !== undefined) {
      updates.metadataCapable = parsed.metadataCapable ? 1 : 0;
    }
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

  const { authToken: _authToken, ...auditUpdates } = updates;
  await writeAudit(session.userId, 'meting.update', id, {
    ...auditUpdates,
    authConfigured: typeof _authToken === 'string' || undefined,
  });
  return { items: await listMetingApis() };
});
