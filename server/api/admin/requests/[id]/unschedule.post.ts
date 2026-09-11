import { defineEventHandler, getRouterParam, readBody, setHeader } from 'h3';
import { requirePlanner } from '../../../../utils/admin-auth';
import { unscheduleRequest } from '../../../../utils/admin-requests';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requirePlanner(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody<{ expectedVersion?: unknown }>(event);
  return unscheduleRequest(
    id,
    session.userId,
    typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined
  );
});
