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
const selectedEntry = ref<AuditEntry | null>(null);

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
  return typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
}

function openDetail(entry: AuditEntry) {
  selectedEntry.value = entry;
}

function closeDetail() {
  selectedEntry.value = null;
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
              <td class="px-4 py-3">
                <button
                  class="rounded-lg border border-rule px-2.5 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink"
                  @click="openDetail(entry)"
                >
                  查看详情
                </button>
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

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="selectedEntry"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          @click.self="closeDetail"
        >
          <section
            class="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-rule bg-paper shadow-xl"
          >
            <header class="flex items-center justify-between border-b border-rule px-5 py-4">
              <div>
                <h2 class="font-bold" style="font-family: var(--font-display)">操作详情</h2>
                <p class="mt-0.5 text-xs text-ink-faint">
                  {{ actionLabels[selectedEntry.action] ?? selectedEntry.action }} ·
                  {{ new Date(selectedEntry.createdAt).toLocaleString() }}
                </p>
              </div>
              <button
                class="rounded-lg px-2 py-1 text-lg text-ink-faint hover:bg-paper-deep hover:text-ink"
                aria-label="关闭"
                @click="closeDetail"
              >
                ×
              </button>
            </header>
            <div class="max-h-[calc(80vh-8rem)] space-y-4 overflow-y-auto p-5 text-sm">
              <dl class="grid gap-x-5 gap-y-3 sm:grid-cols-[6rem_1fr]">
                <dt class="text-ink-faint">操作者</dt>
                <dd>{{ selectedEntry.actor }}</dd>
                <dt class="text-ink-faint">IP 地址</dt>
                <dd class="font-mono text-xs">{{ selectedEntry.ip }}</dd>
                <dt class="text-ink-faint">设备信息</dt>
                <dd class="break-all text-xs text-ink-soft">{{ selectedEntry.userAgent }}</dd>
                <dt v-if="selectedEntry.targetId" class="text-ink-faint">目标 ID</dt>
                <dd v-if="selectedEntry.targetId" class="break-all font-mono text-xs">
                  {{ selectedEntry.targetId }}
                </dd>
              </dl>
              <div v-if="selectedEntry.detail">
                <p class="mb-2 text-sm text-ink-faint">操作内容</p>
                <pre
                  class="max-h-72 overflow-auto rounded-lg bg-paper-deep/50 p-3 text-xs leading-5 text-ink-soft whitespace-pre-wrap break-all"
                  >{{ formatDetail(selectedEntry.detail) }}</pre>
              </div>
              <p v-else class="text-sm text-ink-faint">本次操作没有额外内容。</p>
            </div>
            <footer class="flex justify-end border-t border-rule px-5 py-3">
              <button class="btn-secondary px-4 py-2 text-sm" @click="closeDetail">关闭</button>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
