<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdmin } from '~/stores/admin';
import { readCalendar, saveCalendar, type CalendarRow } from '~/lib/adminApi';
import { isoDate } from '~/lib/time';

definePageMeta({ layout: 'admin' });

const admin = useAdmin();

const currentMonth = ref(isoDate(new Date()).slice(0, 7)); // "2026-09"
const days = ref<CalendarRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const msg = ref<string | null>(null);

// Pending changes
const changes = ref<Map<string, { kind: CalendarRow['kind'] | null; note?: string }>>(new Map());

const kindColors: Record<string, string> = {
  SCHOOL: 'bg-green-50 text-green-700',
  OFF: 'bg-yellow-50 text-yellow-700',
  EXAM_NO_BROADCAST: 'bg-red-50 text-red-600',
};

async function load() {
  loading.value = true;
  error.value = null;
  try {
    days.value = await readCalendar(currentMonth.value);
    changes.value.clear();
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

// Generate calendar grid
const calendarGrid = computed(() => {
  const [year, month] = currentMonth.value.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay(); // 0=Sun

  const grid: Array<{ date: string; day: number } | null> = [];
  for (let i = 0; i < startWeekday; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    grid.push({ date: dateStr, day: d });
  }
  return grid;
});

function getDayKind(date: string): CalendarRow['kind'] | null {
  const change = changes.value.get(date);
  if (change !== undefined) return change.kind;
  const existing = days.value.find((d) => d.date === date);
  return existing?.kind ?? null;
}

function cycleKind(date: string) {
  const current = getDayKind(date);
  const cycle: Array<CalendarRow['kind'] | null> = [null, 'SCHOOL', 'OFF', 'EXAM_NO_BROADCAST'];
  const idx = cycle.indexOf(current);
  const next = cycle[(idx + 1) % cycle.length];
  changes.value.set(date, { kind: next });
}

async function doSave() {
  msg.value = null;
  if (changes.value.size === 0) {
    msg.value = '没有修改';
    return;
  }
  try {
    const dayEntries = Array.from(changes.value.entries()).map(([date, val]) => ({
      date,
      kind: val.kind,
      note: val.note,
    }));
    await saveCalendar(dayEntries);
    msg.value = '已保存';
    await load();
  } catch (e: any) {
    error.value = e.message ?? '保存失败';
  }
}

function prevMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  currentMonth.value = isoDate(d).slice(0, 7);
  load();
}

function nextMonth() {
  const [y, m] = currentMonth.value.split('-').map(Number);
  const d = new Date(y, m, 1);
  currentMonth.value = isoDate(d).slice(0, 7);
  load();
}

onMounted(() => {
  admin.checkSession();
  load();
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1" style="font-family: var(--font-display)">行政历</h1>
    <p class="text-sm text-ink-faint mb-6">标记每日类型：上学、放假或考试</p>

    <!-- Month navigation -->
    <div class="flex items-center gap-2 mb-5">
      <button
        class="rounded-lg border border-rule p-2 hover:border-ink-faint transition-colors"
        @click="prevMonth"
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
      <div class="paper-card px-4 py-2 font-medium text-sm">{{ currentMonth }}</div>
      <button
        class="rounded-lg border border-rule p-2 hover:border-ink-faint transition-colors"
        @click="nextMonth"
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
    </div>

    <div
      v-if="error"
      class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">加载中…</span>
    </div>

    <!-- Legend -->
    <div class="mb-4 flex gap-2 text-xs">
      <span class="px-2.5 py-1 rounded-md bg-green-50 text-green-700 border border-green-200"
        >上学</span
      >
      <span class="px-2.5 py-1 rounded-md bg-yellow-50 text-yellow-700 border border-yellow-200"
        >放假</span
      >
      <span class="px-2.5 py-1 rounded-md bg-red-50 text-red-600 border border-red-200"
        >考试不播</span
      >
      <span class="px-2.5 py-1 rounded-md bg-paper-deep/30 text-ink-faint">未标记</span>
    </div>

    <!-- Calendar Grid -->
    <div v-if="!loading" class="paper-card p-4">
      <div class="grid grid-cols-7 gap-1 text-center text-xs text-ink-faint mb-2 font-medium">
        <span v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <div v-for="(cell, i) in calendarGrid" :key="i">
          <button
            v-if="cell"
            class="w-full rounded-lg p-2.5 text-sm transition-all"
            :class="[
              getDayKind(cell.date) ? kindColors[getDayKind(cell.date)!] : 'hover:bg-paper-deep/30',
              changes.has(cell.date) ? 'ring-2 ring-orange-deep/40' : '',
            ]"
            @click="cycleKind(cell.date)"
          >
            {{ cell.day }}
          </button>
          <div v-else class="p-2.5" />
        </div>
      </div>
    </div>

    <!-- Save -->
    <div class="mt-5 flex items-center gap-3">
      <button
        class="btn-primary px-5 py-2.5 text-sm disabled:opacity-40"
        :disabled="changes.size === 0"
        @click="doSave"
      >
        保存修改 ({{ changes.size }})
      </button>
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition duration-150"
        leave-to-class="opacity-0"
      >
        <span v-if="msg" class="text-sm text-green-600 font-medium">{{ msg }}</span>
      </Transition>
    </div>
  </div>
</template>
