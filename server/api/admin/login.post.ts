import { createError, defineEventHandler, readBody, setHeader, setCookie } from 'h3';
import { login } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { readSite } from '../../utils/site';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const { username, password } = await readBody(event);

  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing credentials',
      message: '缺少账号或密码',
    });
  }

  const { token, session } = await login(username, password);

  setCookie(event, 'admin_token', token, {
    maxAge: 7 * 24 * 60 * 60, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  // Log the login
  await writeAudit(session.userId, 'login', null);

  const site = await readSite();

  return {
    username: session.username,
    role: session.role,
    mustChangePassword: site.forceChangePassword && session.mustChangePassword,
  };
});
