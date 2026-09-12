<script setup lang="ts">
import { computed } from 'vue';
import { useAdmin } from '~/stores/admin';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();

const roleLabel = computed(() => {
  switch (admin.me?.role) {
    case 'SUPER':
      return '超级管理员';
    case 'TECHNICIAN':
      return '技术员';
    default:
      return '策划';
  }
});
</script>

<template>
  <div class="mx-auto max-w-xl">
    <h1 class="text-xl font-bold" style="font-family: var(--font-display)">个人资料</h1>
    <p class="mt-1 text-sm text-ink-faint">查看当前登录账号的信息。</p>

    <section class="paper-card mt-6 overflow-hidden">
      <div class="flex items-center gap-4 border-b border-rule px-5 py-5">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-full bg-orange/15 text-lg font-bold text-orange-deep"
        >
          {{ (admin.me?.displayName || admin.me?.username || '?').charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ admin.me?.displayName || admin.me?.username }}</p>
          <p class="mt-0.5 text-sm text-ink-faint">{{ roleLabel }}</p>
        </div>
      </div>
      <dl class="divide-y divide-rule text-sm">
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <dt class="text-ink-faint">显示名称</dt>
          <dd class="text-right font-medium">{{ admin.me?.displayName || '未设置' }}</dd>
        </div>
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <dt class="text-ink-faint">用户名</dt>
          <dd class="font-mono text-right">{{ admin.me?.username }}</dd>
        </div>
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <dt class="text-ink-faint">角色</dt>
          <dd class="text-right">{{ roleLabel }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
