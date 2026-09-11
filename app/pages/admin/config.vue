<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  readSiteConfig,
  saveSiteConfig,
  readSlots,
  saveSlots,
  readGrades,
  saveGrades,
  readWords,
  saveWords,
  type SlotRow,
} from '~/lib/adminApi';

definePageMeta({ layout: 'admin' });

const activeTab = ref('site');

// Site
const requestsOpen = ref(true);
const requireIdentity = ref(true);
const forceChangePassword = ref(true);
const announcement = ref('');
const maxScheduleDays = ref(14);
const siteMsg = ref<string | null>(null);

// Slots
const slots = ref<SlotRow[]>([]);
const slotsMsg = ref<string | null>(null);

// Grades
const gradeG1 = ref(23);
const gradeG2 = ref(23);
const gradeG3 = ref(23);
const gradesMsg = ref<string | null>(null);

// Words
const wordsRaw = ref('');
const wordsMsg = ref<string | null>(null);

const loading = ref(true);
const error = ref<string | null>(null);

const tabs = [
  { key: 'site', icon: '⚙️', label: '基本设置' },
  { key: 'slots', icon: '🎙️', label: '播出时段' },
  { key: 'grades', icon: '🎓', label: '年级班级' },
  { key: 'words', icon: '🚫', label: '屏蔽词' },
];

