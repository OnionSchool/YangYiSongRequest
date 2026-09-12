<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { isoDate } from '~/lib/time';
import {
  listRequests,
  readDay,
  rejectRequest,
  scheduleRequest,
  unscheduleRequest,
  type AdminDaySlot,
  type AdminRequest,
} from '~/lib/adminApi';

definePageMeta({ layout: 'admin' });

const items = ref<AdminRequest[]>([]);
const total = ref(0);
const page = ref(1);
const statusFilter = ref('PENDING');
const loading = ref(false);
const error = ref<string | null>(null);

// reject dialog
const rejectTarget = ref<AdminRequest | null>(null);
const rejectReason = ref('');
const rejecting = ref(false);

const scheduleTarget = ref<AdminRequest | null>(null);
const scheduleDate = ref(isoDate(new Date()));
const scheduleSlotId = ref('');
const scheduleSlots = ref<AdminDaySlot[]>([]);
const scheduling = ref(false);
const scheduleLoading = ref(false);
const unschedulingId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await listRequests({ status: statusFilter.value, page: page.value });
    items.value = res.items;
    total.value = res.total;
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function filterBy(status: string) {
  statusFilter.value = status;
  page.value = 1;
  load();
}

async function doReject() {
  if (!rejectTarget.value) return;
  rejecting.value = true;
  try {
    await rejectRequest(rejectTarget.value.id, rejectReason.value);
    rejectTarget.value = null;
    rejectReason.value = '';
    await load();
  } catch (e: any) {
    error.value = e.message ?? '驳回失败';
  } finally {
    rejecting.value = false;
  }
}

async function loadScheduleSlots() {
  scheduleLoading.value = true;
  try {
    const day = await readDay(scheduleDate.value);
    scheduleSlots.value = day.slots;
    scheduleSlotId.value = scheduleSlots.value[0]?.slotId ?? '';
  } catch (e: any) {
    error.value = e.message ?? '加载播出时段失败';
  } finally {
    scheduleLoading.value = false;
  }
}

function openSchedule(item: AdminRequest) {
  scheduleTarget.value = item;
  scheduleDate.value = isoDate(new Date());
  scheduleSlotId.value = '';
  void loadScheduleSlots();
}

async function doSchedule() {
  if (!scheduleTarget.value || !scheduleSlotId.value) return;
  scheduling.value = true;
  try {
    await scheduleRequest(scheduleTarget.value.id, scheduleDate.value, scheduleSlotId.value);
    scheduleTarget.value = null;
    await load();
  } catch (e: any) {
    error.value = e.message ?? '排期失败';
  } finally {
    scheduling.value = false;
  }
}

async function doUnschedule(item: AdminRequest) {
  if (!confirm(`确定撤回「${item.title}」的排期？歌曲会回到待审核列表。`)) return;
  unschedulingId.value = item.id;
  try {
    await unscheduleRequest(item.id);
    await load();
  } catch (e: any) {
    error.value = e.message ?? '撤回排期失败';
  } finally {
    unschedulingId.value = null;
  }
}

