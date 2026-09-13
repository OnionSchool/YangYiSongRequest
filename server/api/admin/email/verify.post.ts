import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAuth } from '../../../utils/admin-auth';
import { sqlite } from '../../../utils/db';
import { writeAudit } from '../../../utils/audit';

const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(`email-verification-code:${code}`).digest('hex');
}

function codesMatch(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireAuth(event);
  const { code } = await readBody(event);

  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请输入 6 位验证码',
    });
  }

  const now = Math.floor(Date.now() / 1000);

  const email = sqlite.transaction(() => {
    const record = sqlite
      .prepare(
        'SELECT "id", "email", "codeHash", "attempts" FROM "EmailVerification" WHERE "userId" = ? AND "usedAt" IS NULL AND "expiresAt" > ? ORDER BY "createdAt" DESC LIMIT 1'
      )
      .get(session.userId, now) as
      { id: string; email: string; codeHash: string; attempts: number } | undefined;
    if (!record) return null;
    if (!codesMatch(record.codeHash, hashCode(code.trim()))) {
      const attempts = record.attempts + 1;
      sqlite
        .prepare('UPDATE "EmailVerification" SET "attempts" = ?, "usedAt" = ? WHERE "id" = ?')
        .run(attempts, attempts >= MAX_ATTEMPTS ? now : null, record.id);
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: '验证码错误' });
    }
    sqlite
      .prepare('UPDATE "EmailVerification" SET "usedAt" = ? WHERE "id" = ?')
      .run(now, record.id);
    sqlite
      .prepare('UPDATE "AdminUser" SET "email" = ?, "emailVerifiedAt" = ? WHERE "id" = ?')
      .run(record.email, now, session.userId);
    return record.email;
  })();

  if (!email) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '验证码已过期，请重新发送',
    });
  }

  await writeAudit(session.userId, 'email.bind', null, { email });

  return { ok: true, email };
});
