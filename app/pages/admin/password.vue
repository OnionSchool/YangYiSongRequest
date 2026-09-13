<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAdmin } from '~/stores/admin';
import { ApiError } from '~/lib/api';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();
const router = useRouter();
const current = ref('');
const next = ref('');
const confirm = ref('');
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

async function submit() {
  error.value = null;
  message.value = null;

  if (!current.value || !next.value || !confirm.value) {
    error.value = '请填完所有字段';
    return;
  }

  if (next.value !== confirm.value) {
    error.value = '新密码与确认密码不一致';
    return;
  }

  busy.value = true;
  try {
    await admin.changePassword(current.value, next.value);
    await router.replace('/admin/login');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '修改失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[60vh]">
    <div class="w-full max-w-md">
      <h1 class="text-xl font-bold mb-1 text-center" style="font-family: var(--font-display)">
        修改密码
      </h1>
      <p class="text-sm text-ink-faint mb-6 text-center">更新你的登录密码</p>
      <form class="paper-card p-6 space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="text-sm font-medium">当前密码</span>
          <input
            v-model="current"
            type="password"
            autocomplete="current-password"
            class="w-full mt-1.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors"
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium">新密码</span>
          <input
            v-model="next"
            type="password"
            autocomplete="new-password"
            class="w-full mt-1.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors"
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium">确认新密码</span>
          <input
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            class="w-full mt-1.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors"
          />
        </label>

        <div
          v-if="error"
          class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {{ error }}
        </div>
        <div
          v-if="message"
          class="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700"
        >
          {{ message }}
        </div>

        <button type="submit" class="btn-primary w-full py-2.5 text-sm" :disabled="busy">
          {{ busy ? '修改中…' : '修改密码' }}
        </button>
      </form>
    </div>
  </div>
</template>
