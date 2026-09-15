<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import {
  readDay,
  unscheduleRequest,
  updatePlaybackStatus,
  downloadDayZip,
  downloadSong,
  saveSongsAs,
  type AdminDaySlot,
} from '~/lib/adminApi';
import { useAdmin } from '~/stores/admin';
import { isoDate, shiftDate } from '~/lib/time';
import {
  readDownloadPreference,
  saveDownloadPreference,
  type DownloadPreference,
} from '~/lib/download-preference';

definePageMeta({ layout: 'admin' });

const today = isoDate(new Date());
const selectedDate = ref(today);
const slots = ref<AdminDaySlot[]>([]);
const version = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const downloadNotice = ref<string | null>(null);
const downloadingSongId = ref<string | null>(null);
const downloadingDay = ref(false);
const downloadingBatch = ref(false);
const selectedSongIds = ref<string[]>([]);
const batchProgress = ref<{ current: number; total: number } | null>(null);
const pendingDownloadIds = ref<string[] | null>(null);
const selectedDownloadMode = ref<DownloadPreference>('download');
const rememberDownloadMode = ref(false);
const unschedulingId = ref<string | null>(null);
const pendingUnscheduleId = ref<string | null>(null);
const admin = useAdmin();

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const day = await readDay(selectedDate.value);
    slots.value = day.slots;
    version.value = day.version;
    selectedSongIds.value = [];
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function hasDayEnded(): boolean {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const latestEnd = Math.max(
    ...slots.value.map((slot) => {
      const start = minutes(slot.startTime);
      const end = minutes(slot.endTime);
      return end <= start ? end + 24 * 60 : end;
    })
  );
  return Number.isFinite(latestEnd) && nowMinutes >= latestEnd;
}

function requestUnschedule(requestId: string) {
  pendingUnscheduleId.value = requestId;
}

function closeUnscheduleDialog() {
  if (!unschedulingId.value) pendingUnscheduleId.value = null;
}

async function doUnschedule() {
  const requestId = pendingUnscheduleId.value;
  if (!requestId) return;
  unschedulingId.value = requestId;
  try {
    const result = await unscheduleRequest(requestId, version.value);
    version.value = result.version;
    await load();
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  } finally {
    unschedulingId.value = null;
    pendingUnscheduleId.value = null;
  }
}

async function setPlaybackStatus(
  id: string,
  status: 'PENDING_DOWNLOAD' | 'DOWNLOADED' | 'PLAYED' | 'PLAYBACK_ERROR'
) {
  try {
    await updatePlaybackStatus(id, status);
    await load();
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  }
}

async function performDownloads(ids: string[], mode: DownloadPreference) {
  error.value = null;
  if (ids.length === 1) {
    downloadNotice.value = '正在准备音频，首次下载可能需要一点时间…';
    downloadingSongId.value = ids[0];
  } else {
    downloadingBatch.value = true;
  }
  try {
    for (const [index, id] of ids.entries()) {
      if (ids.length > 1) {
        batchProgress.value = { current: index + 1, total: ids.length };
        downloadNotice.value = `正在准备第 ${index + 1}/${ids.length} 首音频…`;
      }
      if (mode === 'download') await downloadSong(id);
      else {
        await saveSongsAs(ids.slice(index));
        break;
      }
    }
    downloadNotice.value =
      ids.length === 1 ? '音频已开始下载。' : `${ids.length} 首音频已开始下载。`;
    if (ids.length > 1) selectedSongIds.value = [];
  } catch (e: any) {
    error.value = e.message ?? '下载失败';
    downloadNotice.value = null;
  } finally {
    downloadingSongId.value = null;
    downloadingBatch.value = false;
    batchProgress.value = null;
  }
}

function requestDownload(ids: string[]) {
  const username = admin.me?.username;
  const preference = username ? readDownloadPreference(username) : null;
  if (preference) {
    void performDownloads(ids, preference);
    return;
  }
  selectedDownloadMode.value = 'download';
  rememberDownloadMode.value = false;
  pendingDownloadIds.value = ids;
}

function downloadSongFile(id: string) {
  requestDownload([id]);
}

function downloadSelectedSongs() {
  if (selectedSongIds.value.length) requestDownload([...selectedSongIds.value]);
}

