<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  checkSources,
  createMetingApi,
  deleteMetingApi,
  importLxScript,
  readDownloadTemplates,
  readMetingApis,
  readObjectStorageBudget,
  saveDownloadTemplates,
  testMetingApi,
  updateMetingApi,
  type DownloadTemplates,
  type DownloadMode,
  type LxImportCandidate,
  type LxImportResult,
  type MetingApiRow,
  type MetingCapability,
  type ObjectStorageBudget,
  type ProviderType,
  type SourceHealthRow,
} from '~/lib/adminApi';
import { SOURCES } from '~/lib/api';
import type { SourceId } from '~/lib/api';

definePageMeta({ layout: 'admin' });

const sources = ref<SourceHealthRow[]>([]);
const apis = ref<MetingApiRow[]>([]);
const loading = ref(false);
const checking = ref(false);
const saving = ref(false);
const testing = ref(false);
const testResults = ref<Array<{ source: SourceId; ok: boolean; detail: string }> | null>(null);
const templates = ref<DownloadTemplates>({
  netease: '',
  qq: '',
  kugou: '',
  kuwo: '',
  migu: '',
  qishui: '',
});
const downloadMode = ref<DownloadMode>('proxy');
const objectStorage = ref<ObjectStorageBudget | null>(null);
const configMessage = ref<string | null>(null);
const loadMessage = ref<string | null>(null);
const apiMessage = ref<string | null>(null);
const editingId = ref<string | null>(null);
const BLANK_API = {
  name: '',
  type: 'meting' as ProviderType,
  baseUrl: '',
  authToken: '',
  platforms: ['netease', 'qq', 'kugou'] as SourceId[],
  capabilities: ['search', 'metadata', 'download'] as MetingCapability[],
  searchUrlTemplate: '',
  detailUrlTemplate: '',
  audioUrlTemplate: '',
  coverUrlTemplate: '',
  fieldMap: '',
  metadataCapable: true,
  enabled: true,
  sortOrder: 0,
};
const newApi = ref({ ...BLANK_API, platforms: [...BLANK_API.platforms] });

const platformOptions: Array<{ id: SourceId; label: string }> = SOURCES;
const sourceIcons: Record<string, string> = {
  netease: '🎵',
  qq: '🎧',
  kugou: '🎤',
  kuwo: '📻',
  migu: '🎼',
  qishui: '🥤',
};
const capabilityOptions: Array<{ id: MetingCapability; label: string; description: string }> = [
  { id: 'search', label: '搜索歌曲', description: '用于学生和后台搜索歌曲' },
  { id: 'metadata', label: '获取元数据', description: '用于封面和歌曲详情' },
  { id: 'download', label: '获取音频', description: '用于试听、时长检测和下载' },
];
const providerTypeOptions: Array<{ id: ProviderType; label: string; description: string }> = [
  { id: 'meting', label: 'Meting API', description: '标准 Meting 接口，需填写 API 地址' },
  { id: 'template', label: '模板音源', description: '填写 URL 模板与字段映射，不执行脚本' },
];

type TemplateKey =
  'searchUrlTemplate' | 'detailUrlTemplate' | 'audioUrlTemplate' | 'coverUrlTemplate';

const templateFieldOptions: Array<{
  key: TemplateKey;
  label: string;
  placeholder: string;
  description: string;
  required?: boolean;
}> = [
  {
    key: 'searchUrlTemplate',
    label: '搜索地址模板',
    placeholder: 'https://api.example.com/search?word=${keyword}&page=${page}',
    description: '必填，返回 JSON 的搜索接口',
    required: true,
  },
  {
    key: 'detailUrlTemplate',
    label: '详情地址模板',
    placeholder: 'https://api.example.com/detail?id=${id}',
    description: '可选，用于获取歌曲名、歌手、时长等元数据',
  },
  {
    key: 'audioUrlTemplate',
    label: '音频地址模板',
    placeholder: 'https://api.example.com/url?id=${id}',
    description: '可选，返回音频直链；不填则仅支持搜索与点歌',
  },
  {
    key: 'coverUrlTemplate',
    label: '封面地址模板',
    placeholder: 'https://api.example.com/pic?id=${id}',
    description: '可选，返回封面图片直链',
  },
];
const apiFormTitle = computed(() => {
  const kind = newApi.value.type === 'template' ? '模板音源' : 'Meting API';
  return editingId.value ? `编辑${kind}` : `添加${kind}`;
});

