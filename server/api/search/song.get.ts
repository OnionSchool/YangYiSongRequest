import { createError, defineEventHandler, getQuery } from 'h3';
import { isSourceId, searchSongs } from '../../utils/music-sources';

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
      message: 'source 必须是 netease、qq 或 kugou',
    });
  }
  if (!keyword) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing keyword',
      message: '缺少 keyword 参数',
    });
  }

  try {
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
