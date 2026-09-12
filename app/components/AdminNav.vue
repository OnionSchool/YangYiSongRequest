<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAdmin } from '~/stores/admin';

const admin = useAdmin();
const route = useRoute();
const router = useRouter();

const mobileOpen = ref(false);
const switchingRole = ref(false);
const debugRoles = [
  { value: 'SUPER', label: '超级管理员' },
  { value: 'PLANNER', label: '策划' },
  { value: 'TECHNICIAN', label: '技术员' },
] as const;
const currentDisplayName = computed(() => admin.me?.displayName ?? admin.me?.username ?? '');

// 路由变化时关闭抽屉
watch(
  () => route.path,
  () => {
    mobileOpen.value = false;
  }
);

const navGroups = computed(() => [
  {
    label: '工作台',
    items: [
      { to: '/admin', icon: '📊', label: '仪表盘', exact: true },
      ...(admin.me?.role === 'TECHNICIAN'
        ? []
        : [{ to: '/admin/review', icon: '📋', label: '审核管理' }]),
      {
        to: '/admin/schedule',
        icon: '📅',
        label: admin.me?.role === 'TECHNICIAN' ? '播放工作台' : '排期管理',
      },
    ],
  },
  ...(admin.isSuper
    ? [
        {
          label: '系统配置',
          items: [
            { to: '/admin/config', icon: '⚙️', label: '站点设置' },
            { to: '/admin/calendar', icon: '🗓️', label: '行政历' },
            { to: '/admin/sources', icon: '🎵', label: '音源状态' },
            { to: '/admin/alerts', icon: '⚠️', label: '系统告警' },
            { to: '/admin/users', icon: '👥', label: '账号管理' },
          ],
        },
      ]
    : []),
  {
    label: '个人',
    items: [
      { to: '/admin/profile', icon: '👤', label: '个人资料' },
      { to: '/admin/email', icon: '✉️', label: '邮箱管理' },
      { to: '/admin/password', icon: '🔑', label: '修改密码' },
    ],
  },
]);

// 移动端底栏 + "更多"
const mobileMainTabs = computed(() => [
  { to: '/admin', icon: '📊', label: '首页', exact: true },
  ...(admin.me?.role === 'TECHNICIAN' ? [] : [{ to: '/admin/review', icon: '📋', label: '审核' }]),
  { to: '/admin/schedule', icon: '📅', label: '排期' },
]);

function isActive(to: string, exact?: boolean) {
  return exact ? route.path === to : route.path.startsWith(to);
}

// "更多"按钮高亮：当前路由不在三个主 tab 里时
const moreActive = computed(() => !mobileMainTabs.value.some((t) => isActive(t.to, t.exact)));

async function signOut() {
  await admin.logout();
  await router.push('/admin/login');
}

async function switchDebugRole(role: 'SUPER' | 'PLANNER' | 'TECHNICIAN') {
  if (admin.me?.role === role) return;
  switchingRole.value = true;
  try {
    await admin.switchDebugRole(role);
  } finally {
    switchingRole.value = false;
  }
}
</script>

