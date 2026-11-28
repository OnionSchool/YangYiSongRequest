<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import MonthCalendar from '@/components/MonthCalendar.vue';
import PlaylistDeck from '@/components/PlaylistDeck.vue';
import type { DeckDay } from '@/components/PlaylistDeck.vue';
import RequestSlip from '@/components/RequestSlip.vue';
import SongRow from '@/components/SongRow.vue';
import {
  ApiError,
  fetchPlaylistDate,
  fetchPlaylistMonth,
  fetchRecentPlaylist,
  fetchRequestStats,
  fetchSources,
  searchSongs,
} from '@/lib/api';
import type {
  PlaylistDay,
  PlaylistMonthDay,
  PlaylistSlot,
  RequestStats,
  Song,
  SourceId,
} from '@/lib/api';
import { activeSlot } from '@/lib/slots';
import { hhmm, isoDate, monthOf, relativeDayLabel, shiftDate } from '@/lib/time';
import { useServerClock } from '@/stores/clock';
import { usePlayer } from '@/stores/player';
import { useSite } from '@/stores/site';

interface TabState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  songs: Song[];
  total: number;
  page: number;
  message: string;
}

const clock = useServerClock();
const site = useSite();
const player = usePlayer();

const keyword = ref('');
const submitted = ref('');
/** 只包含服务端真正挂了搜索 provider 的音源，避免渲染永远空白的 tab。 */
const available = ref<Array<{ id: SourceId; label: string }>>([]);
const active = ref<SourceId | null>(null);
const picked = ref<Song | null>(null);
const recent = ref<PlaylistDay[]>([]);
const stats = ref<RequestStats | null>(null);
let searchSequence = 0;
const tabSequences = reactive<Partial<Record<SourceId, number>>>({});

const blank = (): TabState => ({ status: 'idle', songs: [], total: 0, page: 1, message: '' });
const tabs = reactive<Partial<Record<SourceId, TabState>>>({});

const now = computed(() => hhmm(clock.serverNow));
const today = computed(() => isoDate(clock.serverNow));
const activeSlotId = computed(() => activeSlot(site.slots, now.value)?.id ?? null);
const currentTab = computed(() => (active.value ? tabs[active.value] : undefined));
const searched = computed(() => submitted.value !== '');

/** 日历里手动挑过、但不在「昨天起已排期」列表里的日期，单独存着 */
const extraDays = ref<PlaylistDay[]>([]);
/** 播出单当前停在哪一天，日历选中格跟着它走 */
const focusedDate = ref<string | null>(null);
const calendarOpen = ref(false);
const calendarMonth = ref(monthOf(today.value));
const monthCache = reactive<Record<string, PlaylistMonthDay[] | undefined>>({});
const pendingMonths = ref(new Set<string>());
const monthMarks = computed(() => monthCache[calendarMonth.value] ?? []);
const monthLoading = computed(() => pendingMonths.value.has(calendarMonth.value));

/** 今天与往后的卡片按后台配置铺满时段，有歌的填进去；过去的日期只显示真有歌的时段 */
function fillSlots(date: string, scheduled: PlaylistSlot[]): PlaylistSlot[] {
  if (date < today.value) return scheduled;
  return site.slots.map(
    (slot) =>
      scheduled.find((item) => item.slotId === slot.id) ?? {
        slotId: slot.id,
        slotName: slot.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        totalMs: 0,
        songs: [],
      }
  );
}

/** 卡片堆：昨天 + 今天 + 往后所有已排期的日期，默认停在今天 */
const deckSource = computed(() => {
  const byDate = new Map<string, PlaylistSlot[]>();
  for (const day of [...recent.value, ...extraDays.value]) byDate.set(day.date, day.slots);
  return byDate;
});

const deckDays = computed<DeckDay[]>(() => {
  const yesterday = shiftDate(today.value, -1);
  const dates = new Set<string>([yesterday, today.value]);
  for (const date of deckSource.value.keys()) {
    if (date >= yesterday) dates.add(date);
  }
  return [...dates].sort().map((date) => ({
    date,
    relative: relativeDayLabel(date, today.value),
    slots: fillSlots(date, deckSource.value.get(date) ?? []),
  }));
});

const todayIndex = computed(() => {
  const found = deckDays.value.findIndex((day) => day.date === today.value);
  return found >= 0 ? found : 0;
});

/** 有选中的日期就停在它那一张，否则停在今天 */
const startIndex = computed(() => {
  const date = focusedDate.value;
  const found = date ? deckDays.value.findIndex((day) => day.date === date) : -1;
  return found >= 0 ? found : todayIndex.value;
});

/** 月历标记：成功拿到就缓存，切回来不用再请求；失败不缓存，下次还能重试 */
async function loadMonth(month: string): Promise<void> {
  if (monthCache[month] || pendingMonths.value.has(month)) return;
  pendingMonths.value.add(month);
  try {
    monthCache[month] = (await fetchPlaylistMonth(month)).days;
  } catch {
    // 拿不到标记不影响选日期，安静地当没有
  } finally {
    pendingMonths.value.delete(month);
  }
}

