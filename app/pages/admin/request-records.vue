<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { listSongRequestRecords, type SongRequestRecord } from '~/lib/adminApi';

definePageMeta({ layout: 'admin' });

const records = ref<SongRequestRecord[]>([]);
const page = ref(1);
const total = ref(0);
const pageSize = ref(30);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedRecord = ref<SongRequestRecord | null>(null);

const statusLabels: Record<string, string> = {
  PENDING: '待审核',
  SCHEDULED: '已排期',
  REJECTED: '已驳回',
  PLAYED: '已播放',
};
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatDuration(ms: number) {
  if (!ms) return '未知';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function load(nextPage = page.value) {
  loading.value = true;
  error.value = null;
  try {
    const result = await listSongRequestRecords(nextPage);
    records.value = result.items;
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
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">点歌记录</h1>
        <p class="mt-1 text-sm text-ink-faint">
          查看所有点歌提交的歌曲、点歌人、IP 地址和设备信息。
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
      v-else-if="loading && records.length === 0"
      class="py-16 text-center text-sm text-ink-faint"
    >
      加载中…
    </div>
    <div
      v-else-if="records.length === 0"
      class="paper-card mt-5 py-12 text-center text-sm text-ink-faint"
    >
      暂无点歌记录
    </div>

    <div v-else class="paper-card mt-5 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-[960px] w-full text-left text-sm">
          <thead class="border-b border-rule bg-paper-deep/25 text-xs text-ink-faint">
            <tr>
              <th class="px-4 py-3 font-medium">提交时间</th>
              <th class="px-4 py-3 font-medium">歌曲</th>
              <th class="px-4 py-3 font-medium">点歌人</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">IP 地址</th>
              <th class="px-4 py-3 font-medium">设备信息</th>
              <th class="px-4 py-3 font-medium">详情</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-rule">
            <tr v-for="record in records" :key="record.id" class="align-top hover:bg-paper-deep/10">
              <td class="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">
                {{ new Date(record.createdAt).toLocaleString() }}
              </td>
              <td class="max-w-56 px-4 py-3">
                <p class="truncate font-medium">{{ record.title }}</p>
                <p class="mt-0.5 truncate text-xs text-ink-faint">
                  {{ record.artist }} · {{ formatDuration(record.durationMs) }}
                </p>
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                {{ record.isManual ? '后台手动添加' : record.requesterName || '匿名' }}
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                <span
                  class="rounded px-2 py-1 text-xs"
                  :class="
                    record.status === 'REJECTED'
                      ? 'bg-red-50 text-red-700'
                      : record.status === 'SCHEDULED'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-amber-50 text-amber-800'
                  "
                  >{{ statusLabels[record.status] ?? record.status }}</span
                >
              </td>
              <td class="whitespace-nowrap px-4 py-3 font-mono text-xs">{{ record.submitIp }}</td>
              <td class="max-w-52 px-4 py-3 text-xs text-ink-faint">
                <span class="line-clamp-2" :title="record.submitUserAgent ?? '未记录'">{{
                  record.submitUserAgent ?? '未记录'
                }}</span>
              </td>
              <td class="px-4 py-3">
                <button
                  class="rounded-lg border border-rule px-2.5 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink"
                  @click="selectedRecord = record"
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
            上一页</button
          ><span class="text-xs text-ink-faint">{{ page }} / {{ totalPages }}</span
          ><button
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
          v-if="selectedRecord"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          @click.self="selectedRecord = null"
        >
          <section
            class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-rule bg-paper shadow-xl"
          >
            <header class="flex items-center justify-between border-b border-rule px-5 py-4">
              <div>
                <h2 class="font-bold" style="font-family: var(--font-display)">点歌详情</h2>
                <p class="mt-0.5 text-xs text-ink-faint">查询码：{{ selectedRecord.queryCode }}</p>
              </div>
              <button
                class="rounded-lg px-2 py-1 text-lg text-ink-faint hover:bg-paper-deep hover:text-ink"
                aria-label="关闭"
                @click="selectedRecord = null"
              >
                ×
              </button>
            </header>
            <dl class="grid gap-x-5 gap-y-3 p-5 text-sm sm:grid-cols-[7rem_1fr]">
              <dt class="text-ink-faint">歌曲</dt>
              <dd>{{ selectedRecord.title }} · {{ selectedRecord.artist }}</dd>
              <dt class="text-ink-faint">专辑</dt>
              <dd>{{ selectedRecord.album || '未知' }}</dd>
              <dt class="text-ink-faint">音源 / ID</dt>
              <dd class="break-all font-mono text-xs">
                {{ selectedRecord.source }} / {{ selectedRecord.platformId }}
              </dd>
              <dt class="text-ink-faint">点歌人</dt>
              <dd>
                {{
                  selectedRecord.isManual ? '后台手动添加' : selectedRecord.requesterName || '匿名'
                }}<template v-if="selectedRecord.grade && selectedRecord.classNo"
                  >（{{ selectedRecord.grade }} {{ selectedRecord.classNo }} 班）</template
                >
              </dd>
              <dt class="text-ink-faint">提交 IP</dt>
              <dd class="font-mono text-xs">{{ selectedRecord.submitIp }}</dd>
              <dt class="text-ink-faint">设备信息</dt>
              <dd class="break-all text-xs text-ink-soft">
                {{ selectedRecord.submitUserAgent ?? '旧记录未保存设备信息' }}
              </dd>
              <dt class="text-ink-faint">处理状态</dt>
              <dd>{{ statusLabels[selectedRecord.status] ?? selectedRecord.status }}</dd>
              <dt v-if="selectedRecord.rejectReason" class="text-ink-faint">驳回原因</dt>
              <dd v-if="selectedRecord.rejectReason">{{ selectedRecord.rejectReason }}</dd>
            </dl>
            <footer class="flex justify-end border-t border-rule px-5 py-3">
              <button class="btn-secondary px-4 py-2 text-sm" @click="selectedRecord = null">
                关闭
              </button>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
