<script setup lang="ts">
import { onMounted } from 'vue';
import ThemeToggle from '~/components/ThemeToggle.vue';
import { useServerClock } from '~/stores/clock';
import { useSite } from '~/stores/site';

const clock = useServerClock();
const site = useSite();
onMounted(() => {
  clock.start();
  void site.load();
});
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-badge focus:bg-paper-hi focus:px-3 focus:py-2"
    >
      跳到主要内容
    </a>

    <header>
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pt-5 pb-3 sm:px-6">
        <NuxtLink to="/" class="flex items-baseline gap-3 rounded-badge">
          <span class="font-display text-[30px] text-ink sm:text-[38px]">杨中之声</span>
          <span class="hidden text-xs text-ink-soft sm:block">杨村一中校园广播电视台</span>
        </NuxtLink>
        <div class="flex shrink-0 items-center gap-3">
          <NuxtLink to="/lookup" class="pressable rounded-badge px-2.5 py-1.5 text-sm">
            查询
          </NuxtLink>
          <ThemeToggle />
        </div>
      </div>
      <div class="mx-auto max-w-5xl px-4 sm:px-6">
        <div class="tick-rule" />
      </div>
    </header>

    <main id="main" class="mx-auto w-full max-w-5xl grow px-4 py-6 sm:px-6 sm:py-9">
      <slot />
    </main>

    <footer class="mt-6 border-t border-rule">
      <div
        class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 sm:px-6"
      >
        <p class="text-xs text-ink-soft">
          杨村一中校园广播电视台 · 音频来自第三方音乐平台，仅用于校内广播
        </p>
        <p v-if="clock.version" class="eyebrow">v{{ clock.version }}</p>
      </div>
    </footer>
  </div>
</template>
