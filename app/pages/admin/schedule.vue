<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  readDay,
  unscheduleRequest,
  updatePlaybackStatus,
  songDownloadUrl,
  dayZipUrl,
  type AdminDaySlot,
} from '~/lib/adminApi';
import { useAdmin } from '~/stores/admin';
import { isoDate, shiftDate } from '~/lib/time';

definePageMeta({ layout: 'admin' });

const today = isoDate(new Date());
const selectedDate = ref(today);
const slots = ref<AdminDaySlot[]>([]);
const version = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const unschedulingId = ref<string | null>(null);
const admin = useAdmin();

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const day = await readDay(selectedDate.value);
    slots.value = day.slots;
    version.value = day.version;
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

async function doUnschedule(requestId: string) {
  if (!confirm('确定取消排期？')) return;
  unschedulingId.value = requestId;
  try {
    const result = await unscheduleRequest(requestId, version.value);
    version.value = result.version;
    await load();
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  } finally {
    unschedulingId.value = null;
  }
}

async function setPlaybackStatus(id: string, status: 'DOWNLOADED' | 'PLAYED' | 'PLAYBACK_ERROR') {
  try {
    await updatePlaybackStatus(id, status);
    await load();
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  }
}

const playbackLabels = {
  PENDING_DOWNLOAD: '待下载',
  DOWNLOADED: '已下载',
  PLAYED: '已播放',
  PLAYBACK_ERROR: '播放异常',
};

function prevDay() {
  selectedDate.value = shiftDate(selectedDate.value, -1);
  load();
}

function nextDay() {
  selectedDate.value = shiftDate(selectedDate.value, 1);
  load();
}

function formatDuration(ms: number) {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatMs(ms: number) {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${s}秒`;
}

const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function dateLabel(d: string) {
  const dt = new Date(d + 'T00:00:00+08:00');
  return weekday[dt.getDay()];
}

onMounted(load);
</script>

<template>
  <div>
    <!-- Page header -->
    <h1 class="text-xl font-bold mb-1" style="font-family: var(--font-display)">排期管理</h1>
    <p class="text-sm text-ink-faint mb-6">管理每日播出歌单</p>

    <!-- Date navigation -->
    <div class="flex items-center gap-2 mb-6">
      <button
        class="rounded-lg border border-rule p-2 hover:border-ink-faint transition-colors"
        @click="prevDay"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <a
        v-if="admin.me?.role === 'TECHNICIAN' || admin.isSuper"
        :href="dayZipUrl(selectedDate)"
        class="ml-auto rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft hover:border-ink-faint"
        >下载当天 ZIP</a
      >
      <div class="paper-card flex items-center gap-3 px-4 py-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-ink-faint"
        >
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
        <input
          v-model="selectedDate"
          type="date"
          class="bg-transparent text-sm font-medium outline-none"
          @change="load()"
        />
        <span class="text-xs text-ink-faint">{{ dateLabel(selectedDate) }}</span>
      </div>
      <button
        class="rounded-lg border border-rule p-2 hover:border-ink-faint transition-colors"
        @click="nextDay"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <button
        v-if="selectedDate !== today"
        class="rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft hover:border-ink-faint transition-colors"
        @click="
          selectedDate = today;
          load();
        "
      >
        今天
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

    <!-- Slots -->
    <div v-else class="space-y-4">
      <div v-for="slot in slots" :key="slot.slotId" class="paper-card overflow-hidden">
        <!-- Slot header -->
        <div
          class="flex items-center justify-between px-5 py-3 bg-paper-deep/20 border-b border-rule"
        >
          <div class="flex items-center gap-3">
            <span class="text-lg">🎙️</span>
            <div>
              <span class="font-medium">{{ slot.slotName }}</span>
              <span class="ml-2 text-sm text-ink-faint font-mono"
                >{{ slot.startTime }} – {{ slot.endTime }}</span
              >
            </div>
          </div>
          <div class="flex items-center gap-3 text-sm text-ink-faint">
            <span>{{ slot.songs.length }}首</span>
            <span
              v-if="slot.maxCount"
              :class="slot.songs.length > slot.maxCount ? 'text-red-500 font-medium' : ''"
            >
              / {{ slot.maxCount }}上限
            </span>
            <span class="text-xs font-mono bg-paper-deep/40 px-2 py-0.5 rounded">{{
              formatMs(slot.totalMs)
            }}</span>
          </div>
        </div>

        <!-- Empty -->
        <div v-if="slot.songs.length === 0" class="px-5 py-8 text-center text-ink-faint text-sm">
          <span class="text-2xl block mb-2">🎶</span>
          暂无排期歌曲
        </div>

        <!-- Song list -->
        <div v-else class="divide-y divide-rule">
          <div
            v-for="(song, index) in slot.songs"
            :key="song.id"
            class="flex items-center gap-3 px-5 py-3 hover:bg-paper-deep/10 transition-colors"
          >
            <span class="w-6 text-center text-sm font-mono text-ink-faint">{{ index + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ song.title }}</p>
              <p class="truncate text-xs text-ink-faint">
                {{ song.playTime }} · {{ song.artist }} · {{ formatDuration(song.durationMs) }}
              </p>
            </div>
            <span class="rounded bg-paper-deep/40 px-2 py-1 text-xs">{{
              playbackLabels[song.playbackStatus]
            }}</span>
            <a
              v-if="admin.me?.role === 'TECHNICIAN' || admin.isSuper"
              :href="songDownloadUrl(song.id)"
              class="shrink-0 rounded-lg border border-rule px-2.5 py-1 text-xs"
              >下载</a
            >
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                song.playbackStatus === 'PENDING_DOWNLOAD'
              "
              class="shrink-0 rounded-lg border border-rule px-2.5 py-1 text-xs"
              @click="setPlaybackStatus(song.id, 'DOWNLOADED')"
            >
              标为已下载
            </button>
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                song.playbackStatus !== 'PLAYED'
              "
              class="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600"
              @click="setPlaybackStatus(song.id, 'PLAYBACK_ERROR')"
            >
              异常
            </button>
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                song.playbackStatus === 'DOWNLOADED'
              "
              class="shrink-0 rounded-lg border border-green-200 px-2.5 py-1 text-xs text-green-700"
              @click="setPlaybackStatus(song.id, 'PLAYED')"
            >
              标为已播放
            </button>
            <button
              v-if="admin.me?.role === 'PLANNER' || admin.isSuper"
              class="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              :disabled="unschedulingId === song.id"
              @click="doUnschedule(song.id)"
            >
              {{ unschedulingId === song.id ? '撤回中…' : '撤回排期' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="slots.length === 0"
        class="flex flex-col items-center justify-center py-16 text-ink-faint"
      >
        <span class="text-4xl mb-3">📻</span>
        <p>没有配置播出时段</p>
        <NuxtLink to="/admin/config" class="mt-2 text-sm text-orange-deep hover:underline"
          >前往配置 →</NuxtLink
        >
      </div>
    </div>
  </div>
</template>
