import { createError, defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../../utils/admin-auth';
import { unscheduleRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody<{ expectedVersion?: unknown }>(event);
  const expectedVersion = body?.expectedVersion;
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw createError({ statusCode: 400, message: '节目单版本无效' });
  }
  return unscheduleRequest(id, session.userId, expectedVersion);
});
