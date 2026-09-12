import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { fetchCoverUrl } from '../../utils/music-sources';
import type { SourceId } from '../../utils/domain';

const TIMEOUT_MS = 8_000;
const SOURCE_BY_SERVER: Record<string, SourceId> = {
  netease: 'netease',
  tencent: 'qq',
  kugou: 'kugou',
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const server = typeof query.server === 'string' ? query.server : '';
  const id = typeof query.id === 'string' ? query.id : '';
  const size = typeof query.size === 'string' ? query.size : '300';
  const source = SOURCE_BY_SERVER[server];

  if (!source || !id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const imageUrl = await fetchCoverUrl(source, id, size);
  if (!imageUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Cover not found' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const imageRes = await fetch(imageUrl, { signal: controller.signal });
    if (!imageRes.ok || !imageRes.body) {
      throw createError({ statusCode: 502, statusMessage: 'Image fetch failed' });
    }
    setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400');
    setHeader(event, 'Content-Type', imageRes.headers.get('content-type') ?? 'image/jpeg');
    return imageRes.body;
  } catch (error) {
    if ((error as { statusCode?: unknown })?.statusCode) throw error;
    throw createError({ statusCode: 502, statusMessage: 'Cover proxy failed' });
  } finally {
    clearTimeout(timer);
  }
});
