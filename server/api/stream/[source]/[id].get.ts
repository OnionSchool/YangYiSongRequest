import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { fetchAudioUrl, isSourceId } from '../../../utils/music-sources';
import { fetchExternal } from '../../../utils/external-url';
import { getClientIp } from '../../../utils/request-ip';
import { consumePublicRateLimit } from '../../../utils/public-rate-limit';
import { STREAM_RATE_LIMIT } from '../../../utils/rate-limits';
import { readSite } from '../../../utils/site';

const CONNECTION_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_STREAMS_PER_IP = 3;
const activeStreams = new Map<string, number>();

function acquireStream(ip: string): () => void {
  const active = activeStreams.get(ip) ?? 0;
  if (active >= MAX_CONCURRENT_STREAMS_PER_IP) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: '同时播放的音频过多，请稍后再试',
    });
  }
  activeStreams.set(ip, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = activeStreams.get(ip) ?? 0;
    if (current <= 1) activeStreams.delete(ip);
    else activeStreams.set(ip, current - 1);
  };
}

export default defineEventHandler(async (event) => {
  if (!(await readSite()).guestPreviewOpen) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '访客试听功能已关闭',
    });
  }
  const source = getRouterParam(event, 'source');
  const platformId = getRouterParam(event, 'id');
  if (!isSourceId(source) || !platformId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  if (platformId.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: '歌曲 ID 无效' });
  }

  const ip = getClientIp(event);
  consumePublicRateLimit('stream', ip, STREAM_RATE_LIMIT.max, 60);

  const audioUrl = await fetchAudioUrl(source, platformId);
  if (!audioUrl) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Audio unavailable',
      message: '音源未返回可播放链接',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
  const release = acquireStream(ip);
  try {
    const range = event.node.req.headers.range;
    const response = await fetchExternal(
      audioUrl,
      {
        signal: controller.signal,
        headers: range ? { range } : undefined,
      },
      [new URL(audioUrl).hostname]
    );
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
    const reader = response.body.getReader();
    let released = false;
    const finish = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      release();
    };
    return new ReadableStream({
      async pull(stream) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish();
            stream.close();
            return;
          }
          stream.enqueue(value);
        } catch (error) {
          finish();
          stream.error(error);
        }
      },
      async cancel(reason) {
        finish();
        await reader.cancel(reason);
      },
    });
  } catch (error) {
    release();
    clearTimeout(timer);
    if ((error as { statusCode?: unknown })?.statusCode) throw error;
    throw createError({ statusCode: 502, statusMessage: 'Audio fetch failed' });
  }
});