<template>
  <!-- ========== Desktop sidebar ========== -->
  <aside class="hidden lg:flex flex-col w-56 shrink-0">
    <div class="px-4 pt-5 pb-4">
      <p class="eyebrow tracking-widest">广播台</p>
      <h2 class="text-lg font-bold mt-0.5" style="font-family: var(--font-display)">管理后台</h2>
    </div>

    <nav class="flex-1 overflow-y-auto px-2 space-y-5">
      <div v-for="group in navGroups" :key="group.label">
        <p class="px-2 mb-1.5 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">
          {{ group.label }}
        </p>
        <ul class="space-y-0.5">
          <li v-for="item in group.items" :key="item.to">
            <NuxtLink
              :to="item.to"
              class="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
              :class="
                isActive(item.to, (item as any).exact)
                  ? 'bg-orange/12 text-orange-deep font-medium'
                  : 'text-ink-soft hover:bg-paper-deep/40 hover:text-ink'
              "
            >
              <span class="text-base w-5 text-center shrink-0">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </NuxtLink>
          </li>
        </ul>
      </div>
    </nav>

    <div class="border-t border-rule px-4 py-3">
      <div class="flex items-center gap-2">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-orange/15 text-sm font-bold text-orange-deep"
        >
          {{ currentDisplayName.charAt(0)?.toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ currentDisplayName }}</p>
          <p class="text-[11px] text-ink-faint">
            {{ admin.isSuper ? '超级管理员' : admin.me?.role === 'PLANNER' ? '策划' : '技术员' }}
          </p>
        </div>
        <button
          class="rounded p-1 text-ink-faint hover:text-ink hover:bg-paper-deep/40 transition-colors"
          title="退出登录"
          @click="signOut"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
      <div v-if="admin.me?.debugMode" class="mt-3">
        <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-orange-deep uppercase">
          调试身份
        </p>
        <div class="flex rounded-lg bg-paper-deep/60 p-0.5 text-xs">
          <button
            v-for="debugRole in debugRoles"
            :key="debugRole.value"
            class="flex-1 rounded-md px-2 py-1 transition-colors"
            :class="
              admin.me?.role === debugRole.value
                ? 'bg-paper text-orange-deep shadow-sm'
                : 'text-ink-faint hover:text-ink'
            "
            :disabled="switchingRole"
            @click="switchDebugRole(debugRole.value)"
          >
            {{ debugRole.label }}
          </button>
        </div>
      </div>
    </div>
  </aside>

  <!-- ========== Mobile bottom bar ========== -->
  <nav
    class="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-rule bg-paper/95 backdrop-blur-md safe-b"
  >
    <div class="flex items-stretch justify-around h-14">
      <NuxtLink
        v-for="item in mobileMainTabs"
        :key="item.to"
        :to="item.to"
        class="flex flex-col items-center justify-center gap-0.5 flex-1 text-xs transition-colors"
        :class="isActive(item.to, item.exact) ? 'text-orange-deep font-medium' : 'text-ink-faint'"
      >
        <span class="text-lg">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </NuxtLink>
      <!-- 更多按钮 -->
      <button
        class="flex flex-col items-center justify-center gap-0.5 flex-1 text-xs transition-colors"
        :class="moreActive ? 'text-orange-deep font-medium' : 'text-ink-faint'"
        @click="mobileOpen = !mobileOpen"
      >
        <span class="text-lg">☰</span>
        <span>更多</span>
      </button>
    </div>
  </nav>

  <!-- ========== Mobile drawer overlay ========== -->
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
        v-if="mobileOpen"
        class="lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        @click.self="mobileOpen = false"
      >
        <!-- Drawer panel (slides from bottom) -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="translate-y-full"
          enter-to-class="translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="translate-y-0"
          leave-to-class="translate-y-full"
          appear
        >
          <div
            v-if="mobileOpen"
            class="absolute bottom-0 inset-x-0 rounded-t-2xl bg-paper border-t border-rule max-h-[80vh] overflow-y-auto pb-safe"
          >
            <!-- Handle -->
            <div class="flex justify-center pt-3 pb-1">
              <div class="w-10 h-1 rounded-full bg-rule" />
            </div>

            <!-- Nav groups -->
            <nav class="px-4 pb-4 space-y-4">
              <div v-for="group in navGroups" :key="group.label">
                <p
                  class="px-2 mb-1.5 text-[11px] font-semibold tracking-wider text-ink-faint uppercase"
                >
                  {{ group.label }}
                </p>
                <ul class="space-y-0.5">
                  <li v-for="item in group.items" :key="item.to">
                    <NuxtLink
                      :to="item.to"
                      class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
                      :class="
                        isActive(item.to, (item as any).exact)
                          ? 'bg-orange/12 text-orange-deep font-medium'
                          : 'text-ink-soft active:bg-paper-deep/40'
                      "
                    >
                      <span class="text-lg w-6 text-center">{{ item.icon }}</span>
                      <span>{{ item.label }}</span>
                    </NuxtLink>
                  </li>
                </ul>
              </div>

              <!-- User + logout -->
              <div class="border-t border-rule pt-3">
                <div class="flex items-center gap-3 px-3 py-2">
                  <div
                    class="flex h-9 w-9 items-center justify-center rounded-full bg-orange/15 text-sm font-bold text-orange-deep"
                  >
                    {{ currentDisplayName.charAt(0)?.toUpperCase() }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{{ currentDisplayName }}</p>
                    <p class="text-[11px] text-ink-faint">
                      {{
                        admin.isSuper
                          ? '超级管理员'
                          : admin.me?.role === 'PLANNER'
                            ? '策划'
                            : '技术员'
                      }}
                    </p>
                  </div>
                  <button
                    class="rounded-lg border border-rule px-3 py-1.5 text-xs text-ink-soft hover:text-red-500 hover:border-red-200 transition-colors"
                    @click="signOut"
                  >
                    退出登录
                  </button>
                </div>
                <div
                  v-if="admin.me?.debugMode"
                  class="mt-2 flex rounded-lg bg-paper-deep/60 p-0.5 text-xs"
                >
                  <button
                    v-for="debugRole in debugRoles"
                    :key="debugRole.value"
                    class="flex-1 rounded-md px-2 py-1.5 transition-colors"
                    :class="
                      admin.me?.role === debugRole.value
                        ? 'bg-paper text-orange-deep shadow-sm'
                        : 'text-ink-faint'
                    "
                    :disabled="switchingRole"
                    @click="switchDebugRole(debugRole.value)"
                  >
                    {{ debugRole.label }}
                  </button>
                </div>
              </div>
            </nav>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
