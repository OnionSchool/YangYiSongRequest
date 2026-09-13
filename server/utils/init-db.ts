/**
 * Initialize the database with default admin user if it doesn't exist.
 * This should be called on first startup.
 */

import { db, runMigrations } from './db';
import { adminUser } from './schema';
import { createAdminUser } from './auth';
import { randomBytes } from 'node:crypto';

export async function initializeDatabase(): Promise<void> {
  await runMigrations();

  const users = await db.select().from(adminUser).limit(1);

  if (users.length > 0) return;

  const production = process.env.NODE_ENV === 'production';
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (production && (!username || !password)) {
    throw new Error('生产环境必须设置 INITIAL_ADMIN_USERNAME 和 INITIAL_ADMIN_PASSWORD');
  }

  const generatedPassword = randomBytes(18).toString('base64url');
  await createAdminUser(username ?? 'admin', password ?? generatedPassword, 'SUPER');
}
