import { defineEventHandler, getCookie, setHeader } from 'h3';
import { verifyToken } from '../../utils/auth';
import { readSite } from '../../utils/site';
import { getDebugSession, isDebugMode } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  if (isDebugMode()) {
    return { ...getDebugSession(event), debugMode: true };
  }

  const token = getCookie(event, 'admin_token');
  if (!token) {
    return null;
  }

  const session = verifyToken(token);
  if (!session) {
    return null;
  }

  const site = await readSite();

  return {
    username: session.username,
    role: session.role,
    mustChangePassword: site.forceChangePassword && session.mustChangePassword,
  };
});
