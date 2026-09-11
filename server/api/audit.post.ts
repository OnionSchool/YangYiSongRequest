import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { writeAudit } from '../utils/audit';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const body = await readBody(event);
  const { actorId, action, targetId, detail } = body;

  if (!action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing action',
      message: 'action is required',
    });
  }

  await writeAudit(actorId || null, action, targetId || null, detail);
  return { ok: true };
});
