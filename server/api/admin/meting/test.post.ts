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

  const body = await readBody<{ baseUrl?: unknown; platforms?: unknown; capabilities?: unknown }>(
    event
  );
  const { baseUrl, host } = await validateBaseUrl(body.baseUrl);
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
        const params = new URLSearchParams({
          server: toMetingServer(source),
          type: 'search',
          id: '周杰伦',
          limit: '1',
          page: '1',
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const response = await fetchExternal(
            `${baseUrl}?${params}`,
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
            return {
              source,
              ok: true,
              detail: count > 0 ? `搜索正常（返回 ${count} 条）` : '请求正常，但未返回搜索结果',
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
