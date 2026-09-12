import { createError, defineEventHandler, readBody, setHeader, setCookie } from 'h3';
import { login } from '../../utils/auth';
import { writeAudit } from '../../utils/audit';
import { readSite } from '../../utils/site';
import { getClientIp } from '../../utils/request-ip';
import { AppError } from '../../utils/errors';

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

  const ip = getClientIp(event);
  let token: string;
  let session: Awaited<ReturnType<typeof login>>['session'];
  try {
    ({ token, session } = await login(username, password, ip));
  } catch (error) {
    if (error instanceof AppError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'Bad Request',
        message: error.message,
        data: { code: error.code, detail: error.detail },
      });
    }
    throw error;
  }

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
    displayName: session.displayName,
    role: session.role,
    mustChangePassword: site.forceChangePassword && session.mustChangePassword,
    mustBindEmail: site.requireEmailBind && !session.emailVerified,
    email: session.email,
    emailVerified: session.emailVerified,
    csrfToken: session.csrfToken,
  };
});
