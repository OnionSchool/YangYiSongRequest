import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { eq, and, gt, isNull, desc } from 'drizzle-orm';
import { requireAuth } from '../../../utils/admin-auth';
import { db } from '../../../utils/db';
import { emailVerification, adminUser } from '../../../utils/schema';
import { writeAudit } from '../../../utils/audit';

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

  // Find the latest unused, non-expired verification for this user
  const records = await db
    .select()
    .from(emailVerification)
    .where(
      and(
        eq(emailVerification.userId, session.userId),
        gt(emailVerification.expiresAt, now),
        isNull(emailVerification.usedAt)
      )
    )
    .orderBy(desc(emailVerification.createdAt))
    .limit(1);

  if (records.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '验证码已过期，请重新发送',
    });
  }

  const record = records[0];

  if (record.code !== code.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '验证码错误',
    });
  }

  // Mark verification as used
  await db
    .update(emailVerification)
    .set({ usedAt: now })
    .where(eq(emailVerification.id, record.id));

  // Update user email
  await db
    .update(adminUser)
    .set({ email: record.email, emailVerifiedAt: now })
    .where(eq(adminUser.id, session.userId));

  await writeAudit(session.userId, 'email.bind', null, { email: record.email });

  return { ok: true, email: record.email };
});
