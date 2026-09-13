<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ApiError, apiFetch } from '~/lib/api';

definePageMeta({ layout: 'admin' });

const username = ref('');
const code = ref('');
const password = ref('');
const confirmation = ref('');
const step = ref<'request' | 'confirm'>('request');
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const busy = ref(false);
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const canResend = computed(() => !busy.value && countdown.value === 0);

function startCountdown(): void {
  countdown.value = 60;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

async function requestCode(): Promise<void> {
  if (busy.value) return;
  error.value = null;
  message.value = null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username.value.trim())) {
    error.value = '请输入有效的账号';
    return;
  }
  busy.value = true;
  try {
    await apiFetch('/api/admin/password/reset/request', {
      method: 'POST',
      body: JSON.stringify({ username: username.value.trim() }),
    });
    step.value = 'confirm';
    message.value = '若该账号已绑定并验证邮箱，验证码已发送。';
    startCountdown();
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : '发送失败';
  } finally {
    busy.value = false;
  }
}

async function confirm(): Promise<void> {
  if (busy.value) return;
  error.value = null;
  message.value = null;
  if (!/^\d{6}$/.test(code.value.trim())) {
    error.value = '请输入 6 位验证码';
    return;
  }
  if (password.value.length < 12) {
    error.value = '密码至少需要 12 位';
    return;
  }
  if (password.value !== confirmation.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  busy.value = true;
  try {
    await apiFetch('/api/admin/password/reset/confirm', {
      method: 'POST',
      body: JSON.stringify({
        username: username.value.trim(),
        code: code.value.trim(),
        next: password.value,
      }),
    });
    message.value = '密码已重置，请使用新密码登录。';
    code.value = '';
    password.value = '';
    confirmation.value = '';
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : '重置失败';
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center">
    <div class="w-full max-w-md">
      <h1 class="mb-1 text-center text-xl font-bold" style="font-family: var(--font-display)">
        重置密码
      </h1>
      <p class="mb-6 text-center text-sm text-ink-faint">验证码将发送至账号已绑定的邮箱</p>

      <form
        class="paper-card space-y-4 p-6"
        @submit.prevent="step === 'request' ? requestCode() : confirm()"
      >
        <label class="block">
          <span class="text-sm font-medium">账号</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            :disabled="step === 'confirm'"
            class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none disabled:opacity-50"
          />
        </label>

        <template v-if="step === 'confirm'">
          <label class="block">
            <span class="text-sm font-medium">验证码</span>
            <input
              v-model="code"
              type="text"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-center font-mono text-sm tracking-[0.3em] focus:border-ink-faint focus:outline-none"
              placeholder="6 位验证码"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium">新密码</span>
            <input
              v-model="password"
              type="password"
              autocomplete="new-password"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium">确认新密码</span>
            <input
              v-model="confirmation"
              type="password"
              autocomplete="new-password"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none"
            />
          </label>
          <div class="flex items-center justify-between text-sm">
            <button
              type="button"
              class="text-ink-soft hover:text-ink disabled:opacity-50"
              :disabled="!canResend"
              @click="requestCode"
            >
              {{ countdown > 0 ? `${countdown}s 后可重新发送` : '重新发送验证码' }}
            </button>
            <button
              type="button"
              class="text-ink-soft hover:text-ink"
              @click="
                step = 'request';
                code = '';
                error = null;
                message = null;
              "
            >
              更换账号
            </button>
          </div>
        </template>

        <p
          v-if="error"
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {{ error }}
        </p>
        <p
          v-if="message"
          class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {{ message }}
        </p>
        <button type="submit" class="btn-primary w-full py-2.5 text-sm" :disabled="busy">
          {{ busy ? '处理中…' : step === 'request' ? '发送验证码' : '重置密码' }}
        </button>
        <NuxtLink to="/admin/login" class="block text-center text-sm text-ink-soft hover:text-ink"
          >返回登录</NuxtLink
        >
      </form>
    </div>
  </div>
</template>
