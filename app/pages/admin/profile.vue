<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAdmin } from '~/stores/admin';
import {
  readDownloadPreference,
  saveDownloadPreference,
  type DownloadPreference,
} from '~/lib/download-preference';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();
const downloadPreference = ref<DownloadPreference>('download');

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

function savePreference() {
  if (admin.me?.username) saveDownloadPreference(admin.me.username, downloadPreference.value);
}

onMounted(() => {
  if (admin.me?.username) {
    downloadPreference.value = readDownloadPreference(admin.me.username) ?? 'download';
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

    <section class="paper-card mt-6 overflow-hidden">
      <div class="border-b border-rule px-5 py-4">
        <h2 class="font-medium">下载设置</h2>
        <p class="mt-1 text-sm text-ink-faint">此设置仅保存在当前浏览器和账号中。</p>
      </div>
      <div class="space-y-3 px-5 py-4">
        <label class="flex cursor-pointer gap-3 rounded-lg border border-rule p-3">
          <input
            v-model="downloadPreference"
            value="download"
            type="radio"
            class="mt-1 accent-orange-deep"
            @change="savePreference"
          />
          <span
            ><span class="block text-sm font-medium">下载</span
            ><span class="mt-1 block text-xs text-ink-faint"
              >直接保存到浏览器默认下载目录。</span
            ></span
          >
        </label>
        <label class="flex cursor-pointer gap-3 rounded-lg border border-rule p-3">
          <input
            v-model="downloadPreference"
            value="saveAs"
            type="radio"
            class="mt-1 accent-orange-deep"
            @change="savePreference"
          />
          <span
            ><span class="block text-sm font-medium">另存为</span
            ><span class="mt-1 block text-xs text-ink-faint">下载前选择保存位置。</span></span
          >
        </label>
      </div>
    </section>
  </div>
</template>
