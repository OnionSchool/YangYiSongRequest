import { defineEventHandler, setHeader } from 'h3';
import { db } from '../../utils/db';
import { adminUser } from '../../utils/schema';
import { requireSuper } from '../../utils/admin-auth';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  requireSuper(event);

  const users = await db.select().from(adminUser).all();

  return users.map((u: any) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? u.username,
    role: u.role,
    disabled: u.disabled === 1,
    mustChangePassword: u.mustChangePassword === 1,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt * 1000).toISOString() : null,
    createdAt: u.createdAt ? new Date(u.createdAt * 1000).toISOString() : null,
  }));
});
