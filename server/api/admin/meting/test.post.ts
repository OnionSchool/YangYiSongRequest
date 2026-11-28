import { createHmac } from 'node:crypto';
import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { badRequest } from '../../../utils/errors';
import { fetchExternal, validateExternalUrl } from '../../../utils/external-url';
import type { SourceId } from '../../../utils/domain';
import {
  audioUrlPaths,
  extractSongRecords,
  mapSongRecord,
  parseFieldMap,
  readField,
  renderTemplate,
} from '../../../utils/music-templates';
import { parseLooseJson } from '../../../utils/music-sources';
import {
  parseProviderType,
  parseProviderTemplate,
  validPlatforms,
} from '../../../utils/provider-config';

const TIMEOUT_MS = 10_000;

async function validateBaseUrl(value: unknown): Promise<{ baseUrl: string; host: string }> {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('BAD_URL', '请填写 API 地址');
  }
  const baseUrl = value.trim();
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw badRequest('BAD_URL', 'API 地址格式无效');
  }
  await validateExternalUrl(baseUrl, [host]);
  return { baseUrl: baseUrl.replace(/\/+$/, ''), host };
}

/** 用模板音源做一次真实搜索，验证 URL 模板与字段映射是否匹配。 */
async function testTemplate(body: Record<string, unknown>) {
  const parsed = parseProviderTemplate(body);
  if (parsed.searchUrlTemplate) {
    return testTemplateSearch(parsed);
  }
  if (parsed.audioUrlTemplate) {
    return testTemplateAudio(parsed);
  }
  throw badRequest('BAD_TEMPLATE', '测试模板音源需要填写搜索或音频地址模板');
}

/** 音频模板测试：端点分两类——302 跳 CDN 的重定向型，或返回 JSON 的解析型。 */
async function testTemplateAudio(parsed: {
  audioUrlTemplate: string | null;
  fieldMap: string | null;
}) {
  // 音频模板需要真实平台 id，但管理员手上未必有；用酷我花海这个公开 id 探测，
  // 只能说明端点活着，是否适配其他平台还得靠实际播放验证。
  const target = renderTemplate(parsed.audioUrlTemplate as string, { id: '474678847' });
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    throw badRequest('BAD_TEMPLATE', '音频地址模板渲染后不是有效 URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, { signal: controller.signal }, [host]);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    try {
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        return { ok: true as const, detail: '重定向型端点正常（302 跳音频 CDN）' };
      }
      if (!response.ok) {
        return { ok: false as const, detail: `HTTP ${response.status}` };
      }
      if (contentType.startsWith('audio/')) {
        return { ok: true as const, detail: '直链型端点正常（直接返回音频流）' };
      }
      if (contentType.includes('json')) {
        const text = await response.text();
        const data = parseLooseJson(text);
        const paths = audioUrlPaths(parseFieldMap(parsed.fieldMap));
        for (const path of paths) {
          const value = readField(data, path);
          if (typeof value === 'string' && /^https?:\/\//.test(value)) {
            return { ok: true as const, detail: `JSON 型端点正常（${path} 提取到链接）` };
          }
        }
        return { ok: false as const, detail: 'JSON 里未找到音频链接，请检查字段映射' };
      }
      return { ok: false as const, detail: `响应类型不支持（${contentType || '未知'}）` };
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  } catch (error) {
    return { ok: false as const, detail: error instanceof Error ? error.message : '请求失败' };
  } finally {
    clearTimeout(timer);
  }
}

/** 搜索模板测试：验证 URL 模板与字段映射能从真实响应里解析出歌曲。 */
async function testTemplateSearch(parsed: {
  searchUrlTemplate: string | null;
  fieldMap: string | null;
}) {
  const map = parseFieldMap(parsed.fieldMap);
  // 与线上 templateSearch 保持一致：服务端分页占位符 ${page0}/${offset} 也要注入，
  // 否则占位符原样留在 URL 里（如 offset=${offset}），上游接口直接返回空结果。
  const target = renderTemplate(parsed.searchUrlTemplate as string, {
    keyword: '周杰伦',
    page: 1,
    page0: 0,
    offset: 0,
  });
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    throw badRequest('BAD_TEMPLATE', '搜索地址模板渲染后不是有效 URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, { signal: controller.signal }, [host]);
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false as const, detail: `HTTP ${response.status}` };
    }
    const text = await response.text();
    let data: unknown;
    try {
      // 酷我等音源返回单引号伪 JSON，与线上路径保持一致用宽容解析。
      data = parseLooseJson(text);
    } catch {
      return { ok: false as const, detail: '接口未返回有效的 JSON' };
    }
    const records = extractSongRecords(data as never, map);
    const songs = records
      .map((record) => mapSongRecord(record as never, map))
      .filter((song) => song !== null);
    if (songs.length === 0) {
      return { ok: false as const, detail: '未解析出歌曲，请检查字段映射' };
    }
    return {
      ok: true as const,
      detail: `解析正常（${songs.length} 条，首条：${songs[0]!.title || '未知歌曲'}）`,
    };
  } catch (error) {
    return { ok: false as const, detail: error instanceof Error ? error.message : '请求失败' };
  } finally {
    clearTimeout(timer);
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requireSuper(event);

  const body = await readBody<Record<string, unknown>>(event);
  const type = parseProviderType(body.type);

  if (type === 'template') {
    const result = await testTemplate(body);
    return {
      results: validPlatforms(body.platforms).map((source) => ({ source, ...result })),
    };
  }

  const { baseUrl, host } = await validateBaseUrl(body.baseUrl);
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';
  if (authToken.length > 512) throw badRequest('BAD_AUTH_TOKEN', '鉴权密钥长度不能超过 512 个字符');
  const platforms = validPlatforms(body.platforms);
  if (platforms.length === 0) throw badRequest('BAD_PLATFORMS', '至少选择一个支持的平台');
  if (Array.isArray(body.capabilities) && !body.capabilities.includes('search')) {
    throw badRequest('SEARCH_DISABLED', '测试 API 需要启用“搜索歌曲”功能');
  }

  return {
    results: await Promise.all(
      platforms.map(async (source: SourceId) => {
        // validateBaseUrl 已经解析过一次，这里再解析失败属于配置被改写，直接报 400。
        let url: URL;
        try {
          url = new URL(baseUrl);
        } catch {
          return { source, ok: false, detail: 'API 地址格式无效' };
        }
        const server = source === 'qq' ? 'tencent' : source;
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
          const response = await fetchExternal(url, { signal: controller.signal }, [host]);
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
              await authResponse.body?.cancel();
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
