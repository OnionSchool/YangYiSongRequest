import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { isSourceId, searchSongs } from '../../utils/music-sources';
import { getClientIp } from '../../utils/request-ip';
import { consumePublicRateLimit } from '../../utils/public-rate-limit';
import { SEARCH_RATE_LIMIT } from '../../utils/rate-limits';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const source = query.source;
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  const rawPage = typeof query.page === 'string' ? Number.parseInt(query.page, 10) : 1;
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(rawPage, 20)) : 1;

  if (!isSourceId(source)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid source',
      message: 'source 必须是 netease、qq 或 kugou（通过 Meting API）',
    });
  }
  if (!keyword) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing keyword',
      message: '缺少 keyword 参数',
    });
  }
  if (keyword.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid keyword',
      message: 'keyword 不能超过 100 个字符',
    });
  }

  consumePublicRateLimit('search', getClientIp(event), SEARCH_RATE_LIMIT.max, 60);

  try {
    // Keep a short private browser cache; shared server caching protects Meting APIs.
    setHeader(event, 'Cache-Control', 'private, max-age=7200');
    return await searchSongs(source, keyword, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw createError({
      statusCode: 502,
      statusMessage: 'Music search failed',
      message: `搜索失败：${message}`,
    });
  }
});
