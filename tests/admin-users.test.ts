import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, sqlite } from '../server/utils/db';
import { createAdminUser, deleteAdminUser, updateAdminUser } from '../server/utils/auth';

const suffix = randomUUID().replace(/-/g, '');
const actorUsername = `actor_${suffix}`;
const targetUsername = `target_${suffix}`;
const nextUsername = `renamed_${suffix}`;
const password = `password-${suffix}`;

let actorId = '';
let targetId = '';

describe('管理员账号管理', () => {
  beforeAll(async () => {
    await runMigrations();
    actorId = await createAdminUser(actorUsername, password, 'SUPER');
    targetId = await createAdminUser(targetUsername, password, 'PLANNER');
    sqlite
      .prepare(
        'INSERT INTO "AdminSession" ("id", "tokenHash", "csrfToken", "userId", "sessionVersion", "createdAt", "lastSeenAt", "expiresAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), `token-${suffix}`, `csrf-${suffix}`, targetId, 1, 1, 1, 1);
  });

  afterAll(() => {
    sqlite.prepare('DELETE FROM "AdminSession" WHERE "userId" IN (?, ?)').run(actorId, targetId);
    sqlite.prepare('DELETE FROM "AdminUser" WHERE "id" IN (?, ?)').run(actorId, targetId);
  });

  it('更新用户名和权限', async () => {
    await updateAdminUser(targetId, { username: nextUsername, role: 'TECHNICIAN' });
    const user = sqlite
      .prepare('SELECT "username", "role" FROM "AdminUser" WHERE "id" = ?')
      .get(targetId) as { username: string; role: string };
    expect(user).toEqual({ username: nextUsername, role: 'TECHNICIAN' });
  });

  it('拒绝重复用户名', async () => {
    await expect(updateAdminUser(targetId, { username: actorUsername })).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    });
  });

  it('保护当前账号和最后的超级管理员', () => {
    expect(() => deleteAdminUser(actorId, actorId)).toThrowError(
      expect.objectContaining({ code: 'CANNOT_DELETE_SELF' })
    );
    expect(() => deleteAdminUser(actorId, targetId)).toThrowError(
      expect.objectContaining({ code: 'LAST_SUPER' })
    );
  });

  it('删除用户并清理会话', () => {
    const deleted = deleteAdminUser(targetId, actorId);
    expect(deleted.username).toBe(nextUsername);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM "AdminUser" WHERE "id" = ?').get(targetId)
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS count FROM "AdminSession" WHERE "userId" = ?')
        .get(targetId)
    ).toEqual({ count: 0 });
  });
});
