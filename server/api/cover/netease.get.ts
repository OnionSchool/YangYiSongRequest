import { createError, defineEventHandler, getQuery, setHeader } from 'h3';

export default defineEventHandler(async (event) => {
  const url = getQuery(event).url;
  if (typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.music.126.net')) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const response = await fetch(target, { headers: { referer: 'https://music.163.com/' } });
  if (!response.ok || !response.body) {
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' });
  }

  setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400');
  setHeader(event, 'Content-Type', response.headers.get('content-type') ?? 'image/jpeg');
  return response.body;
});
