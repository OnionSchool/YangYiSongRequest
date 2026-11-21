<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import MonthCalendar from '@/components/MonthCalendar.vue';
import PlaylistCard from '@/components/PlaylistCard.vue';
import { useMonthMarks } from '@/composables/useMonthMarks';
import { fetchPlaylistDate, type PlaylistDay } from '@/lib/api';
import { isoDate, monthOf, relativeDayLabel, shiftDate } from '@/lib/time';
import { useServerClock } from '@/stores/clock';
import { useSite } from '@/stores/site';

const clock = useServerClock();
const site = useSite();
const selectedDate = ref(isoDate(clock.serverNow));
const calendarMonth = ref(monthOf(selectedDate.value));
const playlist = ref<PlaylistDay | null>(null);
const loading = ref(false);
const failure = ref<string | null>(null);
const today = computed(() => isoDate(clock.serverNow));
const { marks, loading: marksLoading, load: loadMarks } = useMonthMarks(calendarMonth);
let loadSequence = 0;

async function load() {
  const sequence = ++loadSequence;
  const date = selectedDate.value;
  loading.value = true;
  failure.value = null;
  try {
    const result = await fetchPlaylistDate(date);
    if (sequence !== loadSequence) return;
    playlist.value = result;
  } catch (error: any) {
    if (sequence !== loadSequence) return;
    playlist.value = null;
    failure.value = error.message ?? '载入失败';
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function prevDay() {
  selectedDate.value = shiftDate(selectedDate.value, -1);
}

function nextDay() {
  selectedDate.value = shiftDate(selectedDate.value, 1);
}

/** 点了日历就换成那一天；月份跟着跳，前后一天跨月时也一致 */
function pickDate(date: string) {
  selectedDate.value = date;
}

onMounted(async () => {
  await site.load();
  await load();
  void loadMarks();
});

watch(selectedDate, (date) => {
  calendarMonth.value = monthOf(date);
  void load();
});
</script>

<template>
  <div>
    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="eyebrow">播出单</p>
        <h1 class="mt-1.5 text-2xl sm:text-3xl">查看过往歌单</h1>
      </div>
    </div>

    <!-- 日历常驻：想翻到哪个月的那一天，一格就能点到 -->
    <section class="paper-card mt-5 p-4">
      <MonthCalendar
        :month="calendarMonth"
        :selected="selectedDate"
        :today="today"
        :marks="marks"
        :loading="marksLoading"
        @update:month="calendarMonth = $event"
        @select="pickDate"
      />
    </section>

    <div class="mt-4 flex items-center justify-between gap-3">
      <button type="button" class="pressable rounded-control px-3 py-2 text-sm" @click="prevDay">
        ← 前一天
      </button>
      <p class="text-center">
        <span class="font-mono text-sm tabular-nums text-ink-soft">{{ selectedDate }}</span>
        <span class="mt-0.5 block text-xs text-ink-faint">
          {{ relativeDayLabel(selectedDate, today) }}
        </span>
      </p>
      <button type="button" class="pressable rounded-control px-3 py-2 text-sm" @click="nextDay">
        后一天 →
      </button>
    </div>

    <p v-if="failure" class="mt-3 text-sm text-orange-deep">{{ failure }}</p>
    <p v-else-if="loading" class="mt-6 text-center text-ink-soft">载入中…</p>
    <PlaylistCard
      v-else-if="playlist"
      class="mt-6"
      :date="playlist.date"
      :relative="relativeDayLabel(playlist.date, today)"
      :slots="playlist.slots"
      :preview-enabled="site.guestPreviewOpen"
    />
  </div>
</template>
