import { defineEventHandler, deleteCookie, getCookie, setHeader } from 'h3';
import { revokeToken, verifyToken } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { isDebugMode } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  if (!isDebugMode()) {
    const token = getCookie(event, 'admin_token');
    if (token) {
      const session = verifyToken(token);
      if (session) {
        await writeAudit(session.userId, 'logout', null);
        revokeToken(token);
      }
    }
  }

  deleteCookie(event, 'admin_token');
  return { ok: true };
});
