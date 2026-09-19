<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    page: number;
    totalPages: number;
    loading?: boolean;
  }>(),
  { loading: false }
);

const emit = defineEmits<{
  change: [page: number];
}>();

const targetPage = ref(String(props.page));
const pageNumbers = computed(() => {
  const start = Math.max(1, props.page - 1);
  const end = Math.min(props.totalPages, props.page + 10);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});

watch(
  () => props.page,
  (page) => {
    targetPage.value = String(page);
  }
);

function changePage(page: number) {
  if (page < 1 || page > props.totalPages || page === props.page || props.loading) return;
  emit('change', page);
}

function jumpToPage() {
  const page = Number(targetPage.value);
  if (!Number.isInteger(page) || page < 1 || page > props.totalPages) {
    targetPage.value = String(props.page);
    return;
  }
  changePage(page);
}
</script>

<template>
  <nav class="flex flex-wrap items-center justify-center gap-2" aria-label="分页">
    <button
      class="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
      :disabled="page <= 1 || loading"
      @click="changePage(page - 1)"
    >
      上一页
    </button>
    <div class="flex flex-wrap items-center justify-center gap-1">
      <button
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        class="h-7 min-w-7 rounded border px-2 text-xs transition-colors disabled:opacity-50"
        :class="
          pageNumber === page
            ? 'border-orange bg-orange text-[#2b1d14]'
            : 'border-rule text-ink-soft hover:border-ink-faint hover:text-ink'
        "
        :disabled="loading"
        :aria-current="pageNumber === page ? 'page' : undefined"
        @click="changePage(pageNumber)"
      >
        {{ pageNumber }}
      </button>
    </div>
    <button
      class="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
      :disabled="page >= totalPages || loading"
      @click="changePage(page + 1)"
    >
      下一页
    </button>
    <form class="flex items-center gap-1.5" @submit.prevent="jumpToPage">
      <label class="sr-only" for="admin-pagination-target">目标页码</label>
      <input
        id="admin-pagination-target"
        v-model="targetPage"
        class="input-field h-7 w-16 px-2 py-1 text-center text-xs"
        :disabled="loading"
        :max="totalPages"
        min="1"
        type="number"
      />
      <button
        class="btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-50"
        :disabled="loading"
        type="submit"
      >
        跳转
      </button>
    </form>
    <span class="text-xs text-ink-faint">第 {{ page }} / {{ totalPages }} 页</span>
  </nav>
</template>
