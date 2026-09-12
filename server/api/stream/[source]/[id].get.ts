import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { fetchAudioUrl, isSourceId } from '../../../utils/music-sources';
import { fetchExternal } from '../../../utils/external-url';

const TIMEOUT_MS = 15_000;

export default defineEventHandler(async (event) => {
  const source = getRouterParam(event, 'source');
  const platformId = getRouterParam(event, 'id');
  if (!isSourceId(source) || !platformId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const audioUrl = await fetchAudioUrl(source, platformId);
  if (!audioUrl) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Audio unavailable',
      message: '音源未返回可播放链接',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const range = event.node.req.headers.range;
    const response = await fetchExternal(audioUrl, {
      signal: controller.signal,
      headers: range ? { range } : undefined,
    });
    if (!response.ok || !response.body) {
      throw createError({ statusCode: 502, statusMessage: 'Audio fetch failed' });
    }

    const passthroughHeaders = ['accept-ranges', 'content-range', 'content-length', 'content-type'];
    for (const header of passthroughHeaders) {
      const value = response.headers.get(header);
      if (value) setHeader(event, header, value);
    }
    setHeader(event, 'Cache-Control', 'no-store');
    event.node.res.statusCode = response.status;
    return response.body;
  } catch (error) {
    if ((error as { statusCode?: unknown })?.statusCode) throw error;
    throw createError({ statusCode: 502, statusMessage: 'Audio fetch failed' });
  } finally {
    clearTimeout(timer);
  }
});
