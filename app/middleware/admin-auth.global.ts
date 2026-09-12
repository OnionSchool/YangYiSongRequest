import { useAdmin } from '~/stores/admin';

const EXEMPT_PATHS = ['/admin/login', '/admin/password', '/admin/bind-email'];

/**
 * Global middleware: redirect unauthenticated users to /admin/login
 * when they try to access any /admin/* page (except exempt paths).
 * Also enforces mustChangePassword and mustBindEmail redirects.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin') || to.path === '/admin/login') return;

  const admin = useAdmin();

  // If we haven't checked yet, do it once
  if (admin.me === null) {
    await admin.checkSession();
  }

  if (!admin.me) {
    return navigateTo('/admin/login');
  }

  // Enforce mustChangePassword first
  if (admin.me.mustChangePassword && to.path !== '/admin/password') {
    return navigateTo('/admin/password');
  }

  // Enforce mustBindEmail (skip if already on exempt page)
  if (admin.me.mustBindEmail && !EXEMPT_PATHS.includes(to.path)) {
    return navigateTo('/admin/bind-email');
  }
});
