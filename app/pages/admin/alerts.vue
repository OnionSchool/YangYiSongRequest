<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiFetch } from '~/lib/api';

interface Alert {
  id: string;
  level: string;
  message: string;
  detail: unknown;
  createdAt: string;
}

definePageMeta({ layout: 'admin' });

const alerts = ref<Alert[]>([]);
const error = ref<string | null>(null);
const resolvingId = ref<string | null>(null);

async function load() {
  try {
    alerts.value = await apiFetch<Alert[]>('/api/admin/alerts');
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  }
}

async function resolve(id: string) {
  if (resolvingId.value) return;
  resolvingId.value = id;
  error.value = null;
  try {
    await apiFetch(`/api/admin/alerts/${id}/resolve`, { method: 'PUT' });
    alerts.value = alerts.value.filter((alert) => alert.id !== id);
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  } finally {
    resolvingId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="mb-1 text-xl font-bold" style="font-family: var(--font-display)">系统告警</h1>
    <p class="mb-6 text-sm text-ink-faint">下载、缓存和音源异常会记录在这里。</p>
    <div
      v-if="error"
      class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>
    <div v-if="alerts.length === 0" class="paper-card py-12 text-center text-sm text-ink-faint">
      暂无未处理告警
    </div>
    <div v-else class="space-y-3">
      <article v-for="alert in alerts" :key="alert.id" class="paper-card p-4">
        <div class="flex items-start gap-3">
          <span
            class="rounded px-2 py-1 text-xs"
            :class="
              alert.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'
            "
            >{{ alert.level === 'error' ? '错误' : '警告' }}</span
          >
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ alert.message }}</p>
            <pre v-if="alert.detail" class="mt-2 overflow-auto text-xs text-ink-faint">{{
              JSON.stringify(alert.detail, null, 2)
            }}</pre>
            <p class="mt-2 text-xs text-ink-faint">
              {{ new Date(alert.createdAt).toLocaleString() }}
            </p>
          </div>
          <button
            class="btn-secondary px-3 py-1.5 text-xs"
            :disabled="resolvingId === alert.id"
            @click="resolve(alert.id)"
          >
            {{ resolvingId === alert.id ? '处理中…' : '标记已处理' }}
          </button>
        </div>
      </article>
    </div>
  </div>
</template>
