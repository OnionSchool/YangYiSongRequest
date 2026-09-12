<script setup lang="ts">
import { computed } from 'vue';
import { useAdmin } from '~/stores/admin';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();
const statusText = computed(() => (admin.me?.emailVerified ? '已验证' : '未验证'));
</script>

<template>
  <div class="mx-auto max-w-xl">
    <h1 class="text-xl font-bold" style="font-family: var(--font-display)">邮箱管理</h1>
    <p class="mt-1 text-sm text-ink-faint">绑定邮箱可用于账号验证与重要通知。</p>

    <section class="paper-card mt-6 overflow-hidden">
      <dl class="divide-y divide-rule text-sm">
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <dt class="text-ink-faint">当前邮箱</dt>
          <dd class="break-all text-right font-medium">{{ admin.me?.email || '尚未绑定' }}</dd>
        </div>
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <dt class="text-ink-faint">验证状态</dt>
          <dd :class="admin.me?.emailVerified ? 'text-green-700' : 'text-orange-deep'">
            {{ statusText }}
          </dd>
        </div>
      </dl>
      <div class="border-t border-rule px-5 py-4">
        <NuxtLink
          to="/admin/bind-email?returnTo=email"
          class="btn-primary inline-flex px-4 py-2 text-sm"
        >
          {{ admin.me?.email ? '更换或重新验证邮箱' : '绑定邮箱' }}
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
