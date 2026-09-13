import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, sqlite } from '../server/utils/db';
import { confirmPasswordReset } from '../server/utils/password-reset';
import { hashPassword, verifyPassword } from '../server/utils/password';

const userId = `test_${randomUUID()}`;
const resetId = `pr_${randomUUID()}`;
const username = `reset_${randomUUID().replace(/-/g, '')}`;
const code = '123456';
const nextPassword = 'new-password-123';

const codeHash = createHash('sha256').update(`password-reset-code:${code}`).digest('hex');

describe('邮箱密码重置', () => {
  beforeAll(async () => {
    await runMigrations();
    const current = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        'INSERT INTO "AdminUser" ("id", "username", "passwordHash", "role", "email", "emailVerifiedAt") VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        userId,
        username,
        hashPassword('old-password-123'),
        'PLANNER',
        'test@example.com',
        current
      );
    sqlite
      .prepare(
        'INSERT INTO "PasswordReset" ("id", "userId", "codeHash", "ipHash", "expiresAt") VALUES (?, ?, ?, ?, ?)'
      )
      .run(resetId, userId, codeHash, 'test-ip', current + 60);
  });

  afterAll(() => {
    sqlite.prepare('DELETE FROM "PasswordReset" WHERE "id" = ?').run(resetId);
    sqlite.prepare('DELETE FROM "AdminUser" WHERE "id" = ?').run(userId);
  });

  it('消费验证码并更新密码', async () => {
    await expect(confirmPasswordReset(username, code, nextPassword)).resolves.toBe(userId);
    const user = sqlite
      .prepare('SELECT "passwordHash", "sessionVersion" FROM "AdminUser" WHERE "id" = ?')
      .get(userId) as { passwordHash: string; sessionVersion: number };
    const reset = sqlite
      .prepare('SELECT "usedAt" FROM "PasswordReset" WHERE "id" = ?')
      .get(resetId) as { usedAt: number | null };
    expect(verifyPassword(nextPassword, user.passwordHash)).toBe(true);
    expect(user.sessionVersion).toBe(1);
    expect(reset.usedAt).not.toBeNull();
  });

  it('拒绝已消费的验证码', async () => {
    await expect(confirmPasswordReset(username, code, nextPassword)).rejects.toMatchObject({
      code: 'INVALID_RESET_CODE',
    });
  });
});
