import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, sqlite } from './db';
import { adminUser } from './schema';
import { badRequest } from './errors';
import { verifyPassword, hashPassword } from './password';
import { isAdminRole, type AdminRole } from './domain';

const IDLE_TTL_SECONDS = 8 * 60 * 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;

export interface AdminSession {
  userId: string;
  username: string;
  role: AdminRole;
  mustChangePassword: boolean;
  csrfToken: string;
}

const now = () => Math.floor(Date.now() / 1000);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

function assertUsername(username: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
    throw badRequest('INVALID_USERNAME', '用户名只能包含字母、数字、下划线和连字符');
  }
}

export function assertPassword(password: string): void {
  if (password.length < 12) throw badRequest('WEAK_PASSWORD', '密码至少需要 12 位');
}

export async function login(
  username: string,
  password: string,
  ip: string
): Promise<{ token: string; session: AdminSession }> {
  const cutoff = now() - LOGIN_WINDOW_SECONDS;
  const attempts = sqlite
    .prepare(
      'SELECT COUNT(*) AS count FROM "LoginAttempt" WHERE "failedAt" >= ? AND ("username" = ? OR "ip" = ?)'
    )
    .get(cutoff, username, ip) as { count: number };
  if (attempts.count >= LOGIN_MAX_FAILURES) {
    throw badRequest('LOGIN_COOLDOWN', '登录失败次数过多，请 15 分钟后重试');
  }
  const user = await db.query.adminUser.findFirst({ where: eq(adminUser.username, username) });
  if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) {
    sqlite
      .prepare(
        'INSERT INTO "LoginAttempt" ("id", "username", "ip", "failedAt") VALUES (?, ?, ?, ?)'
      )
      .run(crypto.randomUUID(), username, ip, now());
    throw badRequest('BAD_CREDENTIALS', '账号或密码错误');
  }
  const token = newToken();
  const csrfToken = newToken();
  const current = now();
  sqlite.prepare('DELETE FROM "LoginAttempt" WHERE "username" = ? OR "ip" = ?').run(username, ip);
  sqlite
    .prepare(
      'INSERT INTO "AdminSession" ("id", "tokenHash", "csrfToken", "userId", "sessionVersion", "createdAt", "lastSeenAt", "expiresAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      crypto.randomUUID(),
      tokenHash(token),
      csrfToken,
      user.id,
      user.sessionVersion,
      current,
      current,
      current + MAX_TTL_SECONDS
    );
  await db.update(adminUser).set({ lastLoginAt: current }).where(eq(adminUser.id, user.id));
  return {
    token,
    session: {
      userId: user.id,
      username: user.username,
      role: user.role as AdminRole,
      mustChangePassword: user.mustChangePassword === 1,
      csrfToken,
    },
  };
}

export function verifyToken(token: string): AdminSession | null {
  const current = now();
  const row = sqlite
    .prepare(
      `SELECT s."csrfToken", s."lastSeenAt", s."expiresAt", s."sessionVersion", u."id", u."username", u."role", u."mustChangePassword", u."disabled", u."sessionVersion" AS "userSessionVersion"
    FROM "AdminSession" s JOIN "AdminUser" u ON u."id" = s."userId"
    WHERE s."tokenHash" = ? AND s."revokedAt" IS NULL`
    )
    .get(tokenHash(token)) as Record<string, unknown> | undefined;
  if (
    !row ||
    row.disabled === 1 ||
    row.sessionVersion !== row.userSessionVersion ||
    Number(row.expiresAt) <= current ||
    Number(row.lastSeenAt) + IDLE_TTL_SECONDS <= current
  ) {
    if (row)
      sqlite
        .prepare('UPDATE "AdminSession" SET "revokedAt" = ? WHERE "tokenHash" = ?')
        .run(current, tokenHash(token));
    return null;
  }
  sqlite
    .prepare('UPDATE "AdminSession" SET "lastSeenAt" = ? WHERE "tokenHash" = ?')
    .run(current, tokenHash(token));
  return {
    userId: String(row.id),
    username: String(row.username),
    role: row.role as AdminRole,
    mustChangePassword: row.mustChangePassword === 1,
    csrfToken: String(row.csrfToken),
  };
}

export function revokeToken(token: string): void {
  sqlite
    .prepare('UPDATE "AdminSession" SET "revokedAt" = ? WHERE "tokenHash" = ?')
    .run(now(), tokenHash(token));
}

function revokeUserSessions(userId: string): void {
  sqlite
    .prepare('UPDATE "AdminSession" SET "revokedAt" = ? WHERE "userId" = ? AND "revokedAt" IS NULL')
    .run(now(), userId);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  assertPassword(newPassword);
  const user = await db.query.adminUser.findFirst({ where: eq(adminUser.id, userId) });
  if (!user || !verifyPassword(currentPassword, user.passwordHash))
    throw badRequest('BAD_PASSWORD', '当前密码错误');
  await db
    .update(adminUser)
    .set({
      passwordHash: hashPassword(newPassword),
      mustChangePassword: 0,
      sessionVersion: sql`${adminUser.sessionVersion} + 1`,
    })
    .where(eq(adminUser.id, userId));
  revokeUserSessions(userId);
}

export async function createAdminUser(
  username: string,
  password: string,
  role: AdminRole
): Promise<string> {
  assertUsername(username);
  assertPassword(password);
  if (!isAdminRole(role)) throw badRequest('INVALID_ROLE', '无效的管理员角色');
  const existing = await db.query.adminUser.findFirst({ where: eq(adminUser.username, username) });
  if (existing) throw badRequest('USERNAME_TAKEN', '账号已存在');
  const id = `user_${randomBytes(8).toString('hex')}`;
  await db
    .insert(adminUser)
    .values({ id, username, passwordHash: hashPassword(password), role, mustChangePassword: 1 });
  return id;
}

export async function updateAdminUser(
  userId: string,
  updates: { role?: AdminRole; disabled?: boolean; password?: string }
): Promise<void> {
  const user = await db.query.adminUser.findFirst({ where: eq(adminUser.id, userId) });
  if (!user) throw badRequest('USER_NOT_FOUND', '用户不存在');
  if (updates.role && !isAdminRole(updates.role))
    throw badRequest('INVALID_ROLE', '无效的管理员角色');
  if (updates.password) assertPassword(updates.password);
  const removesSuper =
    user.role === 'SUPER' && (updates.disabled || (updates.role && updates.role !== 'SUPER'));
  if (removesSuper) {
    const activeSupers = await db
      .select({ id: adminUser.id })
      .from(adminUser)
      .where(and(eq(adminUser.role, 'SUPER'), eq(adminUser.disabled, 0)));
    if (activeSupers.length <= 1)
      throw badRequest('LAST_SUPER', '不能停用或降级最后一个启用的超级管理员');
  }
  const patch: {
    role?: AdminRole;
    disabled?: number;
    passwordHash?: string;
    sessionVersion?: ReturnType<typeof sql>;
  } = {};
  if (updates.role) patch.role = updates.role;
  if (typeof updates.disabled === 'boolean') patch.disabled = updates.disabled ? 1 : 0;
  if (updates.password) patch.passwordHash = hashPassword(updates.password);
  if (updates.role || updates.disabled !== undefined || updates.password)
    patch.sessionVersion = sql`${adminUser.sessionVersion} + 1`;
  if (Object.keys(patch).length)
    await db.update(adminUser).set(patch).where(eq(adminUser.id, userId));
  if (patch.sessionVersion) revokeUserSessions(userId);
}
