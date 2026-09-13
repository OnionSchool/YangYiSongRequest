import { createHmac } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest } from '../../../utils/errors';
import { fetchExternal, validateExternalUrl } from '../../../utils/external-url';

const VALID_PLATFORMS = ['netease', 'qq', 'kugou'] as const;
const TIMEOUT_MS = 10_000;

type SourceId = (typeof VALID_PLATFORMS)[number];

function toMetingServer(source: SourceId): string {
  return source === 'qq' ? 'tencent' : source;
}

async function validateBaseUrl(value: unknown): Promise<{ baseUrl: string; host: string }> {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('BAD_URL', '请填写 API 地址');
  }
  const baseUrl = value.trim();
  const host = new URL(baseUrl).hostname;
  await validateExternalUrl(baseUrl, [host]);
  return { baseUrl: baseUrl.replace(/\/+$/, ''), host };
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const body = await readBody<{
    baseUrl?: unknown;
    authToken?: unknown;
    platforms?: unknown;
    capabilities?: unknown;
  }>(event);
  const { baseUrl, host } = await validateBaseUrl(body.baseUrl);
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';
  if (authToken.length > 512) throw badRequest('BAD_AUTH_TOKEN', '鉴权密钥长度不能超过 512 个字符');
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter(
        (platform): platform is SourceId =>
          typeof platform === 'string' && VALID_PLATFORMS.includes(platform as SourceId)
      )
    : [];
  if (platforms.length === 0) throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
  if (Array.isArray(body.capabilities) && !body.capabilities.includes('search')) {
    throw badRequest('SEARCH_DISABLED', '测试 API 需要启用“搜索歌曲”功能');
  }

  return {
    results: await Promise.all(
      platforms.map(async (source) => {
        const url = new URL(baseUrl);
        const server = toMetingServer(source);
        url.search = new URLSearchParams({
          ...Object.fromEntries(url.searchParams),
          server,
          type: 'search',
          id: '周杰伦',
          limit: '1',
          page: '1',
        }).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const response = await fetchExternal(
            url,
            {
              signal: controller.signal,
            },
            [host]
          );
          const text = await response.text();
          if (!response.ok) {
            return { source, ok: false, detail: `HTTP ${response.status}` };
          }
          try {
            const data = JSON.parse(text) as unknown;
            const count = Array.isArray(data) ? data.length : 0;
            const first = Array.isArray(data)
              ? (data[0] as { id?: unknown; url_id?: unknown } | undefined)
              : undefined;
            const id = first?.id ?? first?.url_id;
            if (authToken && id != null) {
              const authUrl = new URL(baseUrl);
              authUrl.search = new URLSearchParams({
                ...Object.fromEntries(authUrl.searchParams),
                server,
                type: 'url',
                id: String(id),
                br: '320',
                auth: createHmac('sha1', authToken).update(`${server}url${id}`).digest('hex'),
              }).toString();
              const authResponse = await fetchExternal(authUrl, { signal: controller.signal }, [
                host,
              ]);
              if (!authResponse.ok) {
                return { source, ok: false, detail: `鉴权请求 HTTP ${authResponse.status}` };
              }
            }
            return {
              source,
              ok: true,
              detail:
                count > 0
                  ? `搜索正常（返回 ${count} 条）${authToken ? '，鉴权正常' : ''}`
                  : '请求正常，但未返回搜索结果',
            };
          } catch {
            return { source, ok: false, detail: '接口未返回有效的 JSON 搜索结果' };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '请求失败';
          return { source, ok: false, detail: message };
        } finally {
          clearTimeout(timer);
        }
      })
    ),
  };
});
