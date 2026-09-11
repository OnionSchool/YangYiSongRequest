/**
 * Initialize the database with default admin user if it doesn't exist.
 * This should be called on first startup.
 */

import { db, runMigrations } from './db';
import { adminUser } from './schema';
import { createAdminUser } from './auth';

export async function initializeDatabase(): Promise<void> {
  await runMigrations();

  const users = await db.select().from(adminUser).limit(1);

  if (users.length === 0) {
    try {
      await createAdminUser('admin', 'admin123', 'SUPER');
      console.log('[DB] Default admin user created: admin/admin123 (please change password)');
    } catch {
      console.log('[DB] Admin user already exists');
    }
  } else {
    console.log('[DB] Database already initialized');
  }
}
