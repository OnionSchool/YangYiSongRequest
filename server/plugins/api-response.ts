import type { H3Event } from 'h3';

const BINARY_PATHS = ['/api/cover/', '/api/stream/', '/api/admin/download/'];

function isBinaryResponse(event: H3Event): boolean {
  return BINARY_PATHS.some((path) => event.path.startsWith(path));
}

/** Wrap ordinary JSON API route results while leaving file and media responses untouched. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    if (!event.path.startsWith('/api/') || isBinaryResponse(event)) return;
    if (event.context.nitro?.errors?.length) return;
    response.body = { code: 0, message: 'ok', data: response.body ?? null };
  });
});