function toggleCalendar(): void {
  calendarOpen.value = !calendarOpen.value;
  if (calendarOpen.value) void loadMonth(calendarMonth.value);
}

/** 从日历挑一天：拉回那天的歌单塞进卡片堆，再停过去 */
async function pickDate(date: string): Promise<void> {
  calendarOpen.value = false;
  if (!deckSource.value.has(date)) {
    const day = await fetchPlaylistDate(date).catch(() => null);
    if (day && !deckSource.value.has(date)) extraDays.value = [...extraDays.value, day];
  }
  focusedDate.value = date;
}

watch(calendarMonth, (month) => void loadMonth(month));

onMounted(async () => {
  await site.load();
  [recent.value, stats.value] = await Promise.all([
    fetchRecentPlaylist().catch(() => []),
    fetchRequestStats().catch(() => null),
  ]);
  focusedDate.value = today.value;
  void loadMonth(calendarMonth.value);

  const listed = await fetchSources().catch(() => ({ sources: [] }));
  available.value = listed.sources;
  for (const source of listed.sources) {
    tabs[source.id] = blank();
    tabSequences[source.id] = 0;
  }
  if (!active.value || !listed.sources.some((source) => source.id === active.value)) {
    active.value = listed.sources[0]?.id ?? null;
  }
});

/** 每个音源各发一次、互不阻塞：一家挂了只影响它自己那个 tab */
async function run(source: SourceId, page: number, sequence: number): Promise<void> {
  const tab = tabs[source];
  if (!tab) return;
  const nextSequence = (tabSequences[source] ?? 0) + 1;
  tabSequences[source] = nextSequence;
  const tabSequence = nextSequence;
  tab.status = 'loading';
  tab.message = '';
  try {
    const result = await searchSongs(source, submitted.value, page);
    if (sequence !== searchSequence || tabSequence !== tabSequences[source]) return;
    tab.songs = result.songs;
    tab.total = result.total;
    tab.page = result.page;
    tab.status = 'ready';
  } catch (error) {
    if (sequence !== searchSequence || tabSequence !== tabSequences[source]) return;
    tab.songs = [];
    tab.status = 'error';
    tab.message = error instanceof ApiError ? error.message : '搜索失败了';
  }
}

function search(): void {
  const text = keyword.value.trim();
  if (!text) return;
  submitted.value = text;
  const sequence = ++searchSequence;
  player.stop();
  for (const source of available.value) void run(source.id, 1, sequence);
}

const pageCount = computed(() => Math.max(1, Math.ceil((currentTab.value?.total ?? 0) / 20)));
</script>

