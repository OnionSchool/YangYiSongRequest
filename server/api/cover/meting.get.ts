import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { fetchCoverUrl } from '../../utils/music-sources';
import type { SourceId } from '../../utils/domain';
import { fetchExternal } from '../../utils/external-url';
import { readCachedCover, saveCachedCover } from '../../utils/cover-cache';

const TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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

  const cached = await readCachedCover(source, id, size);
  if (cached) {
    setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400');
    setHeader(event, 'Content-Type', cached.contentType);
    return cached.body;
  }

  const imageUrl = await fetchCoverUrl(source, id, size);
  if (!imageUrl) {
    throw createError({ statusCode: 404, statusMessage: 'Cover not found' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const imageHost = new URL(imageUrl).hostname;
    const imageRes = await fetchExternal(imageUrl, { signal: controller.signal }, [imageHost]);
    if (!imageRes.ok || !imageRes.body) {
      throw createError({ statusCode: 502, statusMessage: 'Image fetch failed' });
    }
    const contentLength = Number(imageRes.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw createError({ statusCode: 502, statusMessage: 'Image fetch failed' });
    }
    const reader = imageRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw createError({ statusCode: 502, statusMessage: 'Image fetch failed' });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const contentType = imageRes.headers.get('content-type') ?? 'image/jpeg';
    await saveCachedCover(source, id, size, { body, contentType });
    setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400');
    setHeader(event, 'Content-Type', contentType);
    return body;
  } catch (error) {
    if ((error as { statusCode?: unknown })?.statusCode) throw error;
    throw createError({ statusCode: 502, statusMessage: 'Cover proxy failed' });
  } finally {
    clearTimeout(timer);
  }
});
