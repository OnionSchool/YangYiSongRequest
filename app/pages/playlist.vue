<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import PlaylistCard from '@/components/PlaylistCard.vue';
import { fetchPlaylistDate, type PlaylistDay } from '@/lib/api';
import { isoDate, relativeDayLabel, shiftDate } from '@/lib/time';
import { useServerClock } from '@/stores/clock';
import { useSite } from '@/stores/site';

const clock = useServerClock();
const site = useSite();
const selectedDate = ref(isoDate(clock.serverNow));
const playlist = ref<PlaylistDay | null>(null);
const loading = ref(false);
const failure = ref<string | null>(null);
const today = computed(() => isoDate(clock.serverNow));

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    playlist.value = await fetchPlaylistDate(selectedDate.value);
  } catch (error: any) {
    playlist.value = null;
    failure.value = error.message ?? '载入失败';
  } finally {
    loading.value = false;
  }
}

function prevDay() {
  selectedDate.value = shiftDate(selectedDate.value, -1);
}

function nextDay() {
  selectedDate.value = shiftDate(selectedDate.value, 1);
}

onMounted(async () => {
  await site.load();
  await load();
});
watch(selectedDate, load);
</script>

<template>
  <div>
    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="eyebrow">播出单</p>
        <h1 class="mt-1.5 text-2xl sm:text-3xl">查看过往歌单</h1>
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-3">
      <button type="button" class="pressable rounded-control px-3 py-2 text-sm" @click="prevDay">
        ← 前一天
      </button>
      <button
        type="button"
        class="font-mono text-lg tabular-nums"
        :disabled="selectedDate === today"
        @click="selectedDate = today"
      >
        {{ selectedDate === today ? '今天' : selectedDate }}
      </button>
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