<template>
  <p v-if="site.announcement" class="mb-5 rounded-card border border-yellow px-4 py-3 text-sm">
    {{ site.announcement }}
  </p>

  <PlaylistDeck
    :days="deckDays"
    :start-index="startIndex"
    :active-slot-id="activeSlotId"
    :live-date="today"
    :now-label="now"
    :preview-enabled="site.guestPreviewOpen"
    @focus-date="focusedDate = $event"
  >
    <template #toolbar>
      <div class="relative shrink-0">
        <button
          type="button"
          class="pressable flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
          :class="calendarOpen ? 'border-orange text-ink' : ''"
          :aria-expanded="calendarOpen"
          aria-controls="home-calendar"
          @click="toggleCalendar"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 calendar-icon">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </svg>
          日历
        </button>
        <!-- 点空白处关掉，手机上不用找关闭按钮 -->
        <div
          v-if="calendarOpen"
          class="fixed inset-0 z-30"
          aria-hidden="true"
          @click="calendarOpen = false"
        ></div>
        <div
          v-if="calendarOpen"
          id="home-calendar"
          class="paper-card absolute right-0 z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] p-3"
          @keydown.esc="calendarOpen = false"
        >
          <MonthCalendar
            :month="calendarMonth"
            :selected="focusedDate"
            :today="today"
            :marks="monthMarks"
            :loading="monthLoading"
            @update:month="calendarMonth = $event"
            @select="pickDate"
          />
        </div>
      </div>
    </template>
  </PlaylistDeck>

  <p class="mt-4">
    <RouterLink
      to="/playlist"
      class="text-sm underline decoration-orange decoration-2 underline-offset-4"
    >
      查看过往歌单
    </RouterLink>
  </p>

  <!-- 审核概况：只放数字，不涉任何歌曲或点歌人信息 -->
  <section v-if="stats && stats.total > 0" class="paper-card mt-6 px-5 py-4">
    <h2 class="eyebrow">审核概况</h2>
    <dl class="mt-3 grid grid-cols-3">
      <div class="pr-3">
        <dt class="text-xs text-ink-soft">总点歌</dt>
        <dd class="mt-1 font-mono text-2xl tabular-nums">{{ stats.total }}</dd>
      </div>
      <div class="border-l border-rule px-3">
        <dt class="text-xs text-ink-soft">已通过</dt>
        <dd class="mt-1 font-mono text-2xl tabular-nums">{{ stats.approved }}</dd>
      </div>
      <div class="border-l border-rule pl-3">
        <dt class="text-xs text-ink-soft">已驳回</dt>
        <dd class="mt-1 font-mono text-2xl tabular-nums text-ink-soft">{{ stats.rejected }}</dd>
      </div>
    </dl>
    <p class="mt-3 text-xs text-ink-soft">
      总数减去已通过和已驳回，就是还在排队等审、或已被取消的歌。
    </p>
  </section>

  <section v-if="site.data?.requestsOpen" class="mt-8">
    <h2 class="eyebrow">搜索</h2>
    <form class="mt-2.5 flex gap-2" @submit.prevent="search">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索歌名、歌手"
        class="min-w-0 grow rounded-control border border-rule bg-paper-hi px-4 py-3 text-base placeholder:text-ink-faint"
        aria-label="搜索歌曲"
      />
      <button type="submit" class="btn-primary shrink-0 px-5 py-3">搜索</button>
    </form>

    <div class="mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="音源">
      <button
        v-for="source in available"
        :key="source.id"
        type="button"
        role="tab"
        :aria-selected="active === source.id"
        class="shrink-0 rounded-badge border px-3 py-1.5 text-sm"
        :class="active === source.id ? 'border-orange bg-orange/15' : 'border-rule text-ink-soft'"
        @click="active = source.id"
      >
        {{ source.label }}
        <span v-if="searched && tabs[source.id]?.status === 'ready'" class="font-mono tabular-nums">
          {{ tabs[source.id]?.total }}
        </span>
        <span v-else-if="searched && tabs[source.id]?.status === 'error'">·</span>
      </button>
      <span v-if="available.length === 0" class="text-sm text-ink-faint">暂无可用音源</span>
    </div>

    <p v-if="player.error" class="mt-3 text-sm text-orange-deep">{{ player.error }}</p>

    <p v-if="!searched" class="mt-3 text-sm text-ink-soft">
      输入关键词后{{ site.guestPreviewOpen ? '可以试听，' : '' }}选中的歌点「点歌」提交给台里。
    </p>

    <div v-else-if="currentTab" class="mt-3">
      <p v-if="currentTab.status === 'loading'" class="text-sm text-ink-soft">搜索中…</p>
      <p v-else-if="currentTab.status === 'error'" class="text-sm text-orange-deep">
        {{ currentTab.message }}
      </p>
      <p v-else-if="currentTab.songs.length === 0" class="text-sm text-ink-soft">
        这个音源没搜到「{{ submitted }}」，换个关键词或切个音源试试。
      </p>
      <template v-else>
        <ul class="paper-card overflow-hidden">
          <SongRow
            v-for="song in currentTab.songs"
            :key="song.platformId"
            :song="song"
            :preview-enabled="site.guestPreviewOpen"
            @request="picked = $event"
          />
        </ul>
        <div v-if="pageCount > 1" class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="rounded-control border border-rule px-3 py-1.5 text-sm disabled:opacity-40"
            :disabled="currentTab.page <= 1"
            @click="active && run(active, currentTab.page - 1, searchSequence)"
          >
            上一页
          </button>
          <span class="font-mono text-sm tabular-nums text-ink-soft">
            {{ currentTab.page }} / {{ pageCount }}
          </span>
          <button
            type="button"
            class="rounded-control border border-rule px-3 py-1.5 text-sm disabled:opacity-40"
            :disabled="currentTab.page >= pageCount"
            @click="active && run(active, currentTab.page + 1, searchSequence)"
          >
            下一页
          </button>
        </div>
      </template>
    </div>
  </section>

  <template v-if="site.data?.requestsOpen">
    <section class="halftone mt-8 rounded-card border border-rule p-5">
      <h2 class="eyebrow">点歌规则</h2>
      <ul class="mt-3 space-y-2 text-sm">
        <li v-if="site.requireIdentity">
          填年级、班级、姓名就行，不用注册。播出单上只显示歌，不显示是谁点的。
        </li>
        <li v-else>现在是匿名点歌，什么都不用填。播出单上只显示歌。</li>
        <li v-if="site.requireIdentity">
          同一时间只能有一首点歌在等播出，播出、被驳回或取消后才能再点。
        </li>
        <li v-else>每人每周最多点 1 首。</li>
        <li>提交后会拿到一个 6 位查询码，凭它查审核结果，记得存下来。</li>
        <li>审核通过并排好时段的歌才会出现在播出单里。周末和法定假日不播。</li>
      </ul>
    </section>

    <RequestSlip :song="picked" @close="picked = null" />
  </template>
</template>