const lxImporting = ref(false);
const lxReport = ref<LxImportResult | null>(null);
/** 探测已经用过搜索模板，其余候选项展示给管理员手工选用。 */
const lxOtherCandidates = computed(() => {
  const report = lxReport.value;
  if (!report) return [];
  const probed = report.probe?.ok ? report.probe.template : undefined;
  return report.candidates.filter((candidate) => candidate.template !== probed);
});

async function onLxFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  lxImporting.value = true;
  lxReport.value = null;
  apiMessage.value = null;
  try {
    const script = await file.text();
    const report = await importLxScript(script);
    lxReport.value = report;
    // 名称与平台自动回填，管理员仍可手改。
    if (!newApi.value.name && report.scriptName) newApi.value.name = report.scriptName;
    if (report.platforms.length > 0) {
      newApi.value.platforms = report.platforms.filter((platform) =>
        SOURCES.some((source) => source.id === platform)
      );
    }
    if (report.probe?.ok && report.probe.template) {
      newApi.value.searchUrlTemplate = report.probe.template;
      if (report.probe.fieldMap) newApi.value.fieldMap = report.probe.fieldMap;
    } else {
      // 探测失败时仍填入最优搜索候选，便于管理员手工修正。
      const fallback = report.candidates.find(
        (candidate) => candidate.kind === 'search' && candidate.unresolved.length === 0
      );
      if (fallback && !newApi.value.searchUrlTemplate) {
        newApi.value.searchUrlTemplate = fallback.template;
      }
    }
    if (report.obfuscated) {
      apiMessage.value = '脚本经过混淆，无法自动提取，请手工填写模板';
    }
  } catch (error) {
    apiMessage.value = error instanceof Error ? error.message : '脚本解析失败';
  } finally {
    lxImporting.value = false;
  }
}

function applyLxCandidate(candidate: LxImportCandidate) {
  if (candidate.kind === 'search') {
    newApi.value.searchUrlTemplate = candidate.template;
  } else if (candidate.kind === 'audio') {
    newApi.value.audioUrlTemplate = candidate.template;
  } else if (!newApi.value.searchUrlTemplate) {
    newApi.value.searchUrlTemplate = candidate.template;
  } else if (!newApi.value.audioUrlTemplate) {
    newApi.value.audioUrlTemplate = candidate.template;
  }
}