async function loadAll() {
  loading.value = true;
  try {
    const [site, sl, gr, w] = await Promise.all([
      readSiteConfig(),
      readSlots(),
      readGrades(),
      readWords(),
    ]);
    if (site) {
      requestsOpen.value = site.requestsOpen;
      requireIdentity.value = site.requireIdentity;
      forceChangePassword.value = site.forceChangePassword ?? true;
      announcement.value = site.announcement;
      maxScheduleDays.value = site.maxScheduleDays;
    }
    slots.value = sl;
    for (const g of gr) {
      if (g.grade === 'G1') gradeG1.value = g.classCount;
      if (g.grade === 'G2') gradeG2.value = g.classCount;
      if (g.grade === 'G3') gradeG3.value = g.classCount;
    }
    wordsRaw.value = w.words.join('\n');
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

async function saveSite() {
  siteMsg.value = null;
  try {
    await saveSiteConfig({
      requestsOpen: requestsOpen.value,
      requireIdentity: requireIdentity.value,
      forceChangePassword: forceChangePassword.value,
      announcement: announcement.value,
      maxScheduleDays: maxScheduleDays.value,
    });
    siteMsg.value = '✓ 已保存';
    setTimeout(() => {
      siteMsg.value = null;
    }, 2000);
  } catch (e: any) {
    siteMsg.value = e.message ?? '保存失败';
  }
}

function addSlot() {
  slots.value.push({
    name: '',
    startTime: '12:00',
    endTime: '12:30',
    maxCount: null,
    maxMs: null,
    enabled: true,
  });
}

function removeSlot(i: number) {
  slots.value.splice(i, 1);
}

async function doSaveSlots() {
  slotsMsg.value = null;
  try {
    slots.value = await saveSlots(slots.value);
    slotsMsg.value = '✓ 已保存';
    setTimeout(() => {
      slotsMsg.value = null;
    }, 2000);
  } catch (e: any) {
    slotsMsg.value = e.message ?? '保存失败';
  }
}

async function doSaveGrades() {
  gradesMsg.value = null;
  try {
    await saveGrades({ G1: gradeG1.value, G2: gradeG2.value, G3: gradeG3.value });
    gradesMsg.value = '✓ 已保存';
    setTimeout(() => {
      gradesMsg.value = null;
    }, 2000);
  } catch (e: any) {
    gradesMsg.value = e.message ?? '保存失败';
  }
}

async function doSaveWords() {
  wordsMsg.value = null;
  try {
    const words = wordsRaw.value
      .split(/\n/)
      .map((w) => w.trim())
      .filter(Boolean);
    await saveWords(words);
    wordsMsg.value = '✓ 已保存';
    setTimeout(() => {
      wordsMsg.value = null;
    }, 2000);
  } catch (e: any) {
    wordsMsg.value = e.message ?? '保存失败';
  }
}

onMounted(loadAll);
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1" style="font-family: var(--font-display)">站点设置</h1>
    <p class="text-sm text-ink-faint mb-6">管理站点配置、播出时段和内容过滤</p>

    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">加载中…</span>
    </div>
    <div
      v-if="error"
      class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <template v-if="!loading">
      <!-- Tabs -->
      <div class="flex items-center gap-1 mb-6 p-1 rounded-lg bg-paper-deep/30 w-fit">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-all"
          :class="
            activeTab === tab.key
              ? 'bg-paper shadow-sm font-medium text-ink'
              : 'text-ink-soft hover:text-ink'
          "
          @click="activeTab = tab.key"
        >
          <span class="text-sm">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </div>

      <!-- Site Config -->
      <div v-if="activeTab === 'site'" class="paper-card p-6 space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">开放点歌通道</p>
            <p class="text-sm text-ink-faint mt-0.5">关闭后学生无法提交新请求</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input v-model="requestsOpen" type="checkbox" class="sr-only peer" />
            <div
              class="w-10 h-6 bg-rule rounded-full peer-checked:bg-green-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"
            />
          </label>
        </div>

        <div class="border-t border-rule pt-5 flex items-center justify-between">
          <div>
            <p class="font-medium">要求填写身份信息</p>
            <p class="text-sm text-ink-faint mt-0.5">点歌时必须填写年级、班级、姓名</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input v-model="requireIdentity" type="checkbox" class="sr-only peer" />
            <div
              class="w-10 h-6 bg-rule rounded-full peer-checked:bg-green-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"
            />
          </label>
        </div>

        <div class="border-t border-rule pt-5 flex items-center justify-between">
          <div>
            <p class="font-medium">强制首次修改密码</p>
            <p class="text-sm text-ink-faint mt-0.5">新建账号首次登录时必须修改默认密码</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input v-model="forceChangePassword" type="checkbox" class="sr-only peer" />
            <div
              class="w-10 h-6 bg-rule rounded-full peer-checked:bg-green-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"
            />
          </label>
        </div>

        <div class="border-t border-rule pt-5">
          <label class="block">
            <p class="font-medium">公告内容</p>
            <p class="text-sm text-ink-faint mt-0.5">显示在前台页面顶部</p>
            <textarea
              v-model="announcement"
              rows="3"
              class="mt-2 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm focus:border-ink-faint focus:outline-none transition-colors"
              placeholder="暂无公告"
            />
          </label>
        </div>

        <div class="border-t border-rule pt-5">
          <label class="block">
            <p class="font-medium">最大排期天数</p>
            <p class="text-sm text-ink-faint mt-0.5">排期管理中可选择的最远日期</p>
            <input
              v-model.number="maxScheduleDays"
              type="number"
              min="1"
              max="60"
              class="mt-2 w-24 rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none transition-colors"
            />
          </label>
        </div>

        <div class="border-t border-rule pt-5 flex items-center gap-3">
          <button class="btn-primary px-5 py-2.5 text-sm" @click="saveSite">保存设置</button>
          <Transition
            enter-active-class="transition duration-200"
            enter-from-class="opacity-0 translate-y-1"
            leave-active-class="transition duration-150"
            leave-to-class="opacity-0"
          >
            <span v-if="siteMsg" class="text-sm text-green-600 font-medium">{{ siteMsg }}</span>
          </Transition>
        </div>
      </div>

      <!-- Slots -->
      <div v-if="activeTab === 'slots'" class="paper-card p-6">
        <div v-if="slots.length === 0" class="text-center py-8 text-ink-faint">
          <span class="text-3xl block mb-2">🎙️</span>
          <p>还没有配置播出时段</p>
        </div>

        <div class="space-y-3">
          <div
            v-for="(slot, i) in slots"
            :key="i"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-rule p-3"
            :class="!slot.enabled ? 'opacity-50' : ''"
          >
            <input
              v-model="slot.name"
              type="text"
              placeholder="名称"
              class="w-28 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm"
            />
            <div class="flex items-center gap-1">
              <input
                v-model="slot.startTime"
                type="time"
                class="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm font-mono"
              />
              <span class="text-ink-faint">–</span>
              <input
                v-model="slot.endTime"
                type="time"
                class="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <input
              v-model.number="slot.maxCount"
              type="number"
              placeholder="上限"
              class="w-16 rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm"
            />
            <label class="flex items-center gap-1.5 text-sm cursor-pointer">
              <input v-model="slot.enabled" type="checkbox" class="rounded" />
              <span class="text-ink-soft">启用</span>
            </label>
            <button
              class="ml-auto rounded-lg p-1.5 text-ink-faint hover:text-red-500 hover:bg-red-50 transition-colors"
              title="删除"
              @click="removeSlot(i)"
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
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-3">
          <button
            class="rounded-lg border border-dashed border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
            @click="addSlot"
          >
            + 添加时段
          </button>
          <button class="btn-primary px-5 py-2 text-sm" @click="doSaveSlots">保存时段</button>
          <Transition
            enter-active-class="transition duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition duration-150"
            leave-to-class="opacity-0"
          >
            <span v-if="slotsMsg" class="text-sm text-green-600 font-medium">{{ slotsMsg }}</span>
          </Transition>
        </div>
      </div>

      <!-- Grades -->
      <div v-if="activeTab === 'grades'" class="paper-card p-6 space-y-4">
        <p class="text-sm text-ink-soft">设置每个年级的班级数量，用于点歌身份填写</p>
        <div class="flex items-center gap-3 rounded-lg border border-rule px-4 py-3">
          <span class="text-xl">🎓</span>
          <span class="font-medium w-12">高一</span>
          <input
            v-model.number="gradeG1"
            type="number"
            min="1"
            max="50"
            class="w-20 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-center focus:border-ink-faint focus:outline-none"
          />
          <span class="text-sm text-ink-faint">个班</span>
        </div>
        <div class="flex items-center gap-3 rounded-lg border border-rule px-4 py-3">
          <span class="text-xl">🎓</span>
          <span class="font-medium w-12">高二</span>
          <input
            v-model.number="gradeG2"
            type="number"
            min="1"
            max="50"
            class="w-20 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-center focus:border-ink-faint focus:outline-none"
          />
          <span class="text-sm text-ink-faint">个班</span>
        </div>
        <div class="flex items-center gap-3 rounded-lg border border-rule px-4 py-3">
          <span class="text-xl">🎓</span>
          <span class="font-medium w-12">高三</span>
          <input
            v-model.number="gradeG3"
            type="number"
            min="1"
            max="50"
            class="w-20 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-center focus:border-ink-faint focus:outline-none"
          />
          <span class="text-sm text-ink-faint">个班</span>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button class="btn-primary px-5 py-2 text-sm" @click="doSaveGrades">保存</button>
          <Transition
            enter-active-class="transition duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition duration-150"
            leave-to-class="opacity-0"
          >
            <span v-if="gradesMsg" class="text-sm text-green-600 font-medium">{{ gradesMsg }}</span>
          </Transition>
        </div>
      </div>

      <!-- Words -->
      <div v-if="activeTab === 'words'" class="paper-card p-6 space-y-4">
        <p class="text-sm text-ink-soft">包含屏蔽词的歌曲标题会被标记提醒，每行一个</p>
        <textarea
          v-model="wordsRaw"
          rows="10"
          class="w-full rounded-lg border border-rule bg-paper px-4 py-3 text-sm font-mono leading-relaxed focus:border-ink-faint focus:outline-none transition-colors"
          placeholder="每行一个屏蔽词"
        />
        <div class="flex items-center gap-3">
          <button class="btn-primary px-5 py-2 text-sm" @click="doSaveWords">保存</button>
          <span class="text-xs text-ink-faint"
            >{{ wordsRaw.split('\n').filter(Boolean).length }} 个词</span
          >
          <Transition
            enter-active-class="transition duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition duration-150"
            leave-to-class="opacity-0"
          >
            <span v-if="wordsMsg" class="text-sm text-green-600 font-medium">{{ wordsMsg }}</span>
          </Transition>
        </div>
      </div>
    </template>
  </div>
</template>
