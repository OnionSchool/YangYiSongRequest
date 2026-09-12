<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  readUsers,
  createUser,
  batchCreateUsers,
  patchUser,
  type AdminUserRow,
} from '~/lib/adminApi';
import { ApiError } from '~/lib/api';

definePageMeta({ layout: 'admin' });

const users = ref<AdminUserRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const msg = ref<string | null>(null);

// New user form
const showNew = ref(false);
const newUsername = ref('');
const newDisplayName = ref('');
const newPassword = ref('');
const newRole = ref<'SUPER' | 'PLANNER' | 'TECHNICIAN'>('PLANNER');
const creating = ref(false);

// Batch import
const showBatch = ref(false);
const batchText = ref('');
const batchRole = ref<'SUPER' | 'PLANNER' | 'TECHNICIAN'>('PLANNER');
const batchBusy = ref(false);
const batchResults = ref<Array<{ username: string; ok: boolean; message?: string }> | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    users.value = await readUsers();
  } catch (e: any) {
    error.value = e.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function parseBatchLines(text: string) {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Support: username,password[,displayName] or username password [displayName]
      // Try comma first, fall back to whitespace
      const parts = line.includes(',') ? line.split(',').map((p) => p.trim()) : line.split(/\s+/);
      return {
        username: parts[0] || '',
        password: parts[1] || '',
        displayName: parts[2] || undefined,
        role: batchRole.value,
      };
    })
    .filter((u) => u.username && u.password);
}

async function doBatchImport() {
  const users = parseBatchLines(batchText.value);
  if (users.length === 0) {
    error.value = '未解析到有效用户，请检查格式';
    return;
  }
  batchBusy.value = true;
  error.value = null;
  msg.value = null;
  batchResults.value = null;
  try {
    const res = await batchCreateUsers(users);
    batchResults.value = res.results;
    if (res.failed === 0) {
      msg.value = `成功导入 ${res.success} 个用户`;
      batchText.value = '';
    } else {
      msg.value = `成功 ${res.success} 个，失败 ${res.failed} 个`;
    }
    await load();
  } catch (e: any) {
    error.value = e instanceof ApiError ? e.message : '导入失败';
  } finally {
    batchBusy.value = false;
  }
}

