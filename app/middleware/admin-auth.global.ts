import { useAdmin } from '~/stores/admin';

/**
 * Global middleware: redirect unauthenticated users to /admin/login
 * when they try to access any /admin/* page (except /admin/login itself).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // Only guard /admin/* routes (but not /admin/login)
  if (!to.path.startsWith('/admin') || to.path === '/admin/login') return;

  const admin = useAdmin();

  // If we haven't checked yet, do it once
  if (admin.me === null) {
    await admin.checkSession();
  }

  if (!admin.me) {
    return navigateTo('/admin/login');
  }
});
