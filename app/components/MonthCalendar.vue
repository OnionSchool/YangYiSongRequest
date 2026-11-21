<script setup lang="ts">
// 月历：选日期 + 一眼看出哪天有排歌、哪天不播。
// 只负责网格与状态展示，月份数据由调用方按 month 去拉。
import { computed } from 'vue';
import type { PlaylistMonthDay } from '@/lib/api';
import { daysInMonth, monthOf, monthParts, shiftMonth } from '@/lib/time';

const props = defineProps<{
  /** 当前展示的月份，形如 2026-11 */
  month: string;
  /** 选中的日期 YYYY-MM-DD */
  selected?: string | null;
  /** 今天，用来做标记和「回到今天」 */
  today?: string;
  /** 当月的每日标记，只含本月内日期 */
  marks?: PlaylistMonthDay[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  select: [date: string];
  'update:month': [month: string];
}>();

/** 中国习惯周一开头 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const monthLabel = computed(() => {
  const { year, monthNo } = monthParts(props.month);
  return `${year} 年 ${monthNo} 月`;
});

const marksByDate = computed(() => new Map((props.marks ?? []).map((mark) => [mark.date, mark])));

/** 补上月初的空格，让 1 号落在正确的星期列 */
const cells = computed<Array<string | null>>(() => {
  const { year, monthNo } = monthParts(props.month);
  const lead = (new Date(Date.UTC(year, monthNo - 1, 1)).getUTCDay() + 6) % 7;
  const list: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth(props.month); day += 1) {
    list.push(`${props.month}-${String(day).padStart(2, '0')}`);
  }
  return list;
});

const hasMarks = computed(() => (props.marks?.length ?? 0) > 0);

function songCount(date: string): number {
  return marksByDate.value.get(date)?.songCount ?? 0;
}

/** 数据还没到的时候别急着把日子标成灰色，不然会闪一下 */
function isOff(date: string): boolean {
  const mark = marksByDate.value.get(date);
  return mark ? !mark.broadcast : false;
}

function dayLabel(date: string): string {
  const parts = [`${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`];
  if (props.today === date) parts.push('今天');
  if (isOff(date)) parts.push('不播出');
  const count = songCount(date);
  if (count > 0) parts.push(`${count} 首歌`);
  return parts.join('，');
}

function goMonth(delta: number): void {
  emit('update:month', shiftMonth(props.month, delta));
}

function goToday(): void {
  const today = props.today;
  if (!today) return;
  const month = monthOf(today);
  if (month !== props.month) emit('update:month', month);
  emit('select', today);
}
</script>

<template>
  <div class="mx-auto w-full max-w-sm select-none" :class="loading ? 'opacity-60' : ''">
    <div class="mb-2 flex items-center gap-1">
      <button
        type="button"
        class="pressable flex h-7 w-7 items-center justify-center"
        aria-label="上个月"
        @click="goMonth(-1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <p class="eyebrow flex-1 text-center">{{ monthLabel }}</p>
      <button
        type="button"
        class="pressable flex h-7 w-7 items-center justify-center"
        aria-label="下个月"
        @click="goMonth(1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <div class="grid grid-cols-7 gap-1 text-center">
      <span v-for="weekday in WEEKDAYS" :key="weekday" class="py-1 text-[0.7rem] text-ink-faint">
        {{ weekday }}
      </span>
      <template v-for="(date, slot) in cells" :key="date ?? `blank-${slot}`">
        <span v-if="!date" aria-hidden="true"></span>
        <button
          v-else
          type="button"
          class="relative flex h-9 items-center justify-center rounded-badge border text-sm tabular-nums"
          :class="[
            date === selected
              ? 'border-orange bg-orange/15 font-semibold text-ink'
              : ['border-transparent', isOff(date) ? 'text-ink-faint' : 'text-ink-soft'],
            date !== selected ? 'hover:border-rule' : '',
            date === today && date !== selected
              ? 'underline decoration-ink-faint decoration-dotted underline-offset-4'
              : '',
          ]"
          :aria-current="date === today ? 'date' : undefined"
          :aria-pressed="date === selected"
          :aria-label="dayLabel(date)"
          @click="emit('select', date)"
        >
          {{ Number(date.slice(8, 10)) }}
          <span
            v-if="songCount(date) > 0"
            class="absolute bottom-1 h-1 w-1 rounded-full bg-orange-deep"
            aria-hidden="true"
          ></span>
        </button>
      </template>
    </div>

    <div class="mt-2 flex items-center justify-between text-[0.7rem] text-ink-faint">
      <span v-if="hasMarks" class="flex items-center gap-1.5">
        <span class="h-1 w-1 rounded-full bg-orange-deep" aria-hidden="true"></span>
        有排歌
        <span class="text-ink-faint/70">灰字不播出</span>
      </span>
      <span v-else>暂无标记</span>
      <button v-if="today" type="button" class="pressable px-2 py-0.5" @click="goToday">
        回到今天
      </button>
    </div>
  </div>
</template>

<style scoped>
svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