async function doCreate() {
  if (!newUsername.value || !newPassword.value) return;
  creating.value = true;
  msg.value = null;
  error.value = null;
  try {
    await createUser({
      username: newUsername.value,
      displayName: newDisplayName.value,
      password: newPassword.value,
      role: newRole.value,
    });
    newUsername.value = '';
    newDisplayName.value = '';
    newPassword.value = '';
    showNew.value = false;
    msg.value = '创建成功';
    setTimeout(() => {
      msg.value = null;
    }, 2000);
    await load();
  } catch (e: any) {
    error.value = e instanceof ApiError ? e.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

const editingDisplayNameId = ref<string | null>(null);
const editingDisplayName = ref('');
const savingDisplayName = ref(false);

function startDisplayNameEdit(user: AdminUserRow) {
  editingDisplayNameId.value = user.id;
  editingDisplayName.value = user.displayName;
}

function cancelDisplayNameEdit() {
  editingDisplayNameId.value = null;
  editingDisplayName.value = '';
}

async function saveDisplayName(user: AdminUserRow) {
  savingDisplayName.value = true;
  error.value = null;
  try {
    await patchUser(user.id, { displayName: editingDisplayName.value });
    user.displayName = editingDisplayName.value.trim() || user.username;
    cancelDisplayNameEdit();
    msg.value = '显示名称已保存';
    setTimeout(() => {
      msg.value = null;
    }, 2000);
  } catch (e: any) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    savingDisplayName.value = false;
  }
}

async function toggleDisabled(user: AdminUserRow) {
  try {
    await patchUser(user.id, { disabled: !user.disabled });
    msg.value = user.disabled ? '已启用' : '已禁用';
    setTimeout(() => {
      msg.value = null;
    }, 2000);
    await load();
  } catch (e: any) {
    error.value = e.message ?? '操作失败';
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '从未登录';
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold" style="font-family: var(--font-display)">账号管理</h1>
        <p class="text-sm text-ink-faint mt-0.5">管理后台管理员账号</p>
      </div>
      <div class="flex gap-2">
        <button
          class="rounded-lg border border-rule px-4 py-2 text-sm flex items-center gap-1.5 hover:border-ink-faint transition-colors"
          :class="showBatch ? 'bg-paper-deep/30 font-medium' : ''"
          @click="
            showBatch = !showBatch;
            if (showBatch) showNew = false;
          "
        >
          {{ showBatch ? '取消导入' : '批量导入' }}
        </button>
        <button
          class="btn-primary px-4 py-2 text-sm flex items-center gap-1.5"
          @click="
            showNew = !showNew;
            if (showNew) showBatch = false;
          "
        >
          <svg
            v-if="!showNew"
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
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          {{ showNew ? '取消' : '新建账号' }}
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </div>
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-if="msg"
        class="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700"
      >
        {{ msg }}
      </div>
    </Transition>

    <!-- Create form -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="showNew" class="mb-5 paper-card p-5">
        <h3 class="font-medium mb-3">新建管理员</h3>
        <div class="flex flex-wrap gap-2">
          <input
            v-model="newUsername"
            type="text"
            placeholder="用户名"
            class="rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
          />
          <input
            v-model="newDisplayName"
            type="text"
            maxlength="64"
            placeholder="显示名称（如真实姓名）"
            class="rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
          />
          <input
            v-model="newPassword"
            type="password"
            placeholder="密码"
            class="rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
          />
          <select
            v-model="newRole"
            class="rounded-lg border border-rule bg-paper px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
          >
            <option value="PLANNER">策划</option>
            <option value="TECHNICIAN">技术员</option>
            <option value="SUPER">超级管理员</option>
          </select>
          <button
            class="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            :disabled="creating || !newUsername || !newPassword"
            @click="doCreate"
          >
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Batch import form -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="showBatch" class="mb-5 paper-card p-5 space-y-3">
        <h3 class="font-medium">批量导入用户</h3>
        <p class="text-sm text-ink-faint">
          每行一个用户，格式：<code class="bg-paper-deep/40 px-1.5 py-0.5 rounded text-xs"
            >用户名,密码,显示名称(可选)</code
          >，也支持空格分隔
        </p>
        <div class="flex items-center gap-2">
          <span class="text-sm text-ink-soft">角色：</span>
          <select
            v-model="batchRole"
            class="rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm focus:border-ink-faint focus:outline-none"
          >
            <option value="PLANNER">策划</option>
            <option value="TECHNICIAN">技术员</option>
            <option value="SUPER">超级管理员</option>
          </select>
          <span class="text-xs text-ink-faint">所有导入用户统一分配此角色</span>
        </div>
        <textarea
          v-model="batchText"
          rows="8"
          class="w-full rounded-lg border border-rule bg-paper px-4 py-3 text-sm font-mono leading-relaxed focus:border-ink-faint focus:outline-none transition-colors"
          placeholder="zhangsan,Abc123456789
li_si,Password1234,李四
wangwu Pass12345678 王五"
        />
        <div class="flex items-center gap-3">
          <button
            class="btn-primary px-5 py-2 text-sm disabled:opacity-50"
            :disabled="batchBusy || !batchText.trim()"
            @click="doBatchImport"
          >
            {{ batchBusy ? '导入中…' : `导入 (${parseBatchLines(batchText).length} 个用户)` }}
          </button>
        </div>
        <!-- Batch results -->
        <div v-if="batchResults" class="rounded-lg border border-rule overflow-hidden">
          <div class="max-h-48 overflow-y-auto">
            <div
              v-for="(r, i) in batchResults"
              :key="i"
              class="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-rule last:border-0"
              :class="r.ok ? '' : 'bg-red-50/50'"
            >
              <span
                class="shrink-0 w-4 text-center"
                :class="r.ok ? 'text-green-600' : 'text-red-500'"
              >
                {{ r.ok ? '✓' : '✗' }}
              </span>
              <span class="font-mono">{{ r.username }}</span>
              <span v-if="r.message" class="text-xs text-red-600 ml-auto">{{ r.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="loading" class="flex items-center justify-center py-16 text-ink-faint">
      <span class="animate-pulse">加载中…</span>
    </div>

    <!-- User list -->
    <div v-else class="paper-card divide-y divide-rule overflow-hidden">
      <div
        v-for="user in users"
        :key="user.id"
        class="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-deep/10"
        :class="user.disabled ? 'opacity-40' : ''"
      >
        <!-- Avatar -->
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold shrink-0"
          :class="
            user.role === 'SUPER' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
          "
        >
          {{ user.displayName.charAt(0).toUpperCase() }}
        </div>

        <!-- Info -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <template v-if="editingDisplayNameId === user.id">
              <input
                v-model="editingDisplayName"
                type="text"
                maxlength="64"
                class="min-w-0 rounded border border-rule bg-paper px-2 py-1 text-sm focus:border-ink-faint focus:outline-none"
                aria-label="显示名称"
                @keyup.enter="saveDisplayName(user)"
                @keyup.escape="cancelDisplayNameEdit"
              />
              <button
                class="text-xs font-medium text-orange-deep disabled:opacity-50"
                :disabled="savingDisplayName"
                @click="saveDisplayName(user)"
              >
                保存
              </button>
              <button
                class="text-xs text-ink-faint"
                :disabled="savingDisplayName"
                @click="cancelDisplayNameEdit"
              >
                取消
              </button>
            </template>
            <template v-else>
              <span class="font-medium">{{ user.displayName }}</span>
              <button
                class="text-xs text-ink-faint hover:text-ink"
                @click="startDisplayNameEdit(user)"
              >
                编辑名称
              </button>
            </template>
            <span
              class="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
              :class="
                user.role === 'SUPER'
                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              "
            >
              {{ user.role === 'SUPER' ? '超管' : user.role === 'PLANNER' ? '策划' : '技术员' }}
            </span>
            <span
              v-if="user.disabled"
              class="text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 font-medium"
            >
              已禁用
            </span>
          </div>
          <p class="text-xs text-ink-faint mt-0.5">
            账号：{{ user.username }} · 上次登录：{{ formatDate(user.lastLoginAt) }}
          </p>
        </div>

        <!-- Action -->
        <button
          class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          :class="
            user.disabled
              ? 'border-green-200 text-green-600 hover:bg-green-50'
              : 'border-red-200 text-red-600 hover:bg-red-50'
          "
          @click="toggleDisabled(user)"
        >
          {{ user.disabled ? '启用' : '禁用' }}
        </button>
      </div>

      <div v-if="users.length === 0" class="px-5 py-12 text-center text-ink-faint">
        <span class="text-3xl block mb-2">👥</span>
        暂无用户
      </div>
    </div>
  </div>
</template>
