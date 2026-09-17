<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAdmin } from '~/stores/admin';
import { apiFetch, ApiError } from '~/lib/api';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();
const router = useRouter();
const route = useRoute();

const email = ref('');
const code = ref('');
const step = ref<'email' | 'code'>('email');
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const busy = ref(false);
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const canResend = computed(() => countdown.value === 0 && !busy.value);

function startCountdown() {
  countdown.value = 60;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

async function sendCode() {
  if (busy.value) return;
  error.value = null;
  message.value = null;

  if (!email.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    error.value = '请填写有效的邮箱地址';
    return;
  }

  busy.value = true;
  try {
    await apiFetch('/api/admin/email/send-code', {
      method: 'POST',
      body: JSON.stringify({ email: email.value.trim() }),
    });
    step.value = 'code';
    message.value = `验证码已发送至 ${email.value.trim()}`;
    startCountdown();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '发送失败';
  } finally {
    busy.value = false;
  }
}

async function verify() {
  if (busy.value) return;
  error.value = null;
  message.value = null;

  if (!code.value || !/^\d{6}$/.test(code.value.trim())) {
    error.value = '请输入 6 位验证码';
    return;
  }

  busy.value = true;
  try {
    await apiFetch('/api/admin/email/verify', {
      method: 'POST',
      body: JSON.stringify({ code: code.value.trim() }),
    });
    // Refresh session to clear mustBindEmail.
    await admin.checkSession();
    await router.push(route.query.returnTo === 'email' ? '/admin/email' : '/admin');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '验证失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[60vh]">
    <div class="w-full max-w-md">
      <h1 class="text-xl font-bold mb-1 text-center" style="font-family: var(--font-display)">
        绑定邮箱
      </h1>
      <p class="text-sm text-ink-faint mb-6 text-center">请绑定并验证你的邮箱地址以继续使用</p>

      <div class="paper-card p-6 space-y-4">
        <!-- Step 1: Enter email -->
        <label class="block">
          <span class="text-sm font-medium">邮箱地址</span>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            :disabled="step === 'code'"
            class="w-full mt-1.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors disabled:opacity-50"
            placeholder="请输入你的邮箱"
          />
        </label>

        <!-- Step 2: Enter code -->
        <template v-if="step === 'code'">
          <label class="block">
            <span class="text-sm font-medium">验证码</span>
            <input
              v-model="code"
              type="text"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              class="w-full mt-1.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm text-center tracking-[0.3em] font-mono focus:border-ink-faint focus:outline-none transition-colors"
              placeholder="6 位验证码"
            />
          </label>
          <div class="flex items-center justify-between">
            <button
              class="text-sm text-ink-soft hover:text-ink transition-colors disabled:opacity-50"
              :disabled="!canResend"
              @click="sendCode"
            >
              {{ countdown > 0 ? `${countdown}s 后可重新发送` : '重新发送验证码' }}
            </button>
            <button
              class="text-sm text-ink-soft hover:text-ink transition-colors"
              @click="
                step = 'email';
                code = '';
                error = null;
                message = null;
                stopCountdown();
              "
            >
              更换邮箱
            </button>
          </div>
        </template>

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

        <button
          v-if="step === 'email'"
          class="btn-primary w-full py-2.5 text-sm"
          :disabled="busy"
          @click="sendCode"
        >
          {{ busy ? '发送中…' : '发送验证码' }}
        </button>
        <button v-else class="btn-primary w-full py-2.5 text-sm" :disabled="busy" @click="verify">
          {{ busy ? '验证中…' : '验证并绑定' }}
        </button>
      </div>
    </div>
  </div>
</template>
