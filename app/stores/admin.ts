import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '~/lib/api';

export interface AdminUser {
  username: string;
  role: 'SUPER' | 'REVIEWER';
  mustChangePassword: boolean;
  debugMode?: boolean;
}

export const useAdmin = defineStore('admin', () => {
  const me = ref<AdminUser | null>(null);

  const isSuper = computed(() => me.value?.role === 'SUPER');

  async function login(username: string, password: string) {
    const user = await apiFetch<AdminUser>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    me.value = user;
    return user;
  }

  async function logout() {
    await apiFetch<{ ok: true }>('/api/admin/logout', { method: 'POST' });
    me.value = null;
  }

  async function checkSession() {
    try {
      const user = await apiFetch<AdminUser | null>('/api/admin/me');
      me.value = user;
    } catch {
      me.value = null;
    }
  }

  async function changePassword(current: string, next: string) {
    await apiFetch<{ ok: true }>('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    });
  }

  async function switchDebugRole(role: AdminUser['role']) {
    const user = await apiFetch<AdminUser>('/api/admin/debug-role', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    me.value = user;
  }

  return {
    me,
    isSuper,
    login,
    logout,
    checkSession,
    changePassword,
    switchDebugRole,
  };
});