function formatDuration(ms: number) {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

onMounted(load);
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">审核管理</h1>
        <p class="text-sm text-ink-faint mt-0.5">审核学生的点歌请求</p>
      </div>
      <span v-if="total > 0" class="text-sm text-ink-faint">共 {{ total }} 条</span>
    </div>

    <!-- Filter tabs -->
    <div class="flex items-center gap-1 mb-5 p-1 rounded-lg bg-paper-deep/30 w-fit">
      <button
        v-for="s in [
          { key: 'PENDING', label: '待审核' },
          { key: 'SCHEDULED', label: '已排期' },
          { key: 'REJECTED', label: '已驳回' },
          { key: '', label: '全部' },
        ]"
        :key="s.key"
        class="rounded-md px-3.5 py-1.5 text-sm transition-all"
        :class="
          statusFilter === s.key
            ? 'bg-paper shadow-sm font-medium text-ink'
            : 'text-ink-soft hover:text-ink'
        "
        @click="filterBy(s.key)"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Error -->
    <div
      v-if="error"
      class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">加载中…</span>
    </div>

    <!-- List -->
    <div v-else class="space-y-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="paper-card p-4 transition hover:border-orange/30"
      >
        <div class="flex items-start gap-3">
          <img
            v-if="item.coverUrl"
            :src="item.coverUrl"
            class="h-12 w-12 rounded-lg object-cover shadow-sm"
            loading="lazy"
          />
          <div
            v-else
            class="flex h-12 w-12 items-center justify-center rounded-lg bg-paper-deep/30 text-lg"
          >
            🎵
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ item.title }}</span>
              <span
                class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-paper-deep/40 text-ink-faint font-medium uppercase"
              >
                {{ item.source }}
              </span>
            </div>
            <p class="text-sm text-ink-soft truncate mt-0.5">{{ item.artist }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
              <span class="font-mono">{{ formatDuration(item.durationMs) }}</span>
              <span v-if="item.requester" class="flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {{ item.requester }}
              </span>
              <span
                v-for="word in item.flaggedWords"
                :key="word"
                class="text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md font-medium"
              >
                {{ word }}
              </span>
            </div>
          </div>
          <!-- Actions -->
          <div v-if="item.status === 'PENDING'" class="flex gap-1.5 shrink-0 self-center">
            <button
              class="rounded-lg bg-orange px-3 py-1.5 text-sm font-medium text-[#2b1d14] hover:bg-orange-deep hover:text-white transition-colors"
              @click="openSchedule(item)"
            >
              通过并排期
            </button>
            <button
              class="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              @click="
                rejectTarget = item;
                rejectReason = '';
              "
            >
              驳回
            </button>
          </div>
          <div v-else class="flex shrink-0 self-center items-center gap-2">
            <span
              class="text-xs px-2 py-1 rounded-md font-medium"
              :class="{
                'bg-green-50 text-green-700 border border-green-200': item.status === 'SCHEDULED',
                'bg-red-50 text-red-600 border border-red-200': item.status === 'REJECTED',
                'bg-blue-50 text-blue-700 border border-blue-200': item.status === 'PLAYED',
              }"
            >
              {{
                item.status === 'SCHEDULED'
                  ? '已排期'
                  : item.status === 'REJECTED'
                    ? '已驳回'
                    : item.status
              }}
            </span>
            <button
              v-if="item.status === 'SCHEDULED'"
              class="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              :disabled="unschedulingId === item.id"
              @click="doUnschedule(item)"
            >
              {{ unschedulingId === item.id ? '撤回中…' : '撤回排期' }}
            </button>
          </div>
        </div>
        <p v-if="item.rejectReason" class="mt-2 ml-15 text-xs text-red-500">
          驳回理由：{{ item.rejectReason }}
        </p>
        <div
          v-if="item.schedule"
          class="mt-2 ml-15 flex items-center gap-1.5 text-xs text-green-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
          {{ item.schedule.playDate }} · {{ item.schedule.slotName }} · 第{{
            item.schedule.orderNo
          }}首
        </div>
      </div>

      <div
        v-if="items.length === 0"
        class="flex flex-col items-center justify-center py-16 text-ink-faint"
      >
        <span class="text-4xl mb-3">📭</span>
        <p>暂无数据</p>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="total > 20" class="mt-6 flex items-center justify-center gap-3">
      <button
        class="rounded-lg border border-rule px-3 py-1.5 text-sm hover:border-ink-faint disabled:opacity-30 transition-colors"
        :disabled="page <= 1"
        @click="
          page--;
          load();
        "
      >
        ← 上一页
      </button>
      <span class="text-sm text-ink-faint font-mono">{{ page }} / {{ Math.ceil(total / 20) }}</span>
      <button
        class="rounded-lg border border-rule px-3 py-1.5 text-sm hover:border-ink-faint disabled:opacity-30 transition-colors"
        :disabled="page >= Math.ceil(total / 20)"
        @click="
          page++;
          load();
        "
      >
        下一页 →
      </button>
    </div>

    <!-- Reject Dialog -->
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
          v-if="rejectTarget"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          @click.self="rejectTarget = null"
        >
          <div class="w-full max-w-md paper-card p-6 shadow-2xl">
            <div class="flex items-start gap-3 mb-4">
              <img
                v-if="rejectTarget.coverUrl"
                :src="rejectTarget.coverUrl"
                class="h-10 w-10 rounded-lg object-cover"
              />
              <div class="min-w-0 flex-1">
                <h3 class="font-medium truncate">驳回：{{ rejectTarget.title }}</h3>
                <p class="text-sm text-ink-soft truncate">{{ rejectTarget.artist }}</p>
              </div>
            </div>
            <label class="block">
              <span class="text-sm text-ink-soft">驳回理由（选填）</span>
              <textarea
                v-model="rejectReason"
                rows="3"
                class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors"
                placeholder="可留空"
              />
            </label>
            <div class="mt-5 flex justify-end gap-2">
              <button
                class="rounded-lg border border-rule px-4 py-2 text-sm hover:border-ink-faint transition-colors"
                @click="rejectTarget = null"
              >
                取消
              </button>
              <button
                class="rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                :disabled="rejecting"
                @click="doReject"
              >
                {{ rejecting ? '驳回中…' : '确认驳回' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Schedule Dialog -->
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
          v-if="scheduleTarget"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          @click.self="scheduleTarget = null"
        >
          <div class="w-full max-w-md paper-card p-6 shadow-2xl">
            <h3 class="font-medium">通过并排期</h3>
            <p class="mt-1 truncate text-sm text-ink-soft">
              {{ scheduleTarget.title }} · {{ scheduleTarget.artist }}
            </p>
            <label class="mt-5 block">
              <span class="text-sm text-ink-soft">播出日期</span>
              <input
                v-model="scheduleDate"
                type="date"
                class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm"
                @change="loadScheduleSlots"
              />
            </label>
            <label class="mt-4 block">
              <span class="text-sm text-ink-soft">播出时段</span>
              <select
                v-model="scheduleSlotId"
                class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm disabled:opacity-50"
                :disabled="scheduleLoading || scheduleSlots.length === 0"
              >
                <option value="" disabled>
                  {{ scheduleLoading ? '加载时段中…' : '请选择时段' }}
                </option>
                <option v-for="slot in scheduleSlots" :key="slot.slotId" :value="slot.slotId">
                  {{ slot.startTime }}–{{ slot.endTime }} · {{ slot.slotName }}（{{
                    slot.songs.length
                  }}
                  首）
                </option>
              </select>
            </label>
            <p
              v-if="!scheduleLoading && scheduleSlots.length === 0"
              class="mt-2 text-sm text-orange-deep"
            >
              当前没有可用播出时段。
            </p>
            <div class="mt-5 flex justify-end gap-2">
              <button
                class="rounded-lg border border-rule px-4 py-2 text-sm hover:border-ink-faint transition-colors"
                @click="scheduleTarget = null"
              >
                取消
              </button>
              <button
                class="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                :disabled="scheduling || !scheduleSlotId"
                @click="doSchedule"
              >
                {{ scheduling ? '排期中…' : '确认通过' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