function closeDownloadDialog() {
  pendingDownloadIds.value = null;
}

function confirmDownloadMode() {
  const ids = pendingDownloadIds.value;
  if (!ids?.length) return;
  if (rememberDownloadMode.value && admin.me?.username) {
    saveDownloadPreference(admin.me.username, selectedDownloadMode.value);
  }
  pendingDownloadIds.value = null;
  void performDownloads(ids, selectedDownloadMode.value);
}

async function downloadDayFile() {
  error.value = null;
  downloadNotice.value = '正在准备当天音频和 ZIP 文件，请勿关闭此页面…';
  downloadingDay.value = true;
  try {
    await downloadDayZip(selectedDate.value);
    downloadNotice.value = '当天 ZIP 已开始下载。';
  } catch (e: any) {
    error.value = e.message ?? '下载失败';
    downloadNotice.value = null;
  } finally {
    downloadingDay.value = false;
  }
}

const playbackLabels = {
  PENDING_DOWNLOAD: '待下载',
  DOWNLOADED: '已下载',
  PLAYED: '已播放',
  PLAYBACK_ERROR: '播放异常',
};

const playbackStatusClasses = {
  PENDING_DOWNLOAD: 'border border-amber-200 bg-amber-50 text-amber-800',
  DOWNLOADED: 'border border-blue-200 bg-blue-50 text-blue-700',
  PLAYED: 'border border-green-200 bg-green-50 text-green-700',
  PLAYBACK_ERROR: 'border border-red-300 bg-red-50 font-medium text-red-700',
};

const canDownload = computed(() => admin.me?.role === 'TECHNICIAN' || admin.isSuper);
const allSongIds = computed(() => slots.value.flatMap((slot) => slot.songs.map((song) => song.id)));
const allSongsSelected = computed(
  () =>
    allSongIds.value.length > 0 &&
    allSongIds.value.every((id) => selectedSongIds.value.includes(id))
);
const isDownloading = computed(
  () => Boolean(downloadingSongId.value) || downloadingDay.value || downloadingBatch.value
);

function toggleAllSongs() {
  selectedSongIds.value = allSongsSelected.value ? [] : [...allSongIds.value];
}

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

