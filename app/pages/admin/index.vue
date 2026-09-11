<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAdmin } from '~/stores/admin';
import { listRequests } from '~/lib/adminApi';
import { isoDate } from '~/lib/time';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();

const pendingCount = ref(0);
const todayCount = ref(0);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const today = isoDate(new Date());
    const [pending, todayRes] = await Promise.all([
      listRequests({ status: 'PENDING', page: 1 }),
      listRequests({ date: today, page: 1 }),
    ]);
    pendingCount.value = pending.total;
    todayCount.value = todayRes.total;
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1" style="font-family: var(--font-display)">仪表盘</h1>
    <p class="text-sm text-ink-faint mb-6">欢迎回来，{{ admin.me?.username }}</p>

    <!-- Change password warning -->
    <div
      v-if="admin.me?.mustChangePassword"
      class="mb-6 paper-card border-orange/40 p-4 flex items-start gap-3"
    >
      <span class="text-xl mt-0.5">⚠️</span>
      <div>
        <p class="text-sm font-medium">首次登录请修改默认密码</p>
        <NuxtLink
          to="/admin/password"
          class="mt-1 inline-block text-sm text-orange-deep font-medium hover:underline"
        >
          立即修改 →
        </NuxtLink>
      </div>
    </div>

    <!-- Stats cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <NuxtLink to="/admin/review" class="paper-card p-5 hover:border-orange/40 transition group">
        <div class="flex items-center justify-between">
          <span class="text-2xl">📋</span>
          <span
            v-if="!loading && pendingCount > 0"
            class="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange/20 px-1.5 text-xs font-bold text-orange-deep"
          >
            {{ pendingCount }}
          </span>
        </div>
        <p class="text-2xl font-bold mt-3">{{ loading ? '…' : pendingCount }}</p>
        <p class="text-sm text-ink-soft mt-0.5">待审核点歌</p>
      </NuxtLink>

      <NuxtLink to="/admin/schedule" class="paper-card p-5 hover:border-orange/40 transition group">
        <span class="text-2xl">📅</span>
        <p class="text-2xl font-bold mt-3">{{ loading ? '…' : todayCount }}</p>
        <p class="text-sm text-ink-soft mt-0.5">今日请求</p>
      </NuxtLink>

      <NuxtLink
        v-if="admin.isSuper"
        to="/admin/config"
        class="paper-card p-5 hover:border-orange/40 transition group"
      >
        <span class="text-2xl">⚙️</span>
        <p class="font-medium mt-3">站点设置</p>
        <p class="text-xs text-ink-faint mt-0.5">时段 · 年级 · 屏蔽词</p>
      </NuxtLink>

      <NuxtLink
        v-if="admin.isSuper"
        to="/admin/calendar"
        class="paper-card p-5 hover:border-orange/40 transition group"
      >
        <span class="text-2xl">🗓️</span>
        <p class="font-medium mt-3">行政历</p>
        <p class="text-xs text-ink-faint mt-0.5">上学 · 放假 · 考试</p>
      </NuxtLink>
    </div>

    <!-- Quick links -->
    <div class="paper-card p-5">
      <h2 class="text-sm font-semibold text-ink-soft mb-3">快捷操作</h2>
      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-for="link in [
            { to: '/admin/review?status=PENDING', label: '处理待审核' },
            { to: '/admin/schedule', label: '查看今日排期' },
            { to: '/admin/sources', label: '检测音源' },
          ]"
          :key="link.to"
          :to="link.to"
          class="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
        >
          {{ link.label }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
