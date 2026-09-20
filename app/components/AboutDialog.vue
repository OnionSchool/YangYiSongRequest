<script setup lang="ts">
defineProps<{ open: boolean }>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

function close(): void {
  emit('update:open', false);
}
</script>

<template>
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
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
        @click.self="close"
        @keydown.esc="close"
      >
        <section
          class="w-full max-w-xl overflow-hidden rounded-card border border-rule bg-paper-hi shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
        >
          <div class="halftone p-5 sm:p-7">
            <div class="flex items-start justify-between gap-5">
              <div>
                <p class="eyebrow">关于杨中之声</p>
                <h2 id="about-title" class="mt-1.5 text-2xl font-bold">杨中之声</h2>
                <p class="mt-2 text-sm text-ink-soft">杨村第一中学校园广播电视台点歌系统</p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-badge border border-rule px-2.5 py-1 text-sm text-ink-soft hover:border-ink-faint hover:text-ink"
                aria-label="关闭关于弹窗"
                @click="close"
              >
                关闭
              </button>
            </div>

            <div class="my-5 tick-rule" />

            <p class="eyebrow">致谢</p>
            <dl class="mt-3 divide-y divide-rule border-y border-rule text-sm">
              <div class="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt class="font-medium">台长</dt>
                <dd class="text-ink-soft">2025级 白兴崎 · 域名购置</dd>
              </div>
              <div class="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt class="font-medium">媒体技术部</dt>
                <dd class="text-ink-soft">2025级 李佳润 · 系统开发、服务器购置与运维</dd>
              </div>
              <div class="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt class="font-medium">媒体技术部</dt>
                <dd class="text-ink-soft">2025级 石梓涵 · 系统开发</dd>
              </div>
              <div class="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt class="font-medium">电视台全体成员</dt>
                <dd class="text-ink-soft">内测、宣传，以及日常歌曲审批与播出</dd>
              </div>
            </dl>
          </div>
          <footer class="flex justify-end border-t border-rule px-5 py-3 sm:px-7">
            <button type="button" class="btn-primary px-4 py-2 text-sm" @click="close">
              知道了
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
