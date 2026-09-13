import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { assertPassword, resetPassword } from './auth';
import { db, sqlite } from './db';
import { tooMany, badRequest } from './errors';
import { sendPasswordResetEmail } from './email';
import { adminUser } from './schema';

const CODE_TTL_SECONDS = 10 * 60;
const RESEND_SECONDS = 60;
const IP_WINDOW_SECONDS = 15 * 60;
const IP_MAX_REQUESTS = 5;
const MAX_ATTEMPTS = 5;

const now = () => Math.floor(Date.now() / 1000);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hashCode = (code: string) => digest(`password-reset-code:${code}`);
const hashIp = (ip: string) => digest(`password-reset-ip:${ip}`);

function generateCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function codesMatch(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function requestPasswordReset(username: string, ip: string): Promise<void> {
  const current = now();
  const ipDigest = hashIp(ip);
  const code = generateCode();
  const id = `pr_${randomBytes(8).toString('hex')}`;
  const created = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM "PasswordReset" WHERE "expiresAt" < ?').run(current - 24 * 60 * 60);
    const ipRequests = sqlite
      .prepare(
        'SELECT COUNT(*) AS "count" FROM "PasswordReset" WHERE "ipHash" = ? AND "createdAt" > ?'
      )
      .get(ipDigest, current - IP_WINDOW_SECONDS) as { count: number };
    if (ipRequests.count >= IP_MAX_REQUESTS) {
      throw tooMany('RESET_RATE_LIMIT', '请求过于频繁，请稍后再试');
    }
    const user = sqlite
      .prepare(
        'SELECT "id", "email" FROM "AdminUser" WHERE "username" = ? AND "disabled" = 0 AND "email" IS NOT NULL AND "emailVerifiedAt" IS NOT NULL'
      )
      .get(username) as { id: string; email: string } | undefined;
    if (!user) return null;
    const recent = sqlite
      .prepare('SELECT 1 FROM "PasswordReset" WHERE "userId" = ? AND "createdAt" > ? LIMIT 1')
      .get(user.id, current - RESEND_SECONDS);
    if (recent) return null;
    sqlite
      .prepare(
        'INSERT INTO "PasswordReset" ("id", "userId", "codeHash", "ipHash", "expiresAt") VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, user.id, hashCode(code), ipDigest, current + CODE_TTL_SECONDS);
    return user;
  })();
  if (!created) return;
  try {
    await sendPasswordResetEmail(created.email, code);
  } catch (error) {
    sqlite.prepare('UPDATE "PasswordReset" SET "usedAt" = ? WHERE "id" = ?').run(current, id);
    throw error;
  }
}

export async function confirmPasswordReset(
  username: string,
  code: string,
  newPassword: string
): Promise<string> {
  if (!/^\d{6}$/.test(code)) throw badRequest('INVALID_RESET_CODE', '请输入 6 位验证码');
  assertPassword(newPassword);
  const user = await db.query.adminUser.findFirst({ where: eq(adminUser.username, username) });
  if (!user || user.disabled || !user.email || !user.emailVerifiedAt) {
    throw badRequest('INVALID_RESET_CODE', '验证码错误或已过期');
  }

  const current = now();
  const reset = sqlite.transaction(() => {
    const record = sqlite
      .prepare(
        'SELECT "id", "codeHash", "attempts" FROM "PasswordReset" WHERE "userId" = ? AND "usedAt" IS NULL AND "expiresAt" > ? ORDER BY "createdAt" DESC LIMIT 1'
      )
      .get(user.id, current) as { id: string; codeHash: string; attempts: number } | undefined;
    if (!record) throw badRequest('INVALID_RESET_CODE', '验证码错误或已过期');
    if (!codesMatch(record.codeHash, hashCode(code))) {
      const attempts = record.attempts + 1;
      sqlite
        .prepare('UPDATE "PasswordReset" SET "attempts" = ?, "usedAt" = ? WHERE "id" = ?')
        .run(attempts, attempts >= MAX_ATTEMPTS ? current : null, record.id);
      throw badRequest('INVALID_RESET_CODE', '验证码错误或已过期');
    }
    sqlite
      .prepare('UPDATE "PasswordReset" SET "usedAt" = ? WHERE "id" = ?')
      .run(current, record.id);
  });
  reset();
  await resetPassword(user.id, newPassword);
  return user.id;
}
