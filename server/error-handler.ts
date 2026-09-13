import { send, setResponseHeader, setResponseStatus } from 'h3';
import { defineNitroErrorHandler } from 'nitropack/runtime';
import { AppError } from './utils/errors';
import { logError } from './utils/logger';

function metingContext(error: unknown): { api: string; source?: string } | undefined {
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const { metingApi, source } = data as { metingApi?: unknown; source?: unknown };
  if (typeof metingApi !== 'string') return undefined;
  return { api: metingApi, ...(typeof source === 'string' ? { source } : {}) };
}

function errorCode(statusCode: number): string {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 429) return 'TOO_MANY_REQUESTS';
  return 'INTERNAL_ERROR';
}

/** Return the common JSON envelope for all API errors. */
export default defineNitroErrorHandler((error, event, { defaultHandler }) => {
  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
  if (statusCode >= 500) {
    const meting = metingContext(error);
    logError('请求处理失败', error, {
      request: { method: event.method, path: event.path, statusCode },
      ...(meting ? { meting } : {}),
    });
  }
  if (!event.path.startsWith('/api/')) return defaultHandler(error, event);

  const appError = error instanceof AppError ? error : null;
  setResponseStatus(event, statusCode);
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');
  return send(
    event,
    JSON.stringify({
      code: appError?.code ?? errorCode(statusCode),
      message: appError?.message ?? (statusCode < 500 ? error.message : '服务器暂时无法处理请求'),
      data: null,
    })
  );
});
