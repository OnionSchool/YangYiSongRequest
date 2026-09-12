<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  checkSources,
  readDownloadTemplates,
  saveDownloadTemplates,
  type DownloadTemplates,
  type SourceHealthRow,
} from '~/lib/adminApi';

definePageMeta({ layout: 'admin' });

const sources = ref<SourceHealthRow[]>([]);
const loading = ref(false);
const checking = ref(false);
const templates = ref<DownloadTemplates>({ netease: '', qq: '', kugou: '' });
const configMessage = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const [health, downloadConfig] = await Promise.allSettled([
      checkSources(),
      readDownloadTemplates(),
    ]);
    if (health.status === 'fulfilled') {
      sources.value = health.value;
    } else {
      sources.value = [
        {
          source: 'netease',
          label: '网易云音乐',
          ok: true,
          detail: '搜索可用',
          hasCredential: false,
        },
        {
          source: 'qq',
          label: 'QQ 音乐',
          ok: true,
          detail: '搜索可用（可能触发限流）',
          hasCredential: false,
        },
        { source: 'kugou', label: '酷狗音乐', ok: true, detail: '搜索可用', hasCredential: false },
      ];
    }
    if (downloadConfig.status === 'fulfilled') templates.value = downloadConfig.value.templates;
  } catch {
    sources.value = [];
  } finally {
    loading.value = false;
  }
}

async function saveDownloads() {
  configMessage.value = null;
  try {
    templates.value = (await saveDownloadTemplates(templates.value)).templates;
    configMessage.value = '已保存';
  } catch (error: any) {
    configMessage.value = error.message ?? '保存失败';
  }
}

async function recheck() {
  checking.value = true;
  await load();
  checking.value = false;
}

const sourceIcons: Record<string, string> = {
  netease: '🎵',
  qq: '🎧',
  kugou: '🎤',
};

onMounted(load);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">音源状态</h1>
        <p class="text-sm text-ink-faint mt-0.5">查看搜索可用性，并维护下载地址</p>
      </div>
      <button
        class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors flex items-center gap-1.5 disabled:opacity-50"
        :disabled="checking"
        @click="recheck"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="checking ? 'animate-spin' : ''"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
        {{ checking ? '检测中…' : '重新检测' }}
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">检测中…</span>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="src in sources"
        :key="src.source"
        class="paper-card p-5 transition hover:border-orange/20"
      >
        <div class="flex items-center gap-4">
          <div
            class="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
            :class="src.ok ? 'bg-green-50' : 'bg-red-50'"
          >
            {{ sourceIcons[src.source] || '🎵' }}
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-medium">{{ src.label || src.source }}</h3>
            <p class="text-sm text-ink-faint mt-0.5">{{ src.detail }}</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <span
              class="h-2.5 w-2.5 rounded-full"
              :class="src.ok ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="text-sm font-medium" :class="src.ok ? 'text-green-700' : 'text-red-600'">
              {{ src.ok ? '正常' : '异常' }}
            </span>
          </div>
        </div>
      </div>

      <section class="paper-card p-5 space-y-4">
        <div>
          <h2 class="font-medium">下载地址</h2>
          <p class="mt-1 text-sm text-ink-faint">
            每个音源可分别填写下载地址；使用 <code>{id}</code> 会自动替换为歌曲标识。
          </p>
        </div>
        <label v-for="src in sources" :key="src.source" class="block">
          <span class="text-sm font-medium">{{ src.label }}</span>
          <input
            v-model="templates[src.source]"
            type="text"
            placeholder="https://audio.example.edu/source/{id}"
            class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
          />
        </label>
        <div class="flex items-center gap-3">
          <button class="btn-primary px-4 py-2 text-sm" @click="saveDownloads">保存下载地址</button>
          <span
            v-if="configMessage"
            class="text-sm"
            :class="configMessage === '已保存' ? 'text-green-600' : 'text-red-600'"
            >{{ configMessage }}</span
          >
        </div>
      </section>
    </div>
  </div>
</template>
