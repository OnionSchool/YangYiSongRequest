<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { listAudit, type AuditEntry } from '~/lib/adminApi';

definePageMeta({ layout: 'admin' });

const entries = ref<AuditEntry[]>([]);
const page = ref(1);
const total = ref(0);
const pageSize = ref(30);
const loading = ref(false);
const error = ref<string | null>(null);

const actionLabels: Record<string, string> = {
  login: '登录后台',
  logout: '退出登录',
  'password.change': '修改密码',
  'email.bind': '绑定邮箱',
  'request.schedule': '安排播出',
  'request.reject': '驳回点歌',
  'request.manual': '手动添加点歌',
  'request.batch': '批量处理点歌',
  'request.playback': '更新播放状态',
  'schedule.reorder': '调整播放顺序',
  'schedule.remove': '取消排期',
  'user.create': '创建账号',
  'user.update': '更新账号',
  'config.site': '修改站点设置',
  'config.slots': '修改播出时段',
  'config.schedule-rules': '修改排期规则',
  'config.calendar': '修改行政历',
  'config.grades': '修改年级配置',
  'config.words': '修改敏感词',
  'config.downloads': '修改下载配置',
  'meting.create': '添加 Meting API',
  'meting.update': '编辑 Meting API',
  'meting.delete': '删除 Meting API',
};

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatDetail(detail: unknown) {
  if (!detail) return '';
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

async function load(nextPage = page.value) {
  loading.value = true;
  error.value = null;
  try {
    const result = await listAudit(nextPage);
    entries.value = result.items;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">操作日志</h1>
        <p class="mt-1 text-sm text-ink-faint">
          记录后台操作、操作者、IP 和设备信息；日志保留 90 天。
        </p>
      </div>
      <button
        class="btn-secondary px-3 py-2 text-xs disabled:opacity-50"
        :disabled="loading"
        @click="load()"
      >
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div
      v-if="error"
      class="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>
    <div
      v-else-if="loading && entries.length === 0"
      class="py-16 text-center text-sm text-ink-faint"
    >
      加载中…
    </div>
    <div
      v-else-if="entries.length === 0"
      class="paper-card mt-5 py-12 text-center text-sm text-ink-faint"
    >
      暂无操作日志
    </div>

    <div v-else class="paper-card mt-5 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-[860px] w-full text-left text-sm">
          <thead class="border-b border-rule bg-paper-deep/25 text-xs text-ink-faint">
            <tr>
              <th class="px-4 py-3 font-medium">时间</th>
              <th class="px-4 py-3 font-medium">操作者</th>
              <th class="px-4 py-3 font-medium">操作</th>
              <th class="px-4 py-3 font-medium">IP 地址</th>
              <th class="px-4 py-3 font-medium">设备信息</th>
              <th class="px-4 py-3 font-medium">内容</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-rule">
            <tr v-for="entry in entries" :key="entry.id" class="align-top hover:bg-paper-deep/10">
              <td class="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">
                {{ new Date(entry.createdAt).toLocaleString() }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 font-medium">{{ entry.actor }}</td>
              <td class="whitespace-nowrap px-4 py-3">
                {{ actionLabels[entry.action] ?? entry.action }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 font-mono text-xs">{{ entry.ip }}</td>
              <td class="max-w-52 px-4 py-3 text-xs text-ink-faint">
                <span class="line-clamp-2" :title="entry.userAgent">{{ entry.userAgent }}</span>
              </td>
              <td class="max-w-64 px-4 py-3 text-xs text-ink-faint">
                <span v-if="entry.targetId" class="mr-1 font-mono">{{ entry.targetId }}</span
                ><span :title="formatDetail(entry.detail)">{{ formatDetail(entry.detail) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-rule px-4 py-3 text-sm">
        <span class="text-ink-faint">共 {{ total }} 条</span>
        <div class="flex items-center gap-3">
          <button
            class="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
            :disabled="page <= 1 || loading"
            @click="load(page - 1)"
          >
            上一页
          </button>
          <span class="text-xs text-ink-faint">{{ page }} / {{ totalPages }}</span>
          <button
            class="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
            :disabled="page >= totalPages || loading"
            @click="load(page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
