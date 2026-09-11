import { randomBytes } from 'node:crypto';
import { db } from './db';
import { adminUser } from './schema';
import { badRequest } from './errors';
import { verifyPassword, hashPassword } from './password';
import type { AdminRole } from './domain';
import { eq } from 'drizzle-orm';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AdminSession {
  userId: string;
  username: string;
  role: AdminRole;
  mustChangePassword: boolean;
}

const sessions = new Map<string, { at: number; session: AdminSession }>();

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; session: AdminSession }> {
  const user = await db.query.adminUser.findFirst({
    where: eq(adminUser.username, username),
  });

  if (!user || user.disabled) {
    throw badRequest('BAD_CREDENTIALS', '账号或密码错误');
  }

  if (!verifyPassword(password, user.passwordHash)) {
    throw badRequest('BAD_CREDENTIALS', '账号或密码错误');
  }

  // Update last login
  await db
    .update(adminUser)
    .set({ lastLoginAt: Math.floor(Date.now() / 1000) })
    .where(eq(adminUser.id, user.id));

  const token = generateToken();
  const session: AdminSession = {
    userId: user.id,
    username: user.username,
    role: user.role as AdminRole,
    mustChangePassword: user.mustChangePassword === 1,
  };

  sessions.set(token, { at: Date.now(), session });
  return { token, session };
}

export function verifyToken(token: string): AdminSession | null {
  const stored = sessions.get(token);
  if (!stored) return null;

  if (Date.now() - stored.at > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }

  // Refresh timestamp
  stored.at = Date.now();
  return stored.session;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db.query.adminUser.findFirst({
    where: eq(adminUser.id, userId),
  });

  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    throw badRequest('BAD_PASSWORD', '当前密码错误');
  }

  const newHash = hashPassword(newPassword);
  await db
    .update(adminUser)
    .set({ passwordHash: newHash, mustChangePassword: 0 })
    .where(eq(adminUser.id, userId));
}

export async function createAdminUser(
  username: string,
  password: string,
  role: AdminRole
): Promise<string> {
  const existing = await db.query.adminUser.findFirst({
    where: eq(adminUser.username, username),
  });

  if (existing) {
    throw badRequest('USERNAME_TAKEN', '账号已存在');
  }

  const id = `user_${randomBytes(8).toString('hex')}`;
  const hash = hashPassword(password);

  await db.insert(adminUser).values({
    id,
    username,
    passwordHash: hash,
    role,
    mustChangePassword: 1,
  });

  return id;
}

export async function updateAdminUser(
  userId: string,
  updates: { role?: AdminRole; disabled?: boolean; password?: string }
): Promise<void> {
  const user = await db.query.adminUser.findFirst({
    where: eq(adminUser.id, userId),
  });

  if (!user) {
    throw badRequest('USER_NOT_FOUND', '用户不存在');
  }

  const patch: any = {};
  if (updates.role) patch.role = updates.role;
  if (typeof updates.disabled === 'boolean') patch.disabled = updates.disabled ? 1 : 0;
  if (updates.password) patch.passwordHash = hashPassword(updates.password);

  if (Object.keys(patch).length > 0) {
    await db.update(adminUser).set(patch).where(eq(adminUser.id, userId));
  }
}
