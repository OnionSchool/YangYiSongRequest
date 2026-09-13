import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { requireAuth } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { emailVerification } from '../../../utils/schema';
import { sendVerificationEmail, isSmtpConfigured } from '../../../utils/email';

const CODE_TTL_SECONDS = 10 * 60; // 10 minutes
const RATE_LIMIT_SECONDS = 60; // 1 code per minute

function hashCode(code: string): string {
  return createHash('sha256').update(`email-verification-code:${code}`).digest('hex');
}

function generateCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  const session = requireAuth(event);

  if (!isSmtpConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: '邮件服务未配置，请联系管理员设置 SMTP',
    });
  }

  const { email } = await readBody(event);

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请填写有效的邮箱地址',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // Rate limit: 1 code per minute per user
  const recent = await db
    .select()
    .from(emailVerification)
    .where(
      and(
        eq(emailVerification.userId, session.userId),
        gt(emailVerification.createdAt, now - RATE_LIMIT_SECONDS),
        isNull(emailVerification.usedAt)
      )
    );

  if (recent.length > 0) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: '发送过于频繁，请 1 分钟后再试',
    });
  }

  const code = generateCode();
  const id = `ev_${randomBytes(8).toString('hex')}`;

  await db.insert(emailVerification).values({
    id,
    userId: session.userId,
    email: normalizedEmail,
    codeHash: hashCode(code),
    expiresAt: now + CODE_TTL_SECONDS,
  });

  await sendVerificationEmail(normalizedEmail, code);

  return { ok: true };
});