async function load() {
  loading.value = true;
  loadMessage.value = null;
  const [health, downloadConfig, metingConfig, storageBudget] = await Promise.allSettled([
    checkSources(),
    readDownloadTemplates(),
    readMetingApis(),
    readObjectStorageBudget(),
  ]);
  sources.value = health.status === 'fulfilled' ? health.value : [];
  if (downloadConfig.status === 'fulfilled') {
    templates.value = downloadConfig.value.templates;
    downloadMode.value = downloadConfig.value.mode;
  }
  if (metingConfig.status === 'fulfilled') apis.value = metingConfig.value.items;
  if (storageBudget.status === 'fulfilled') objectStorage.value = storageBudget.value;
  const failures = [health, downloadConfig, metingConfig, storageBudget].filter(
    (result) => result.status === 'rejected'
  );
  if (failures.length > 0) loadMessage.value = '部分配置加载失败，请刷新后重试';
  loading.value = false;
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function percentage(value: number, limit: number): string {
  if (limit === 0) return '100%';
  return `${Math.min(100, Math.round((value / limit) * 100))}%`;
}

function resetApiForm() {
  editingId.value = null;
  newApi.value = { ...BLANK_API, platforms: [...BLANK_API.platforms] };
}

function editApi(api: MetingApiRow) {
  editingId.value = api.id;
  newApi.value = {
    name: api.name,
    type: api.type ?? 'meting',
    baseUrl: api.baseUrl ?? '',
    authToken: '',
    platforms: [...api.platforms],
    capabilities: [...api.capabilities],
    searchUrlTemplate: api.searchUrlTemplate ?? '',
    detailUrlTemplate: api.detailUrlTemplate ?? '',
    audioUrlTemplate: api.audioUrlTemplate ?? '',
    coverUrlTemplate: api.coverUrlTemplate ?? '',
    fieldMap: api.fieldMap ?? '',
    metadataCapable: api.metadataCapable !== false,
    enabled: api.enabled,
    sortOrder: api.sortOrder,
  };
  apiMessage.value = null;
}

function togglePlatform(platform: SourceId) {
  const platforms = newApi.value.platforms;
  newApi.value.platforms = platforms.includes(platform)
    ? platforms.filter((item) => item !== platform)
    : [...platforms, platform];
}

function toggleCapability(capability: MetingCapability) {
  const capabilities = newApi.value.capabilities;
  newApi.value.capabilities = capabilities.includes(capability)
    ? capabilities.filter((item) => item !== capability)
    : [...capabilities, capability];
}

async function testApi() {
  apiMessage.value = null;
  testResults.value = null;
  if (newApi.value.type === 'template') {
    if (!newApi.value.searchUrlTemplate.trim()) {
      apiMessage.value = '请先填写搜索地址模板';
      return;
    }
    if (newApi.value.platforms.length === 0) {
      apiMessage.value = '至少选择一个支持的平台';
      return;
    }
    testing.value = true;
    try {
      testResults.value = (
        await testMetingApi({
          type: 'template',
          platforms: newApi.value.platforms,
          capabilities: newApi.value.capabilities,
          searchUrlTemplate: newApi.value.searchUrlTemplate.trim(),
          detailUrlTemplate: newApi.value.detailUrlTemplate.trim() || undefined,
          audioUrlTemplate: newApi.value.audioUrlTemplate.trim() || undefined,
          coverUrlTemplate: newApi.value.coverUrlTemplate.trim() || undefined,
          fieldMap: newApi.value.fieldMap.trim() || undefined,
        })
      ).results;
    } catch (error: any) {
      apiMessage.value = error.message ?? '测试失败';
    } finally {
      testing.value = false;
    }
    return;
  }
  if (!newApi.value.baseUrl.trim()) {
    apiMessage.value = '请先填写 API 地址';
    return;
  }
  if (newApi.value.platforms.length === 0) {
    apiMessage.value = '至少选择一个支持的平台';
    return;
  }
  if (!newApi.value.capabilities.includes('search')) {
    apiMessage.value = '测试 API 需要启用“搜索歌曲”功能';
    return;
  }
  testing.value = true;
  try {
    testResults.value = (
      await testMetingApi({
        baseUrl: newApi.value.baseUrl.trim(),
        authToken: newApi.value.authToken.trim() || undefined,
        platforms: newApi.value.platforms,
        capabilities: newApi.value.capabilities,
      })
    ).results;
  } catch (error: any) {
    apiMessage.value = error.message ?? '测试失败';
  } finally {
    testing.value = false;
  }
}

async function saveApi() {
  apiMessage.value = null;
  if (!newApi.value.name.trim()) {
    apiMessage.value = '请填写 API 名称';
    return;
  }
  if (newApi.value.type === 'meting' && !newApi.value.baseUrl.trim()) {
    apiMessage.value = '请填写 API 地址';
    return;
  }
  if (newApi.value.type === 'template' && !newApi.value.searchUrlTemplate.trim()) {
    apiMessage.value = '请填写搜索地址模板';
    return;
  }
  if (newApi.value.platforms.length === 0) {
    apiMessage.value = '至少选择一个支持的平台';
    return;
  }
  if (newApi.value.capabilities.length === 0) {
    apiMessage.value = '至少选择一个 API 功能';
    return;
  }
  saving.value = true;
  try {
    const isTemplate = newApi.value.type === 'template';
    const body = {
      name: newApi.value.name.trim(),
      type: newApi.value.type,
      platforms: newApi.value.platforms,
      capabilities: newApi.value.capabilities,
      enabled: newApi.value.enabled,
      sortOrder: newApi.value.sortOrder,
      ...(isTemplate
        ? {
            baseUrl: '',
            searchUrlTemplate: newApi.value.searchUrlTemplate.trim(),
            detailUrlTemplate: newApi.value.detailUrlTemplate.trim() || undefined,
            audioUrlTemplate: newApi.value.audioUrlTemplate.trim() || undefined,
            coverUrlTemplate: newApi.value.coverUrlTemplate.trim() || undefined,
            fieldMap: newApi.value.fieldMap.trim() || undefined,
            metadataCapable: newApi.value.metadataCapable,
          }
        : { baseUrl: newApi.value.baseUrl.trim() }),
    };
    const result = editingId.value
      ? await updateMetingApi(editingId.value, body)
      : await createMetingApi(body);
    apis.value = result.items;
    apiMessage.value = '已保存';
    resetApiForm();
  } catch (error: any) {
    apiMessage.value = error.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

async function removeApi(api: MetingApiRow) {
  if (!confirm(`确定删除「${api.name}」吗？`)) return;
  apiMessage.value = null;
  try {
    await deleteMetingApi(api.id);
    apis.value = apis.value.filter((item) => item.id !== api.id);
    if (editingId.value === api.id) resetApiForm();
  } catch (error: any) {
    apiMessage.value = error.message ?? '删除失败';
  }
}

async function saveDownloads() {
  configMessage.value = null;
  try {
    const config = await saveDownloadTemplates(templates.value, downloadMode.value);
    templates.value = config.templates;
    downloadMode.value = config.mode;
    configMessage.value = '已保存';
  } catch (error: any) {
    configMessage.value = error.message ?? '保存失败';
  }
}

async function recheck() {
  checking.value = true;
  const result = await checkSources().catch(() => null);
  if (result) sources.value = result;
  checking.value = false;
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">音源配置</h1>
        <p class="mt-0.5 text-sm text-ink-faint">配置多个外部 Meting API，并按顺序自动故障切换。</p>
      </div>
      <button
        class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors flex items-center gap-1.5 disabled:opacity-50"
        :disabled="checking"
        @click="recheck"
      >
        {{ checking ? '检测中…' : '重新检测音源' }}
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">加载中…</span>
    </div>

    <template v-else>
      <p
        v-if="loadMessage"
        class="rounded-control border border-orange/40 bg-orange/10 px-3 py-2 text-sm text-orange-deep"
      >
        {{ loadMessage }}
      </p>
      <section class="paper-card p-5 space-y-4">
        <div>
          <h2 class="font-medium">{{ apiFormTitle }}</h2>
          <p class="mt-1 text-sm text-ink-faint">
            Meting API 支持标准 <code>server</code>、<code>type</code> 与 <code>id</code>
            查询参数；模板音源只按 URL 模板拼请求并读取 JSON 字段，不执行任何脚本。
          </p>
        </div>

        <div
          v-if="newApi.type === 'template'"
          class="rounded-lg border border-dashed border-rule p-3"
        >
          <div class="flex flex-wrap items-center gap-3">
            <label
              class="cursor-pointer rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-medium hover:border-ink-faint"
            >
              导入 lx 音源脚本
              <input type="file" accept=".js,.txt" class="hidden" @change="onLxFile" />
            </label>
            <span v-if="lxImporting" class="text-sm text-ink-faint">正在解析与探测…</span>
            <span class="text-xs text-ink-faint">
              自动提取接口地址、猜测平台并推断字段映射；混淆或加密脚本无法还原
            </span>
          </div>
          <div v-if="lxReport" class="mt-3 space-y-2 text-sm">
            <p :class="lxReport.probe?.ok ? 'text-green-700' : 'text-orange-deep'">
              {{ lxReport.probe?.detail ?? '静态解析完成，未执行探测' }}
            </p>
            <ul
              v-if="lxReport.warnings.length"
              class="list-inside list-disc text-xs text-orange-deep"
            >
              <li v-for="warning in lxReport.warnings" :key="warning">{{ warning }}</li>
            </ul>
            <div v-if="lxOtherCandidates.length" class="space-y-1">
              <p class="text-xs font-medium text-ink-faint">
                脚本里的其他接口地址（点击填入对应栏位）：
              </p>
              <button
                v-for="candidate in lxOtherCandidates"
                :key="candidate.template"
                type="button"
                class="block w-full truncate rounded border border-rule px-2 py-1 text-left font-mono text-xs hover:border-orange"
                :title="candidate.note"
                @click="applyLxCandidate(candidate)"
              >
                {{ candidate.template }}
                <span v-if="candidate.unresolved.length" class="text-orange-deep">
                  （含未解析变量 {{ candidate.unresolved.join(', ') }}）
                </span>
              </button>
            </div>
          </div>
        </div>
        <fieldset>
          <legend class="text-sm font-medium">音源类型</legend>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <label
              v-for="option in providerTypeOptions"
              :key="option.id"
              class="rounded-lg border border-rule px-3 py-2 text-sm"
              :class="newApi.type === option.id ? 'border-orange bg-orange/10' : ''"
            >
              <span class="flex items-center gap-2 font-medium">
                <input v-model="newApi.type" type="radio" :value="option.id" />
                {{ option.label }}
              </span>
              <span class="mt-1 block text-xs text-ink-faint">{{ option.description }}</span>
            </label>
          </div>
        </fieldset>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="text-sm font-medium">名称</span>
            <input
              v-model="newApi.name"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
              placeholder="主 API"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium">优先级</span>
            <input
              v-model.number="newApi.sortOrder"
              type="number"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
            />
          </label>
        </div>
        <label v-if="newApi.type === 'meting'" class="block">
          <span class="text-sm font-medium">Base URL</span>
          <input
            v-model="newApi.baseUrl"
            type="url"
            class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
            placeholder="https://meting.example.com/api"
          />
        </label>
        <label v-if="newApi.type === 'meting'" class="block">
          <span class="text-sm font-medium">鉴权密钥（METING_TOKEN）</span>
          <input
            v-model="newApi.authToken"
            type="password"
            autocomplete="new-password"
            class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
            :placeholder="editingId ? '留空则保留当前密钥' : '按需填写'"
          />
          <span class="mt-1 block text-xs text-ink-faint">
            用于 url、pic 和 lrc 请求的 HMAC-SHA1 签名，仅保存在服务端。
          </span>
        </label>
        <template v-if="newApi.type === 'template'">
          <div
            class="rounded-lg border border-rule bg-paper/60 p-3 text-xs text-ink-faint space-y-1"
          >
            <p>
              模板占位符：<code v-pre>${{ '{keyword}' }}</code> 已编码关键词、
              <code v-pre>${{ '{keywordRaw}' }}</code> 原始关键词、<code v-pre>${{ '{id}' }}</code>
              平台歌曲 ID、<code v-pre>${{ '{page}' }}</code> 页码、
              <code v-pre>${{ '{limit}' }}</code> 每页条数。
            </p>
            <p>只允许 http(s) 地址；域名会自动加入外部请求白名单。</p>
          </div>
          <div class="grid gap-4">
            <label v-for="field in templateFieldOptions" :key="field.key" class="block">
              <span class="text-sm font-medium">
                {{ field.label }}<span v-if="field.required" class="text-orange"> *</span>
              </span>
              <input
                v-model="newApi[field.key]"
                class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
                :placeholder="field.placeholder"
              />
              <span class="mt-1 block text-xs text-ink-faint">{{ field.description }}</span>
            </label>
          </div>
          <label class="block">
            <span class="text-sm font-medium">字段映射（可选，JSON）</span>
            <textarea
              v-model="newApi.fieldMap"
              rows="4"
              class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
              placeholder='{"id":"rid","title":"song","artist":"singer"}'
            />
            <span class="mt-1 block text-xs text-ink-faint">
              仅当接口字段名不在内置候选（id/rid/song/title/artist/singer 等）里时才需要填写。
            </span>
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="newApi.metadataCapable" type="checkbox" />
            此音源可提供歌曲元数据（关闭后允许客户端回传歌曲信息）
          </label>
        </template>
        <fieldset>
          <legend class="text-sm font-medium">支持的平台</legend>
          <div class="mt-2 flex flex-wrap gap-3">
            <label
              v-for="platform in platformOptions"
              :key="platform.id"
              class="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                :checked="newApi.platforms.includes(platform.id)"
                @change="togglePlatform(platform.id)"
              />
              {{ platform.label }}
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend class="text-sm font-medium">启用功能</legend>
          <p class="mt-1 text-sm text-ink-faint">
            可同时开启多个功能。未开启的功能不会使用此 API，也不会参与该功能的故障切换。
          </p>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <label
              v-for="capability in capabilityOptions"
              :key="capability.id"
              class="rounded-lg border border-rule px-3 py-2 text-sm"
            >
              <span class="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  :checked="newApi.capabilities.includes(capability.id)"
                  @change="toggleCapability(capability.id)"
                />
                {{ capability.label }}
              </span>
              <span class="mt-1 block text-xs text-ink-faint">{{ capability.description }}</span>
            </label>
          </div>
        </fieldset>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="newApi.enabled" type="checkbox" />
          启用此 API
        </label>
        <div class="flex items-center gap-3">
          <button
            class="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            :disabled="saving"
            @click="saveApi"
          >
            {{ saving ? '保存中…' : '保存 API' }}
          </button>
          <button
            class="rounded-lg border border-rule px-4 py-2 text-sm disabled:opacity-50"
            :disabled="testing"
            @click="testApi"
          >
            {{ testing ? '测试中…' : '测试 API' }}
          </button>
          <button
            v-if="editingId"
            class="rounded-lg border border-rule px-4 py-2 text-sm"
            @click="resetApiForm"
          >
            取消编辑
          </button>
          <span
            v-if="apiMessage"
            class="text-sm"
            :class="apiMessage === '已保存' ? 'text-green-600' : 'text-red-600'"
            >{{ apiMessage }}</span
          >
        </div>
        <div v-if="testResults" class="divide-y divide-rule rounded-lg border border-rule text-sm">
          <div
            v-for="result in testResults"
            :key="result.source"
            class="flex items-center gap-3 px-3 py-2"
          >
            <span class="font-medium">{{
              platformOptions.find((item) => item.id === result.source)?.label
            }}</span>
            <span class="ml-auto" :class="result.ok ? 'text-green-700' : 'text-red-600'">{{
              result.ok ? '正常' : '异常'
            }}</span>
            <span class="text-ink-faint">{{ result.detail }}</span>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <div v-if="apis.length === 0" class="paper-card p-6 text-sm text-ink-faint">
          尚未配置 Meting API。请先添加至少一个 API，否则无法搜索或下载歌曲。
        </div>
        <article
          v-for="api in apis"
          :key="api.id"
          class="paper-card p-5 flex flex-col gap-4 sm:flex-row sm:items-center"
        >
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-medium">{{ api.name }}</h3>
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="api.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-ink-faint'"
                >{{ api.enabled ? '已启用' : '已停用' }}</span
              >
              <span class="text-xs text-ink-faint">优先级 {{ api.sortOrder }}</span>
              <span v-if="api.authConfigured" class="text-xs text-ink-faint">已配置鉴权</span>
            </div>
            <p class="mt-1 truncate font-mono text-sm text-ink-faint">{{ api.baseUrl }}</p>
            <p class="mt-2 text-sm text-ink-soft">
              平台：{{
                api.platforms
                  .map((id) => platformOptions.find((item) => item.id === id)?.label ?? id)
                  .join('、')
              }}
            </p>
            <p class="mt-1 text-sm text-ink-soft">
              功能：{{
                api.capabilities
                  .map((id) => capabilityOptions.find((item) => item.id === id)?.label ?? id)
                  .join('、')
              }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="rounded-lg border border-rule px-3 py-1.5 text-sm" @click="editApi(api)">
              编辑
            </button>
            <button
              class="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600"
              @click="removeApi(api)"
            >
              删除
            </button>
          </div>
        </article>
      </section>

      <section class="paper-card p-5 space-y-3">
        <div>
          <h2 class="font-medium">当前音源状态</h2>
          <p class="mt-1 text-sm text-ink-faint">
            按 API 优先级测试对应平台；失败时系统会自动尝试下一个可用 API。
          </p>
        </div>
        <div v-if="sources.length === 0" class="text-sm text-ink-faint">尚未检测到可用音源。</div>
        <div
          v-for="src in sources"
          :key="src.source"
          class="flex items-center gap-3 border-t border-rule pt-3 first:border-0 first:pt-0"
        >
          <span class="text-xl">{{ sourceIcons[src.source] || '🎵' }}</span>
          <div class="flex-1">
            <p class="font-medium">{{ src.label }}</p>
            <p class="text-sm text-ink-faint">{{ src.detail }}</p>
          </div>
          <span class="text-sm" :class="src.ok ? 'text-green-700' : 'text-red-600'">{{
            src.ok ? '正常' : '异常'
          }}</span>
        </div>
      </section>

      <section v-if="objectStorage" class="paper-card p-5 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-medium">对象存储额度守卫</h2>
            <p class="mt-1 text-sm text-ink-faint">
              {{
                objectStorage.enabled
                  ? `${objectStorage.period} 月度统计，达到上限后自动停止访问对象存储。`
                  : '尚未配置对象存储。'
              }}
            </p>
          </div>
          <span
            class="rounded-full px-2 py-1 text-xs"
            :class="
              objectStorage.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-ink-faint'
            "
            >{{ objectStorage.enabled ? '守卫已启用' : '未启用' }}</span
          >
        </div>
        <div v-if="objectStorage.enabled" class="grid gap-4 sm:grid-cols-3">
          <div
            v-for="item in [
              {
                label: '写入请求',
                value: objectStorage.classAOperations,
                limit: objectStorage.classALimit,
                detail: 'Class A',
              },
              {
                label: '读取请求',
                value: objectStorage.classBOperations,
                limit: objectStorage.classBLimit,
                detail: 'Class B',
              },
              {
                label: '缓存容量',
                value: objectStorage.trackedBytes,
                limit: objectStorage.storageLimitBytes - objectStorage.reservedStorageBytes,
                detail: bytes(objectStorage.trackedBytes),
              },
            ]"
            :key="item.label"
            class="rounded-lg border border-rule p-3"
          >
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-sm font-medium">{{ item.label }}</p>
              <span class="text-xs text-ink-faint">{{ item.detail }}</span>
            </div>
            <p class="mt-2 text-lg font-semibold">
              {{ item.label === '缓存容量' ? bytes(item.value) : item.value.toLocaleString() }}
              <span class="text-xs font-normal text-ink-faint"
                >/
                {{
                  item.label === '缓存容量' ? bytes(item.limit) : item.limit.toLocaleString()
                }}</span
              >
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-deep">
              <div
                class="h-full rounded-full bg-orange"
                :style="{ width: percentage(item.value, item.limit) }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="paper-card p-5 space-y-4">
        <div>
          <h2 class="font-medium">下载方式与自定义地址</h2>
          <p class="mt-1 text-sm text-ink-faint">
            使用 <code>{id}</code> 替换歌曲标识；留空时通过可用的 Meting API 获取音频链接。
          </p>
        </div>
        <fieldset>
          <legend class="text-sm font-medium">下载方式</legend>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <label class="rounded-lg border border-rule p-3 text-sm">
              <span class="flex items-center gap-2 font-medium">
                <input v-model="downloadMode" type="radio" value="direct" />
                直接下载链接
              </span>
              <span class="mt-1 block text-xs text-ink-faint">
                已缓存歌曲直接返回缓存文件；未缓存歌曲跳转至音源原始链接。
              </span>
            </label>
            <label class="rounded-lg border border-rule p-3 text-sm">
              <span class="flex items-center gap-2 font-medium">
                <input v-model="downloadMode" type="radio" value="proxy" />
                服务器代理下载
              </span>
              <span class="mt-1 block text-xs text-ink-faint">
                服务器拉取并缓存音频后返回文件，适合需要统一下载行为的场景。
              </span>
            </label>
          </div>
          <p class="mt-2 text-xs text-ink-faint">当天 ZIP 需要合并多首歌曲，始终由服务器生成。</p>
        </fieldset>
        <label v-for="platform in platformOptions" :key="platform.id" class="block">
          <span class="text-sm font-medium">{{ platform.label }}</span>
          <input
            v-model="templates[platform.id]"
            class="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-mono focus:border-ink-faint focus:outline-none"
            placeholder="留空则通过 Meting API 获取"
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
    </template>
  </div>
</template>
