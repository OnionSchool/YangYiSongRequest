import { createError, defineEventHandler, getQuery, setHeader } from 'h3';

const TIMEOUT_MS = 8_000;
const ALLOWED_SERVERS = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'];

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const server = typeof query.server === 'string' ? query.server : '';
  const id = typeof query.id === 'string' ? query.id : '';
  const size = typeof query.size === 'string' ? query.size : '300';

  if (!ALLOWED_SERVERS.includes(server) || !id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const metingUrl = process.env.METING_API_URL;
  if (!metingUrl) {
    throw createError({ statusCode: 503, statusMessage: 'Meting API not configured' });
  }

  const base = metingUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ server, type: 'pic', id, size });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const metingRes = await fetch(`${base}?${params}`, { signal: controller.signal });
    if (!metingRes.ok) {
      throw createError({ statusCode: 502, statusMessage: 'Meting API error' });
    }
    const data = (await metingRes.json()) as { url?: string };
    const imageUrl = data?.url;
    if (!imageUrl) {
      throw createError({ statusCode: 404, statusMessage: 'Cover not found' });
    }

    // Proxy the actual image
    const imageRes = await fetch(imageUrl, { signal: controller.signal });
    if (!imageRes.ok || !imageRes.body) {
      throw createError({ statusCode: 502, statusMessage: 'Image fetch failed' });
    }

    setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400');
    setHeader(event, 'Content-Type', imageRes.headers.get('content-type') ?? 'image/jpeg');
    return imageRes.body;
  } catch (error) {
    if ((error as any)?.statusCode) throw error;
    throw createError({ statusCode: 502, statusMessage: 'Cover proxy failed' });
  } finally {
    clearTimeout(timer);
  }
});