onMounted(async () => {
  await load();
  if (hasDayEnded()) {
    selectedDate.value = shiftDate(today, 1);
    await load();
  }
});
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
      <button
        v-if="canDownload"
        type="button"
        class="ml-auto rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft hover:border-ink-faint disabled:cursor-wait disabled:opacity-60"
        :disabled="isDownloading"
        @click="downloadDayFile"
      >
        {{ downloadingDay ? '正在准备 ZIP…' : '下载当天 ZIP' }}
      </button>
      <button
        v-if="canDownload"
        type="button"
        class="rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft hover:border-ink-faint disabled:cursor-wait disabled:opacity-60"
        :disabled="isDownloading || !selectedSongIds.length"
        @click="downloadSelectedSongs"
      >
        {{
          downloadingBatch && batchProgress
            ? `正在下载 ${batchProgress.current}/${batchProgress.total}`
            : `下载已选 ${selectedSongIds.length} 首`
        }}
      </button>
      <button
        v-if="canDownload && allSongIds.length"
        type="button"
        class="rounded-lg border border-rule px-3 py-2 text-xs text-ink-soft hover:border-ink-faint disabled:cursor-wait disabled:opacity-60"
        :disabled="isDownloading"
        @click="toggleAllSongs"
      >
        {{ allSongsSelected ? '取消全选' : '全选歌曲' }}
      </button>
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
    <div
      v-if="downloadNotice"
      class="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
    >
      <span
        v-if="isDownloading"
        class="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
      />
      {{ downloadNotice }}
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
            <input
              v-if="canDownload"
              v-model="selectedSongIds"
              :value="song.id"
              type="checkbox"
              class="h-4 w-4 shrink-0 accent-orange-deep"
              :disabled="isDownloading"
              :aria-label="`选择《${song.title}》`"
            />
            <span class="w-6 text-center text-sm font-mono text-ink-faint">{{ index + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ song.title }}</p>
              <p class="truncate text-xs text-ink-faint">
                {{ song.playTime }} · {{ song.artist }} · {{ formatDuration(song.durationMs) }}
              </p>
            </div>
            <span
              class="rounded px-2 py-1 text-xs"
              :class="playbackStatusClasses[song.playbackStatus]"
            >
              {{ playbackLabels[song.playbackStatus] }}
            </span>
            <button
              v-if="canDownload"
              type="button"
              class="shrink-0 rounded-lg border border-rule px-2.5 py-1 text-xs disabled:cursor-wait disabled:opacity-60"
              :disabled="isDownloading"
              @click="downloadSongFile(song.id)"
            >
              {{ downloadingSongId === song.id ? '准备中…' : '下载' }}
            </button>
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                song.playbackStatus === 'PENDING_DOWNLOAD'
              "
              class="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100"
              @click="setPlaybackStatus(song.id, 'DOWNLOADED')"
            >
              标为已下载
            </button>
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                song.playbackStatus === 'PLAYBACK_ERROR'
              "
              class="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
              @click="setPlaybackStatus(song.id, 'PENDING_DOWNLOAD')"
            >
              恢复待下载
            </button>
            <button
              v-if="
                (admin.me?.role === 'TECHNICIAN' || admin.isSuper) &&
                (song.playbackStatus === 'PENDING_DOWNLOAD' || song.playbackStatus === 'DOWNLOADED')
              "
              class="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
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
              @click="requestUnschedule(song.id)"
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
          v-if="pendingUnscheduleId"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          @click.self="closeUnscheduleDialog"
        >
          <div class="w-full max-w-sm rounded-xl border border-rule bg-paper p-5 shadow-xl">
            <h2 class="text-base font-bold" style="font-family: var(--font-display)">
              确认取消排期
            </h2>
            <p class="mt-2 text-sm leading-6 text-ink-faint">
              取消后，歌曲会返回待审核状态，需要重新安排播出时段。
            </p>
            <div class="mt-5 flex justify-end gap-3">
              <button
                class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-faint disabled:opacity-50"
                :disabled="Boolean(unschedulingId)"
                @click="closeUnscheduleDialog"
              >
                取消
              </button>
              <button
                class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
                :disabled="Boolean(unschedulingId)"
                @click="doUnschedule"
              >
                {{ unschedulingId ? '取消中…' : '确认取消排期' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="pendingDownloadIds"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          @click.self="closeDownloadDialog"
        >
          <div class="w-full max-w-md rounded-xl border border-rule bg-paper p-5 shadow-xl">
            <h2 class="text-base font-bold" style="font-family: var(--font-display)">
              选择下载方式
            </h2>
            <p class="mt-2 text-sm leading-6 text-ink-faint">
              {{ pendingDownloadIds.length }} 首歌曲将分别下载，不会打包为 ZIP。
            </p>
            <div class="mt-4 space-y-3">
              <label class="flex cursor-pointer gap-3 rounded-lg border border-rule p-3">
                <input
                  v-model="selectedDownloadMode"
                  value="download"
                  type="radio"
                  class="mt-1 accent-orange-deep"
                />
                <span>
                  <span class="block text-sm font-medium">下载</span>
                  <span class="mt-1 block text-xs leading-5 text-ink-faint"
                    >直接保存到浏览器默认下载目录。</span
                  >
                </span>
              </label>
              <label class="flex cursor-pointer gap-3 rounded-lg border border-rule p-3">
                <input
                  v-model="selectedDownloadMode"
                  value="saveAs"
                  type="radio"
                  class="mt-1 accent-orange-deep"
                />
                <span>
                  <span class="block text-sm font-medium">另存为</span>
                  <span class="mt-1 block text-xs leading-5 text-ink-faint"
                    >下载前选择保存位置；批量下载时选择一次目录。</span
                  >
                </span>
              </label>
            </div>
            <label class="mt-4 flex items-center gap-2 text-sm text-ink-soft">
              <input v-model="rememberDownloadMode" type="checkbox" class="accent-orange-deep" />
              记住我的选择，可在个人资料中修改
            </label>
            <div class="mt-5 flex justify-end gap-3">
              <button
                class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-faint"
                @click="closeDownloadDialog"
              >
                取消
              </button>
              <button
                class="rounded-lg bg-orange-deep px-4 py-2 text-sm text-white hover:bg-orange-deep/90"
                @click="confirmDownloadMode"
              >
                开始下载
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
